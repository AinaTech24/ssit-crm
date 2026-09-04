/**
 * Operational metrics for the Equitywala Admin → AWS Monitoring dashboard — the
 * application-level signals that complement the infra metrics: user activity,
 * email throughput, background-job queues, security, an audit feed, the Node
 * process health, and per-tenant analytics.
 *
 * Cross-tenant reads run under withPlatformAdmin (RLS shows every tenant).
 * Platform-admin only (gated at the route).
 */
import { sql } from "drizzle-orm";
import { withPlatformAdmin } from "@/db/client";
import { Q } from "@/workers/queues";

export type AuditEvent = { at: number; action: string; actor: string; entity: string | null };
export type QueueStat = { name: string; active: number; waiting: number; failed: number; delayed: number };

export type OpsMetrics = {
  fetchedAt: number;
  users: { total: number; active: number; onlineNow: number; loggedInToday: number; newToday: number };
  email: { sentToday: number; failedToday: number; queued: number; skippedToday: number; smtpConfigured: boolean };
  jobs: { active: number; waiting: number; failed: number; delayed: number; queues: QueueStat[] };
  security: { passwordResetsToday: number; twoFaPct: number | null; suspended: number };
  audit: AuditEvent[];
  app: { heapUsedMb: number; heapTotalMb: number; rssMb: number; externalMb: number; uptimeSec: number; eventLoopLagMs: number };
  tenants: { total: number; top: { name: string; users: number }[] };
};

const FIXED_QUEUES: Array<[string, () => any]> = [
  ["workflow.runner", () => Q.workflowRunner()],
  ["outbox.poller", () => Q.outboxPoller()],
  ["segment.materializer", () => Q.segmentMaterializer()],
  ["master.scheduler", () => Q.masterScheduler()],
  ["vartify.template_sync", () => Q.vartifyTemplateSync()],
  ["rta.import", () => Q.rtaImport()],
];

async function eventLoopLagMs(): Promise<number> {
  const start = process.hrtime.bigint();
  await new Promise((r) => setTimeout(r, 0));
  const ns = Number(process.hrtime.bigint() - start);
  return Math.round((ns / 1e6) * 100) / 100;
}

export async function getOpsMetrics(adminUserId: string, smtpConfigured: boolean): Promise<OpsMetrics> {
  // ── Background jobs (BullMQ / Redis) — never let one bad queue sink the rest ──
  const queues: QueueStat[] = [];
  for (const [name, get] of FIXED_QUEUES) {
    try {
      const counts = await get().getJobCounts("active", "waiting", "failed", "delayed");
      queues.push({ name, active: counts.active ?? 0, waiting: counts.waiting ?? 0, failed: counts.failed ?? 0, delayed: counts.delayed ?? 0 });
    } catch {
      queues.push({ name, active: 0, waiting: 0, failed: 0, delayed: 0 });
    }
  }
  const jobs = {
    active: queues.reduce((n, q) => n + q.active, 0),
    waiting: queues.reduce((n, q) => n + q.waiting, 0),
    failed: queues.reduce((n, q) => n + q.failed, 0),
    delayed: queues.reduce((n, q) => n + q.delayed, 0),
    queues,
  };

  // ── DB metrics (cross-tenant via platform-admin RLS) ───────────────────────
  const db = await withPlatformAdmin(adminUserId, async (tx) => {
    const users = (
      await tx.execute(sql`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE status = 'active')::int AS active,
          count(*) FILTER (WHERE last_login_at >= now() - interval '15 minutes')::int AS online_now,
          count(*) FILTER (WHERE last_login_at >= date_trunc('day', now()))::int AS logged_in_today,
          count(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS new_today,
          count(*) FILTER (WHERE two_fa_enabled)::int AS two_fa,
          count(*) FILTER (WHERE status = 'suspended')::int AS suspended
        FROM users
      `)
    ).rows[0] as any;

    const email = (
      await tx.execute(sql`
        SELECT
          count(*) FILTER (WHERE status IN ('sent','delivered') AND created_at >= date_trunc('day', now()))::int AS sent,
          count(*) FILTER (WHERE status IN ('failed','bounced','undelivered') AND created_at >= date_trunc('day', now()))::int AS failed,
          count(*) FILTER (WHERE status IN ('queued','scheduled'))::int AS queued,
          count(*) FILTER (WHERE status LIKE 'skipped%' AND created_at >= date_trunc('day', now()))::int AS skipped
        FROM communications WHERE channel = 'email'
      `)
    ).rows[0] as any;

    const pr = (
      await tx.execute(sql`SELECT count(*)::int AS n FROM password_resets WHERE created_at >= date_trunc('day', now())`)
    ).rows[0] as any;

    const tenantsTotal = (await tx.execute(sql`SELECT count(*)::int AS n FROM tenants WHERE deleted_at IS NULL`)).rows[0] as any;
    const topTenants = (
      await tx.execute(sql`
        SELECT coalesce(t.display_name, t.legal_name, 'Tenant') AS name, count(u.id)::int AS users
        FROM tenants t LEFT JOIN users u ON u.tenant_id = t.id
        WHERE t.deleted_at IS NULL
        GROUP BY t.id, t.display_name, t.legal_name
        ORDER BY count(u.id) DESC NULLS LAST
        LIMIT 8
      `)
    ).rows as any[];

    const auditRows = (
      await tx.execute(sql`
        SELECT (extract(epoch from "at") * 1000)::bigint AS at_ms, action, actor_type, entity_type
        FROM audit_log ORDER BY "at" DESC LIMIT 14
      `)
    ).rows as any[];

    return { users, email, pr, tenantsTotal, topTenants, auditRows };
  });

  const mem = process.memoryUsage();
  const activeUsers = Number(db.users?.active ?? 0);
  const twoFa = Number(db.users?.two_fa ?? 0);

  return {
    fetchedAt: Date.now(),
    users: {
      total: Number(db.users?.total ?? 0),
      active: activeUsers,
      onlineNow: Number(db.users?.online_now ?? 0),
      loggedInToday: Number(db.users?.logged_in_today ?? 0),
      newToday: Number(db.users?.new_today ?? 0),
    },
    email: {
      sentToday: Number(db.email?.sent ?? 0),
      failedToday: Number(db.email?.failed ?? 0),
      queued: Number(db.email?.queued ?? 0),
      skippedToday: Number(db.email?.skipped ?? 0),
      smtpConfigured,
    },
    jobs,
    security: {
      passwordResetsToday: Number(db.pr?.n ?? 0),
      twoFaPct: activeUsers > 0 ? Math.round((twoFa / activeUsers) * 100) : null,
      suspended: Number(db.users?.suspended ?? 0),
    },
    audit: (db.auditRows ?? []).map((r: any) => ({
      at: Number(r.at_ms),
      action: String(r.action ?? ""),
      actor: String(r.actor_type ?? "user"),
      entity: r.entity_type ?? null,
    })),
    app: {
      heapUsedMb: Math.round(mem.heapUsed / 1024 ** 2),
      heapTotalMb: Math.round(mem.heapTotal / 1024 ** 2),
      rssMb: Math.round(mem.rss / 1024 ** 2),
      externalMb: Math.round((mem.external ?? 0) / 1024 ** 2),
      uptimeSec: Math.round(process.uptime()),
      eventLoopLagMs: await eventLoopLagMs(),
    },
    tenants: {
      total: Number(db.tenantsTotal?.n ?? 0),
      top: (db.topTenants ?? []).map((r: any) => ({ name: String(r.name ?? "Tenant"), users: Number(r.users ?? 0) })),
    },
  };
}
