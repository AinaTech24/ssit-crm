"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Server, Database, HardDrive, ShieldCheck, Cpu, MemoryStick, Activity, Gauge, Users, Mail, Boxes, ShieldAlert, Bell, HeartPulse, History } from "lucide-react";
// Type-only imports — erased at build, so server-only AWS SDK / pool never leak
// into this client bundle.
import type { AwsSnapshot, Health, Point } from "@/lib/aws/monitoring";
import type { LiveSystem } from "@/lib/aws/live-system";
import type { OpsMetrics } from "@/lib/aws/ops-metrics";

const HEALTH_COLOR: Record<Health, string> = { healthy: "#10b981", warning: "#f59e0b", critical: "#ef4444", unknown: "#9ca3af" };
const HEALTH_LABEL: Record<Health, string> = { healthy: "Healthy", warning: "Warning", critical: "Critical", unknown: "Unknown" };
const MAX_HIST = 90; // ~90s of per-second history

function bandPct(v: number | null, warn: number, crit: number): Health {
  if (v == null) return "unknown";
  return v >= crit ? "critical" : v >= warn ? "warning" : "healthy";
}
/** Higher is better (e.g. 2FA adoption %). */
function bandPctInv(v: number | null): Health {
  if (v == null) return "unknown";
  return v >= 70 ? "healthy" : v >= 40 ? "warning" : "critical";
}

function Dot({ health }: { health: Health }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: HEALTH_COLOR[health] }}>
      <span className="size-2.5 rounded-full" style={{ background: HEALTH_COLOR[health], boxShadow: `0 0 0 3px ${HEALTH_COLOR[health]}22` }} />
      {HEALTH_LABEL[health]}
    </span>
  );
}

function Spark({ series, color = "#0891b2", height = 34, width = 150, fill }: { series: { v: number }[] | Point[]; color?: string; height?: number; width?: number; fill?: boolean }) {
  if (!series || series.length < 2) return <div className="text-[10px] text-muted-foreground" style={{ height }} />;
  const vs = series.map((p: any) => p.v);
  const min = Math.min(...vs), max = Math.max(...vs);
  const span = max - min || 1;
  const xy = (i: number, v: number) => `${((i / (series.length - 1)) * width).toFixed(1)},${(height - ((v - min) / span) * (height - 4) - 2).toFixed(1)}`;
  const line = series.map((p: any, i: number) => xy(i, p.v)).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} preserveAspectRatio="none" className="overflow-visible">
      {fill && <polygon points={`0,${height} ${line} ${width},${height}`} fill={color} opacity={0.12} />}
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function fmtBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
const fmtNum = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-IN"));
function fmtDur(sec: number | null): string {
  if (sec == null) return "—";
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : `${m}m`;
}

function Card({ title, icon, health, right, children }: { title: string; icon: React.ReactNode; health?: Health; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border rounded-xl bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold"><span className="text-muted-foreground">{icon}</span>{title}</div>
        {health ? <Dot health={health} /> : right}
      </div>
      {children}
    </div>
  );
}

function Metric({ label, value, sub, health }: { label: string; value: string; sub?: string; health?: Health }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-bold tabular-nums" style={health ? { color: HEALTH_COLOR[health] } : undefined}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Bar({ pct, health }: { pct: number | null; health: Health }) {
  return (
    <div className="h-2 rounded-full bg-muted overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(2, pct ?? 0))}%`, background: HEALTH_COLOR[health] }} />
    </div>
  );
}

/** Big live gauge with a value, %-bar and an accumulated sparkline. */
function LiveGauge({ icon, label, value, sub, pct, health, hist, color }: { icon: React.ReactNode; label: string; value: string; sub?: string; pct?: number | null; health: Health; hist: { v: number }[]; color?: string }) {
  const c = color ?? HEALTH_COLOR[health];
  return (
    <div className="border rounded-xl bg-card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground inline-flex items-center gap-1.5">{icon}{label}</span>
        <span className="size-2 rounded-full" style={{ background: c }} />
      </div>
      <div className="text-2xl font-bold tabular-nums" style={{ color: c }}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground -mt-1">{sub}</div>}
      {pct != null && <Bar pct={pct} health={health} />}
      <Spark series={hist} color={c} fill height={30} width={220} />
    </div>
  );
}

export function AwsMonitoringDashboard() {
  const [live, setLive] = useState<LiveSystem | null>(null);
  const [snap, setSnap] = useState<AwsSnapshot | null>(null);
  const [ops, setOps] = useState<OpsMetrics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Per-second history (client-accumulated) for live sparklines.
  const hist = useRef<{ cpu: { v: number }[]; mem: { v: number }[]; net: { v: number }[]; disk: { v: number }[] }>({ cpu: [], mem: [], net: [], disk: [] });
  const [, force] = useState(0);

  const loadLive = useCallback(async () => {
    try {
      const res = await fetch("/api/super-admin/live-system", { cache: "no-store" });
      if (!res.ok) return;
      const j: LiveSystem = await res.json();
      const push = (arr: { v: number }[], v: number | null | undefined) => { if (v != null) { arr.push({ v }); if (arr.length > MAX_HIST) arr.shift(); } };
      push(hist.current.cpu, j.cpu?.pct);
      push(hist.current.mem, j.mem?.usedPct);
      push(hist.current.disk, j.disk?.usedPct);
      push(hist.current.net, j.net ? (j.net.rxBytesPerSec + j.net.txBytesPerSec) / 1024 : null);
      setLive(j);
      setLoading(false);
      force((n) => n + 1);
    } catch { /* keep last */ }
  }, []);

  const loadSnap = useCallback(async () => {
    try {
      const res = await fetch("/api/super-admin/aws-monitoring", { cache: "no-store" });
      const j = await res.json();
      if (res.ok) { setSnap(j); setErr(null); } else setErr(j.error || "Failed to load AWS metrics.");
    } catch (e: any) { setErr(e?.message || "Network error."); }
  }, []);

  const loadOps = useCallback(async () => {
    try {
      const res = await fetch("/api/super-admin/ops-metrics", { cache: "no-store" });
      if (res.ok) setOps(await res.json());
    } catch { /* keep last */ }
  }, []);

  useEffect(() => {
    loadLive(); loadSnap(); loadOps();
    const a = setInterval(loadLive, 1000); // LIVE — every second
    const b = setInterval(loadSnap, 15000); // CloudWatch is 1–5 min granularity
    const c = setInterval(loadOps, 10000); // app/ops metrics
    return () => { clearInterval(a); clearInterval(b); clearInterval(c); };
  }, [loadLive, loadSnap, loadOps]);

  if (loading && !live) return <div className="flex items-center gap-2 text-sm text-muted-foreground py-10"><Loader2 className="size-4 animate-spin" /> Connecting…</div>;

  const memHealth = bandPct(live?.mem?.usedPct ?? null, 80, 92);
  const diskHealth = bandPct(live?.disk?.usedPct ?? null, 80, 92);
  const cpuHealth = bandPct(live?.cpu?.pct ?? null, 70, 90);
  const swapHealth = bandPct(live?.swap?.usedPct ?? null, 40, 75);
  const s = snap;

  // ── Real-time alerts (computed from thresholds) ───────────────────────────
  const alerts: { level: "critical" | "warning"; text: string }[] = [];
  const dPct = live?.disk?.usedPct ?? 0, mPct = live?.mem?.usedPct ?? 0, swPct = live?.swap?.usedPct ?? 0, cPct = live?.cpu?.pct ?? 0;
  if (dPct >= 90) alerts.push({ level: "critical", text: `Disk ${dPct}% — running out of space` });
  else if (dPct >= 80) alerts.push({ level: "warning", text: `Disk ${dPct}% used` });
  if (mPct >= 90) alerts.push({ level: "critical", text: `Memory ${mPct}%` });
  else if (mPct >= 80) alerts.push({ level: "warning", text: `Memory ${mPct}%` });
  if (swPct >= 60) alerts.push({ level: "warning", text: `Swap ${swPct}% — under memory pressure` });
  if (cPct >= 90) alerts.push({ level: "warning", text: `CPU ${cPct.toFixed(0)}%` });
  if (s?.rds?.storageUsedPct != null && s.rds.storageUsedPct >= 90) alerts.push({ level: "critical", text: `RDS storage ${s.rds.storageUsedPct}%` });
  if (s?.ec2?.health === "critical") alerts.push({ level: "critical", text: "EC2 status check failing" });
  if ((ops?.jobs?.failed ?? 0) > 0) alerts.push({ level: "warning", text: `${ops!.jobs.failed} background job(s) failed` });
  if ((ops?.email?.failedToday ?? 0) > 0) alerts.push({ level: "warning", text: `${ops!.email.failedToday} email(s) failed today` });
  if (ops?.email && !ops.email.smtpConfigured) alerts.push({ level: "warning", text: "SMTP not configured — auth emails won't send" });

  // ── Overall health score (0–100) ──────────────────────────────────────────
  let score = 100;
  const pen = (cond: boolean, pts: number) => { if (cond) score -= pts; };
  pen(cPct >= 90, 8); pen(cPct >= 70 && cPct < 90, 4);
  pen(mPct >= 90, 12); pen(mPct >= 80 && mPct < 90, 6);
  pen(dPct >= 90, 18); pen(dPct >= 80 && dPct < 90, 8);
  pen(swPct >= 60, 6);
  pen((s?.rds?.storageUsedPct ?? 0) >= 90, 12); pen((s?.rds?.storageUsedPct ?? 0) >= 75 && (s?.rds?.storageUsedPct ?? 0) < 90, 5);
  pen(s?.ec2?.health === "critical", 15);
  pen((ops?.jobs?.failed ?? 0) > 0, 5);
  pen((ops?.email?.failedToday ?? 0) > 0, 3);
  score = Math.max(0, Math.min(100, score));
  const scoreHealth: Health = score >= 90 ? "healthy" : score >= 70 ? "warning" : "critical";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-emerald-500 animate-pulse" /> Live · host {live?.hostname} · {live?.cpu?.cores} vCPU · refreshing every second
        </span>
        <span>uptime {fmtDur(live?.uptimeSec ?? null)}</span>
      </div>

      {/* ── Health score + alerts ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="border rounded-xl bg-card p-5 flex items-center gap-4">
          <div className="relative size-20 shrink-0">
            <svg viewBox="0 0 36 36" className="size-20 -rotate-90">
              <circle cx="18" cy="18" r="15.5" fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
              <circle cx="18" cy="18" r="15.5" fill="none" stroke={HEALTH_COLOR[scoreHealth]} strokeWidth="3" strokeLinecap="round"
                strokeDasharray={`${(score / 100) * 97.4} 97.4`} />
            </svg>
            <div className="absolute inset-0 grid place-items-center">
              <div className="text-center leading-none">
                <div className="text-2xl font-bold tabular-nums" style={{ color: HEALTH_COLOR[scoreHealth] }}>{score}</div>
                <div className="text-[9px] text-muted-foreground">/ 100</div>
              </div>
            </div>
          </div>
          <div>
            <div className="font-semibold inline-flex items-center gap-1.5"><HeartPulse className="size-4 text-muted-foreground" /> System Health</div>
            <Dot health={scoreHealth} />
            <p className="text-[11px] text-muted-foreground mt-1">Weighted across CPU, RAM, disk, swap, DB, EC2 status &amp; jobs.</p>
          </div>
        </div>
        <div className="border rounded-xl bg-card p-4 lg:col-span-2">
          <div className="flex items-center gap-2 font-semibold mb-2"><Bell className="size-4 text-muted-foreground" /> Alerts {alerts.length > 0 && <span className="text-xs rounded-full bg-rose-100 text-rose-700 px-2">{alerts.length}</span>}</div>
          {alerts.length === 0 ? (
            <div className="text-sm text-emerald-600 inline-flex items-center gap-1.5"><ShieldCheck className="size-4" /> All clear — no active alerts.</div>
          ) : (
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {alerts.map((a, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="size-2 rounded-full shrink-0" style={{ background: a.level === "critical" ? HEALTH_COLOR.critical : HEALTH_COLOR.warning }} />
                  {a.text}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── LIVE host gauges (per-second) ─────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <LiveGauge icon={<Cpu className="size-3.5" />} label="CPU" health={cpuHealth} hist={hist.current.cpu}
          value={live?.cpu?.pct != null ? `${live.cpu.pct.toFixed(1)}%` : "—"} pct={live?.cpu?.pct ?? null}
          sub={live?.load ? `load ${live.load.l1.toFixed(2)} · ${live.load.l5.toFixed(2)} · ${live.load.l15.toFixed(2)}` : undefined} />
        <LiveGauge icon={<MemoryStick className="size-3.5" />} label="Memory" health={memHealth} hist={hist.current.mem}
          value={live?.mem ? `${live.mem.usedPct}%` : "—"} pct={live?.mem?.usedPct ?? null}
          sub={live?.mem ? `${fmtBytes(live.mem.used)} / ${fmtBytes(live.mem.total)} · ${fmtBytes(live.mem.available)} free` : undefined} />
        <LiveGauge icon={<HardDrive className="size-3.5" />} label="Disk" health={diskHealth} hist={hist.current.disk}
          value={live?.disk ? `${live.disk.usedPct}%` : "—"} pct={live?.disk?.usedPct ?? null}
          sub={live?.disk ? `${fmtBytes(live.disk.used)} / ${fmtBytes(live.disk.total)} · ${fmtBytes(live.disk.free)} free` : undefined} />
        <LiveGauge icon={<Activity className="size-3.5" />} label="Network" health="healthy" color="#0891b2" hist={hist.current.net}
          value={live?.net ? `${fmtBytes(live.net.rxBytesPerSec + live.net.txBytesPerSec)}/s` : "—"}
          sub={live?.net ? `↓ ${fmtBytes(live.net.rxBytesPerSec)}/s  ↑ ${fmtBytes(live.net.txBytesPerSec)}/s` : undefined} />
      </div>

      {/* Swap (often the tell on this box) */}
      {live?.swap && (
        <div className="border rounded-xl bg-card p-4 flex items-center gap-4">
          <Gauge className="size-4 text-muted-foreground" />
          <div className="flex-1">
            <div className="flex items-center justify-between text-xs mb-1"><span className="text-muted-foreground">Swap</span><span className="tabular-nums">{live.swap.usedPct}% · {fmtBytes(live.swap.used)} / {fmtBytes(live.swap.total)}</span></div>
            <Bar pct={live.swap.usedPct} health={swapHealth} />
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">{live.procs != null ? `${live.procs} procs` : ""}</div>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
        <span>AWS CloudWatch · region {s?.region ?? "…"} · updates every 1–5 min</span>
        <button onClick={loadSnap} className="inline-flex items-center gap-1.5 hover:text-foreground"><RefreshCw className="size-3.5" /> {s ? `synced ${new Date(s.fetchedAt).toLocaleTimeString("en-IN")}` : "loading…"}</button>
      </div>

      {/* ── AWS / CloudWatch detail ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {s && (
          <>
            <Card title="EC2 — instance" icon={<Server className="size-4" />} health={s.ec2.health}>
              <div className="text-xs text-muted-foreground">{s.ec2.instanceId} · {s.ec2.type} · {s.ec2.state} · {s.ec2.statusText}</div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1"><Metric label="CPU (5-min avg)" value={s.ec2.cpu.latest != null ? `${s.ec2.cpu.latest.toFixed(1)}%` : "—"} health={s.ec2.cpu.health} /><Spark series={s.ec2.cpu.series} color={HEALTH_COLOR[s.ec2.cpu.health]} /></div>
                <div className="space-y-1"><Metric label="CPU credits" value={fmtNum(s.ec2.cpuCredits.latest)} sub="burst balance (t-class)" health={s.ec2.cpuCredits.health} /><Spark series={s.ec2.cpuCredits.series} color={HEALTH_COLOR[s.ec2.cpuCredits.health]} /></div>
                <Metric label="Root volume" value={s.ec2.volumeGb != null ? `${s.ec2.volumeGb} GB` : "—"} />
                <Metric label="Net in / out" value={`${fmtNum(s.ec2.networkInKb.latest)} / ${fmtNum(s.ec2.networkOutKb.latest)} KB/s`} />
              </div>
            </Card>

            <Card title="RDS — Postgres" icon={<Database className="size-4" />} health={s.rds.health}>
              <div className="text-xs text-muted-foreground">{s.rds.id} · {s.rds.klass} · {s.rds.engine}</div>
              <div>
                <div className="flex items-center justify-between text-xs mb-1"><span className="text-muted-foreground">Storage</span><span className="tabular-nums">{s.rds.storageUsedPct != null ? `${s.rds.storageUsedPct}% used` : "—"} · {s.rds.storageFreeGb != null ? `${s.rds.storageFreeGb} GB free` : "—"} / {s.rds.storageTotalGb ?? "—"} GB</span></div>
                <Bar pct={s.rds.storageUsedPct} health={s.rds.storageHealth} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1"><Metric label="CPU" value={s.rds.cpu.latest != null ? `${s.rds.cpu.latest.toFixed(1)}%` : "—"} health={s.rds.cpu.health} /><Spark series={s.rds.cpu.series} color={HEALTH_COLOR[s.rds.cpu.health]} height={26} width={90} /></div>
                <Metric label="Connections" value={fmtNum(s.rds.connections.latest)} />
                <Metric label="Free mem" value={s.rds.freeableMemMb != null ? `${s.rds.freeableMemMb} MB` : "—"} />
                <Metric label="Read IOPS" value={fmtNum(s.rds.readIops)} />
                <Metric label="Write IOPS" value={fmtNum(s.rds.writeIops)} />
                <Metric label="R/W latency" value={`${s.rds.readLatencyMs ?? "—"} / ${s.rds.writeLatencyMs ?? "—"} ms`} />
              </div>
            </Card>

            <Card title="S3 — document storage" icon={<HardDrive className="size-4" />}>
              <div className="text-xs text-muted-foreground break-all">{s.s3.bucket ?? "bucket not configured"}</div>
              <div className="grid grid-cols-2 gap-4">
                <Metric label="Total size" value={fmtBytes(s.s3.sizeBytes)} sub="StandardStorage (daily)" />
                <Metric label="Objects" value={fmtNum(s.s3.objects)} sub="total documents" />
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1">
                <Metric label="Today" value={s.s3.growthTodayBytes != null ? `+${fmtBytes(s.s3.growthTodayBytes)}` : "—"} />
                <Metric label="This week" value={s.s3.growthWeekBytes != null ? `+${fmtBytes(s.s3.growthWeekBytes)}` : "—"} />
                <Metric label="This month" value={s.s3.growthMonthBytes != null ? `+${fmtBytes(s.s3.growthMonthBytes)}` : "—"} />
              </div>
              {s.s3.sizeSeries.length > 1 && <Spark series={s.s3.sizeSeries} color="#0891b2" fill height={32} width={300} />}
              <p className="text-[11px] text-muted-foreground">Per-folder &amp; large-file breakdown needs S3 Inventory — later pass.</p>
            </Card>

            <Card title="IAM &amp; platform" icon={<ShieldCheck className="size-4" />}>
              <div className="grid grid-cols-2 gap-4">
                <Metric label="IAM users" value={fmtNum(s.iam.users)} />
                <Metric label="MFD tenants" value={fmtNum(s.app.mfds)} />
                <Metric label="Active users" value={fmtNum(s.app.activeUsers)} />
                <Metric label="Clients (investors)" value={fmtNum(s.app.clients)} />
              </div>
            </Card>
          </>
        )}
      </div>

      {/* ── Application / operational metrics (10s) ────────────────────────── */}
      <div className="text-xs text-muted-foreground pt-1">Application metrics · refreshes every 10s{ops ? ` · updated ${new Date(ops.fetchedAt).toLocaleTimeString("en-IN")}` : ""}</div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {ops && (
          <>
            <Card title="User activity" icon={<Users className="size-4" />}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Metric label="Online now" value={fmtNum(ops.users.onlineNow)} sub="last 15 min" health={ops.users.onlineNow > 0 ? "healthy" : "unknown"} />
                <Metric label="Logged in today" value={fmtNum(ops.users.loggedInToday)} />
                <Metric label="New today" value={fmtNum(ops.users.newToday)} />
                <Metric label="Active / total" value={`${fmtNum(ops.users.active)} / ${fmtNum(ops.users.total)}`} />
              </div>
            </Card>

            <Card title="Email (SMTP)" icon={<Mail className="size-4" />} health={ops.email.smtpConfigured ? (ops.email.failedToday > 0 ? "warning" : "healthy") : "warning"}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Metric label="Sent today" value={fmtNum(ops.email.sentToday)} />
                <Metric label="Failed today" value={fmtNum(ops.email.failedToday)} health={ops.email.failedToday > 0 ? "warning" : undefined} />
                <Metric label="Queued" value={fmtNum(ops.email.queued)} />
                <Metric label="SMTP" value={ops.email.smtpConfigured ? "Connected" : "Off"} health={ops.email.smtpConfigured ? "healthy" : "warning"} />
              </div>
            </Card>

            <Card title="Background jobs" icon={<Boxes className="size-4" />} health={ops.jobs.failed > 0 ? "warning" : "healthy"}>
              <div className="grid grid-cols-4 gap-3">
                <Metric label="Running" value={fmtNum(ops.jobs.active)} />
                <Metric label="Queued" value={fmtNum(ops.jobs.waiting + ops.jobs.delayed)} />
                <Metric label="Failed" value={fmtNum(ops.jobs.failed)} health={ops.jobs.failed > 0 ? "warning" : undefined} />
                <Metric label="Queues" value={fmtNum(ops.jobs.queues.length)} />
              </div>
              <div className="text-[11px] text-muted-foreground space-y-0.5 max-h-24 overflow-y-auto">
                {ops.jobs.queues.map((q) => (
                  <div key={q.name} className="flex justify-between"><span className="font-mono truncate">{q.name}</span><span className="tabular-nums">{q.active}▶ {q.waiting + q.delayed}⏳ {q.failed > 0 ? <span className="text-rose-600">{q.failed}✕</span> : "0✕"}</span></div>
                ))}
              </div>
            </Card>

            <Card title="Security" icon={<ShieldAlert className="size-4" />}>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Metric label="Password resets today" value={fmtNum(ops.security.passwordResetsToday)} />
                <Metric label="2FA enabled" value={ops.security.twoFaPct != null ? `${ops.security.twoFaPct}%` : "—"} health={ops.security.twoFaPct != null ? bandPctInv(ops.security.twoFaPct) : "unknown"} />
                <Metric label="Suspended" value={fmtNum(ops.security.suspended)} health={ops.security.suspended > 0 ? "warning" : undefined} />
              </div>
              <p className="text-[11px] text-muted-foreground">Failed-login tracking isn&apos;t logged to the DB yet (rate-limited only).</p>
            </Card>

            <Card title="Application (Node)" icon={<Activity className="size-4" />}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Metric label="Heap" value={`${ops.app.heapUsedMb} / ${ops.app.heapTotalMb} MB`} />
                <Metric label="RSS" value={`${ops.app.rssMb} MB`} />
                <Metric label="Event-loop lag" value={`${ops.app.eventLoopLagMs} ms`} health={bandPct(ops.app.eventLoopLagMs, 50, 200)} />
                <Metric label="Process uptime" value={fmtDur(ops.app.uptimeSec)} />
              </div>
            </Card>

            <Card title="Tenant analytics" icon={<Database className="size-4" />} right={<span className="text-xs text-muted-foreground">{ops.tenants.total} tenants</span>}>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {ops.tenants.top.map((t, i) => {
                  const max = ops.tenants.top[0]?.users || 1;
                  return (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="truncate flex-1">{t.name}</span>
                      <div className="w-24 h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-brand-cyan" style={{ width: `${Math.max(4, (t.users / max) * 100)}%` }} /></div>
                      <span className="tabular-nums w-8 text-right text-muted-foreground">{t.users}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </>
        )}
      </div>

      {/* ── Audit activity feed ───────────────────────────────────────────── */}
      {ops && ops.audit.length > 0 && (
        <div className="border rounded-xl bg-card p-5">
          <div className="flex items-center gap-2 font-semibold mb-3"><History className="size-4 text-muted-foreground" /> Recent activity</div>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {ops.audit.map((a, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className="text-xs text-muted-foreground tabular-nums w-16 shrink-0">{new Date(a.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
                <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted shrink-0">{a.actor}</span>
                <span className="truncate">{a.action}{a.entity ? ` · ${a.entity}` : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {err && <div className="text-xs text-amber-600">AWS sync failed ({err}) — live host metrics above are unaffected.</div>}
    </div>
  );
}
