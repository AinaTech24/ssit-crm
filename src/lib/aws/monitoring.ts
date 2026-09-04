/**
 * AWS infrastructure monitoring (platform-admin). Pulls EC2 / RDS / S3 metrics
 * from CloudWatch + EC2/RDS describe APIs + IAM, plus app-level counts from the
 * DB, into one snapshot for the Equitywala Admin → AWS Monitoring dashboard.
 *
 * Read-only. Uses the same credentials as S3 (S3_ACCESS_KEY_ID / AWS_*). The
 * `mfd-deploy` IAM user already has cloudwatch:Get*, ec2:Describe*, rds:Describe*,
 * iam:Get* — no extra grant needed for these metrics.
 */
import { CloudWatchClient, GetMetricStatisticsCommand } from "@aws-sdk/client-cloudwatch";
import { EC2Client, DescribeInstancesCommand, DescribeInstanceStatusCommand, DescribeVolumesCommand } from "@aws-sdk/client-ec2";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { IAMClient, GetAccountSummaryCommand } from "@aws-sdk/client-iam";
import { sql } from "drizzle-orm";
import { withPlatformAdmin } from "@/db/client";

export type Health = "healthy" | "warning" | "critical" | "unknown";
export type Point = { t: number; v: number };

const REGION = process.env.AWS_REGION || process.env.S3_REGION || "ap-south-1";
function awsCreds() {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  return accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {};
}
const cfg = { region: REGION, ...awsCreds() } as const;

const S3_BUCKET = process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || "";

/** One CloudWatch metric → time series + latest value. Never throws. */
async function metricSeries(
  cw: CloudWatchClient,
  namespace: string,
  metricName: string,
  dimensions: { Name: string; Value: string }[],
  stat: "Average" | "Sum" | "Maximum" | "Minimum",
  periodSec: number,
  hours: number
): Promise<{ series: Point[]; latest: number | null }> {
  try {
    const end = new Date();
    const start = new Date(end.getTime() - hours * 3600 * 1000);
    const out = await cw.send(
      new GetMetricStatisticsCommand({
        Namespace: namespace,
        MetricName: metricName,
        Dimensions: dimensions,
        StartTime: start,
        EndTime: end,
        Period: periodSec,
        Statistics: [stat],
      })
    );
    const dp = (out.Datapoints ?? [])
      .map((d) => ({ t: (d.Timestamp ?? new Date()).getTime(), v: Number((d as any)[stat] ?? 0) }))
      .sort((a, b) => a.t - b.t);
    return { series: dp, latest: dp.length ? dp[dp.length - 1].v : null };
  } catch {
    return { series: [], latest: null };
  }
}

function band(value: number | null, warn: number, crit: number, invert = false): Health {
  if (value == null) return "unknown";
  if (invert) return value <= crit ? "critical" : value <= warn ? "warning" : "healthy";
  return value >= crit ? "critical" : value >= warn ? "warning" : "healthy";
}

export type AwsSnapshot = {
  fetchedAt: number;
  region: string;
  ec2: {
    instanceId: string | null;
    type: string | null;
    state: string | null;
    health: Health;
    statusText: string;
    cpu: { latest: number | null; series: Point[]; health: Health };
    networkInKb: { latest: number | null; series: Point[] };
    networkOutKb: { latest: number | null; series: Point[] };
    volumeGb: number | null;
    cpuCredits: { latest: number | null; series: Point[]; health: Health };
  };
  rds: {
    id: string | null;
    klass: string | null;
    engine: string | null;
    health: Health;
    storageTotalGb: number | null;
    storageFreeGb: number | null;
    storageUsedPct: number | null;
    storageHealth: Health;
    connections: { latest: number | null; series: Point[] };
    cpu: { latest: number | null; series: Point[]; health: Health };
    freeableMemMb: number | null;
    readIops: number | null;
    writeIops: number | null;
    readLatencyMs: number | null;
    writeLatencyMs: number | null;
  };
  s3: {
    bucket: string | null;
    sizeBytes: number | null;
    objects: number | null;
    growthTodayBytes: number | null;
    growthWeekBytes: number | null;
    growthMonthBytes: number | null;
    sizeSeries: Point[];
  };
  iam: { users: number | null };
  app: { mfds: number | null; activeUsers: number | null; clients: number | null };
};

export async function getAwsSnapshot(adminUserId: string): Promise<AwsSnapshot> {
  const cw = new CloudWatchClient(cfg);
  const ec2 = new EC2Client(cfg);
  const rds = new RDSClient(cfg);
  const iam = new IAMClient(cfg);

  // ── EC2 ──────────────────────────────────────────────────────────────────
  let instanceId: string | null = process.env.AWS_EC2_INSTANCE_ID || null;
  let ec2Type: string | null = null;
  let ec2State: string | null = null;
  let volumeGb: number | null = null;
  try {
    const di = await ec2.send(new DescribeInstancesCommand(instanceId ? { InstanceIds: [instanceId] } : {}));
    const inst = di.Reservations?.flatMap((r) => r.Instances ?? []).find((i) => i.State?.Name === "running") ?? di.Reservations?.[0]?.Instances?.[0];
    if (inst) {
      instanceId = inst.InstanceId ?? instanceId;
      ec2Type = inst.InstanceType ?? null;
      ec2State = inst.State?.Name ?? null;
    }
  } catch {
    /* leave nulls */
  }
  let ec2Health: Health = "unknown";
  let statusText = "unknown";
  if (instanceId) {
    try {
      const st = await ec2.send(new DescribeInstanceStatusCommand({ InstanceIds: [instanceId] }));
      const s = st.InstanceStatuses?.[0];
      const sys = s?.SystemStatus?.Status;
      const ins = s?.InstanceStatus?.Status;
      if (sys === "ok" && ins === "ok") {
        ec2Health = "healthy";
        statusText = "2/2 checks passed";
      } else if (sys && ins) {
        ec2Health = "critical";
        statusText = `system: ${sys}, instance: ${ins}`;
      }
    } catch {
      /* unknown */
    }
    try {
      const vols = await ec2.send(new DescribeVolumesCommand({ Filters: [{ Name: "attachment.instance-id", Values: [instanceId] }] }));
      volumeGb = (vols.Volumes ?? []).reduce((sum, v) => sum + (v.Size ?? 0), 0) || null;
    } catch {
      /* leave null */
    }
  }
  const ec2Dims = instanceId ? [{ Name: "InstanceId", Value: instanceId }] : [];
  const ec2Cpu = await metricSeries(cw, "AWS/EC2", "CPUUtilization", ec2Dims, "Average", 300, 6);
  const netIn = await metricSeries(cw, "AWS/EC2", "NetworkIn", ec2Dims, "Average", 300, 6);
  const netOut = await metricSeries(cw, "AWS/EC2", "NetworkOut", ec2Dims, "Average", 300, 6);
  // CPU credit balance — critical on burstable t-instances: at 0 the CPU throttles.
  const ec2Credit = await metricSeries(cw, "AWS/EC2", "CPUCreditBalance", ec2Dims, "Average", 300, 6);

  // ── RDS ──────────────────────────────────────────────────────────────────
  let rdsId: string | null = process.env.AWS_RDS_INSTANCE_ID || null;
  let rdsClass: string | null = null;
  let rdsEngine: string | null = null;
  let storageTotalGb: number | null = null;
  try {
    const dr = await rds.send(new DescribeDBInstancesCommand(rdsId ? { DBInstanceIdentifier: rdsId } : {}));
    const db = dr.DBInstances?.[0];
    if (db) {
      rdsId = db.DBInstanceIdentifier ?? rdsId;
      rdsClass = db.DBInstanceClass ?? null;
      rdsEngine = db.Engine ?? null;
      storageTotalGb = db.AllocatedStorage ?? null;
    }
  } catch {
    /* leave nulls */
  }
  const rdsDims = rdsId ? [{ Name: "DBInstanceIdentifier", Value: rdsId }] : [];
  const rdsCpu = await metricSeries(cw, "AWS/RDS", "CPUUtilization", rdsDims, "Average", 300, 6);
  const rdsConn = await metricSeries(cw, "AWS/RDS", "DatabaseConnections", rdsDims, "Average", 300, 6);
  const rdsFreeStore = await metricSeries(cw, "AWS/RDS", "FreeStorageSpace", rdsDims, "Average", 300, 1);
  const rdsFreeMem = await metricSeries(cw, "AWS/RDS", "FreeableMemory", rdsDims, "Average", 300, 1);
  const rdsReadIops = await metricSeries(cw, "AWS/RDS", "ReadIOPS", rdsDims, "Average", 300, 1);
  const rdsWriteIops = await metricSeries(cw, "AWS/RDS", "WriteIOPS", rdsDims, "Average", 300, 1);
  const rdsReadLat = await metricSeries(cw, "AWS/RDS", "ReadLatency", rdsDims, "Average", 300, 1);
  const rdsWriteLat = await metricSeries(cw, "AWS/RDS", "WriteLatency", rdsDims, "Average", 300, 1);
  const storageFreeGb = rdsFreeStore.latest != null ? rdsFreeStore.latest / 1024 ** 3 : null;
  const storageUsedPct =
    storageTotalGb && storageFreeGb != null ? Math.max(0, Math.min(100, ((storageTotalGb - storageFreeGb) / storageTotalGb) * 100)) : null;

  // ── S3 (daily CloudWatch storage metrics) ──────────────────────────────────
  let s3Size: number | null = null;
  let s3Objects: number | null = null;
  let s3Series: Point[] = [];
  let growthToday: number | null = null;
  let growthWeek: number | null = null;
  let growthMonth: number | null = null;
  if (S3_BUCKET) {
    // 35-day daily series so we can show today / 7-day / 30-day growth deltas.
    const size = await metricSeries(
      cw,
      "AWS/S3",
      "BucketSizeBytes",
      [{ Name: "BucketName", Value: S3_BUCKET }, { Name: "StorageType", Value: "StandardStorage" }],
      "Average",
      86400,
      35 * 24
    );
    const objs = await metricSeries(
      cw,
      "AWS/S3",
      "NumberOfObjects",
      [{ Name: "BucketName", Value: S3_BUCKET }, { Name: "StorageType", Value: "AllStorageTypes" }],
      "Average",
      86400,
      72
    );
    s3Size = size.latest;
    s3Objects = objs.latest;
    s3Series = size.series;
    // Growth = latest minus the value N days ago (nearest available datapoint).
    const valAgo = (days: number): number | null => {
      if (!size.series.length) return null;
      const target = Date.now() - days * 86400 * 1000;
      let best: Point | null = null;
      for (const p of size.series) if (!best || Math.abs(p.t - target) < Math.abs(best.t - target)) best = p;
      return best ? best.v : null;
    };
    if (s3Size != null) {
      const d1 = valAgo(1), d7 = valAgo(7), d30 = valAgo(30);
      growthToday = d1 != null ? s3Size - d1 : null;
      growthWeek = d7 != null ? s3Size - d7 : null;
      growthMonth = d30 != null ? s3Size - d30 : null;
    }
  }

  // ── IAM ────────────────────────────────────────────────────────────────────
  let iamUsers: number | null = null;
  try {
    const sum = await iam.send(new GetAccountSummaryCommand({}));
    iamUsers = sum.SummaryMap?.Users ?? null;
  } catch {
    /* leave null */
  }

  // ── App-level counts (cross-tenant via platform-admin RLS context) ─────────
  let mfds: number | null = null;
  let activeUsers: number | null = null;
  let clients: number | null = null;
  try {
    const r = await withPlatformAdmin(adminUserId, (tx) =>
      tx.execute(sql`
        SELECT
          (SELECT count(*)::int FROM tenants WHERE deleted_at IS NULL) AS mfds,
          (SELECT count(*)::int FROM users WHERE status = 'active') AS active_users,
          (SELECT count(*)::int FROM investors WHERE status <> 'closed') AS clients
      `)
    );
    const row = r.rows[0] as any;
    mfds = row?.mfds ?? null;
    activeUsers = row?.active_users ?? null;
    clients = row?.clients ?? null;
  } catch {
    /* leave nulls */
  }

  return {
    fetchedAt: Date.now(),
    region: REGION,
    ec2: {
      instanceId,
      type: ec2Type,
      state: ec2State,
      health: ec2Health,
      statusText,
      cpu: { latest: ec2Cpu.latest, series: ec2Cpu.series, health: band(ec2Cpu.latest, 70, 90) },
      networkInKb: { latest: netIn.latest != null ? netIn.latest / 1024 : null, series: netIn.series.map((p) => ({ t: p.t, v: p.v / 1024 })) },
      networkOutKb: { latest: netOut.latest != null ? netOut.latest / 1024 : null, series: netOut.series.map((p) => ({ t: p.t, v: p.v / 1024 })) },
      volumeGb,
      cpuCredits: { latest: ec2Credit.latest, series: ec2Credit.series, health: band(ec2Credit.latest, 30, 10, true) },
    },
    rds: {
      id: rdsId,
      klass: rdsClass,
      engine: rdsEngine,
      health: rdsCpu.latest != null ? band(rdsCpu.latest, 70, 90) : "unknown",
      storageTotalGb,
      storageFreeGb: storageFreeGb != null ? Math.round(storageFreeGb * 10) / 10 : null,
      storageUsedPct: storageUsedPct != null ? Math.round(storageUsedPct) : null,
      storageHealth: band(storageUsedPct, 75, 90),
      connections: rdsConn,
      cpu: { latest: rdsCpu.latest, series: rdsCpu.series, health: band(rdsCpu.latest, 70, 90) },
      freeableMemMb: rdsFreeMem.latest != null ? Math.round(rdsFreeMem.latest / 1024 ** 2) : null,
      readIops: rdsReadIops.latest != null ? Math.round(rdsReadIops.latest) : null,
      writeIops: rdsWriteIops.latest != null ? Math.round(rdsWriteIops.latest) : null,
      readLatencyMs: rdsReadLat.latest != null ? Math.round(rdsReadLat.latest * 1000 * 100) / 100 : null,
      writeLatencyMs: rdsWriteLat.latest != null ? Math.round(rdsWriteLat.latest * 1000 * 100) / 100 : null,
    },
    s3: {
      bucket: S3_BUCKET || null,
      sizeBytes: s3Size,
      objects: s3Objects,
      growthTodayBytes: growthToday,
      growthWeekBytes: growthWeek,
      growthMonthBytes: growthMonth,
      sizeSeries: s3Series,
    },
    iam: { users: iamUsers },
    app: { mfds, activeUsers, clients },
  };
}
