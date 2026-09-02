/**
 * Automation Control Tower — the runs monitor / trust surface.
 *
 * One screen that answers "can I rely on the automation engine?": run volume
 * & failure rate, what's in-flight, recent failures (with one-click re-queue),
 * the event-spine (outbox) backlog, and message delivery. Owners lean on
 * automation only when they can see it working.
 */

import Link from "next/link";
import {
  Activity, AlertTriangle, CheckCircle2, Clock, Send, Inbox, GitBranch, XCircle, Zap, Timer,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { withTenant } from "@/db/client";
import { getAutomationHealth, canViewMonitor } from "@/lib/automation/control-tower";
import { RetryButton } from "@/components/automation/RetryButton";
import { RefreshButton } from "@/components/automation/RefreshButton";

const RULE_STATUS_TONE: Record<string, string> = {
  succeeded: "bg-emerald-50 text-emerald-700 border-emerald-200",
  partial: "bg-amber-50 text-amber-700 border-amber-200",
  failed: "bg-rose-50 text-rose-700 border-rose-200",
  skipped: "bg-slate-50 text-slate-700 border-slate-200",
};

export const dynamic = "force-dynamic";

const WINDOWS = [
  { v: 1, label: "24h" },
  { v: 7, label: "7 days" },
  { v: 30, label: "30 days" },
];

const RUN_STATUS_TONE: Record<string, string> = {
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  running: "bg-sky-50 text-sky-700 border-sky-200",
  queued: "bg-slate-50 text-slate-700 border-slate-200",
  paused: "bg-amber-50 text-amber-700 border-amber-200",
  failed: "bg-rose-50 text-rose-700 border-rose-200",
  cancelled: "bg-muted text-muted-foreground border-border",
};

export default async function AutomationControlTower({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const allowed = canViewMonitor(session.roles, session.permissions);

  const sp = await searchParams;
  const windowDays = [1, 7, 30].includes(Number(sp.window)) ? Number(sp.window) : 7;

  if (!allowed) {
    return (
      <div className="max-w-2xl card-surface p-8 text-center text-sm text-muted-foreground">
        You don't have access to the automation monitor.
      </div>
    );
  }

  const health = await withTenant(
    session.tenantId,
    async (tx) => getAutomationHealth(tx as any, session.tenantId, windowDays),
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header + window selector */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="size-6 text-brand-cyan" /> Automation Control Tower
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-0.5 gap-0.5">
            {WINDOWS.map((w) => (
              <Link
                key={w.v}
                href={`/dashboard/workflows/runs?window=${w.v}`}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${windowDays === w.v ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                {w.label}
              </Link>
            ))}
          </div>
          <RefreshButton />
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        <Tile icon={GitBranch} label="Runs" value={health.runs.total} sub={`${health.impact.runsCompleted} completed`} />
        <Tile
          icon={AlertTriangle}
          label="Failed"
          value={health.runs.failed}
          sub={`${health.runs.failureRatePct}% failure rate`}
          tone={health.runs.failed > 0 ? "rose" : "emerald"}
        />
        <Tile icon={Clock} label="In-flight" value={health.runs.inFlight} sub="running + paused" tone={health.runs.inFlight > 0 ? "sky" : undefined} />
        <Tile
          icon={Zap}
          label="Rules fired"
          value={health.impact.rulesFired}
          sub={health.rules.failed > 0 ? `${health.rules.failed} failed/partial` : "all clean"}
          tone={health.rules.failed > 0 ? "rose" : undefined}
        />
        <Tile icon={Send} label="Messages sent" value={health.impact.messagesSent} sub={`${health.comms.skipped} skipped`} />
        <Tile
          icon={Inbox}
          label="Outbox pending"
          value={health.outbox.pending}
          sub={health.outbox.stuck > 0 ? `${health.outbox.stuck} stuck >1h` : "spine healthy"}
          tone={health.outbox.stuck > 0 ? "rose" : health.outbox.pending > 0 ? "amber" : "emerald"}
        />
      </div>

      {/* Run status breakdown */}
      <div className="card-surface p-4">
        <h2 className="font-semibold text-sm mb-3">Run status ({windowDays === 1 ? "24h" : `${windowDays}d`})</h2>
        {health.runs.total === 0 ? (
          <p className="text-sm text-muted-foreground">No runs in this window.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {Object.entries(health.runs.byStatus).map(([status, count]) => (
              <span key={status} className={`text-xs px-2.5 py-1 rounded-full border tabular-nums ${RUN_STATUS_TONE[status] ?? "bg-muted"}`}>
                {status} · {count}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Failed runs — with retry */}
      <div className="card-surface overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between bg-secondary/30">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <XCircle className="size-4 text-rose-500" /> Recent failed runs
          </h2>
          <span className="text-xs text-muted-foreground">
            {health.recentFailedRuns.length < health.runs.failed
              ? `showing ${health.recentFailedRuns.length} of ${health.runs.failed}`
              : `${health.runs.failed} in window`}
          </span>
        </div>
        {health.recentFailedRuns.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
            <CheckCircle2 className="size-7 text-emerald-500" /> No failed runs — clean window.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Workflow</th>
                <th className="text-left py-2 font-medium">Subject</th>
                <th className="text-left py-2 font-medium">Error</th>
                <th className="text-left py-2 font-medium">When</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {health.recentFailedRuns.map((r) => (
                <tr key={r.id} className="border-b last:border-0 align-top">
                  <td className="px-4 py-2.5 font-medium">
                    <Link href={`/dashboard/workflows/runs/${r.id}`} className="hover:underline">{r.workflowName}</Link>
                  </td>
                  <td className="py-2.5 text-xs text-muted-foreground capitalize">{r.subjectType ?? "—"}</td>
                  <td className="py-2.5 text-xs text-rose-600 max-w-[280px] truncate" title={r.error ?? ""}>{r.error ?? "—"}</td>
                  <td className="py-2.5 text-xs text-muted-foreground tabular-nums whitespace-nowrap">{fmt(r.at)}</td>
                  <td className="px-4 py-2.5 text-right"><RetryButton endpoint={`/api/workflows/runs/${r.id}/retry`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Workflow Rules — the Zoho-style rules engine (separate from runs) */}
      <div className="card-surface overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between bg-secondary/30">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Zap className="size-4 text-brand-cyan" /> Workflow Rules ({windowDays === 1 ? "24h" : `${windowDays}d`})
          </h2>
          <Link href="/dashboard/workflows/rules" className="text-xs text-brand-cyan-deep hover:underline">Manage rules →</Link>
        </div>
        <div className="p-4 space-y-3">
          {health.rules.total === 0 ? (
            <p className="text-sm text-muted-foreground">No rule executions in this window.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {Object.entries(health.rules.byStatus).map(([status, count]) => (
                <span key={status} className={`text-xs px-2.5 py-1 rounded-full border tabular-nums ${RULE_STATUS_TONE[status] ?? "bg-muted"}`}>
                  {status} · {count}
                </span>
              ))}
            </div>
          )}
          {health.rules.recentFailed.length > 0 && (
            <div className="border-t pt-3">
              <div className="text-xs font-medium text-muted-foreground mb-2">
                Recent failed / partial
                {health.rules.recentFailed.length < health.rules.failed ? ` (showing ${health.rules.recentFailed.length} of ${health.rules.failed})` : ""}
              </div>
              <ul className="space-y-1.5">
                {health.rules.recentFailed.map((r) => (
                  <li key={r.id} className="text-xs border-b last:border-0 pb-1.5 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span>
                        <Link href={`/dashboard/workflows/rules/${r.ruleId}`} className="font-medium hover:underline">{r.ruleName}</Link>
                        <span className={`ml-2 px-1.5 py-0.5 rounded border ${RULE_STATUS_TONE[r.status] ?? ""}`}>{r.status}</span>
                      </span>
                      <div className="text-rose-600 truncate" title={r.reason ?? ""}>{r.reason ?? "—"}</div>
                    </div>
                    <span className="text-muted-foreground tabular-nums whitespace-nowrap">{fmt(r.at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Scheduled rule jobs — pending/failed/overdue, with re-queue */}
      <div className="card-surface overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between bg-secondary/30">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Timer className="size-4" /> Scheduled rule jobs
          </h2>
          <div className="flex items-center gap-3">
            {health.scheduledJobs.overdue > 0 && (
              <span className="text-xs text-rose-600 font-medium">{health.scheduledJobs.overdue} overdue &gt;1h</span>
            )}
            {health.scheduledJobs.failed > 0 && (
              <RetryButton endpoint="/api/workflow-rules/scheduled-jobs/retry-all" label={`Retry all (${health.scheduledJobs.failed})`} doneLabel="Re-queued all" title="Re-queue every failed scheduled job" />
            )}
          </div>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex flex-wrap gap-5">
            <MiniStat label="Pending" value={health.scheduledJobs.pending} tone={health.scheduledJobs.overdue > 0 ? "amber" : undefined} />
            <MiniStat label="Running" value={health.scheduledJobs.running} />
            <MiniStat label="Failed" value={health.scheduledJobs.failed} tone={health.scheduledJobs.failed > 0 ? "rose" : "emerald"} />
            <MiniStat label="Cancelled" value={health.scheduledJobs.cancelled} />
          </div>
          {health.scheduledJobs.recentFailed.length === 0 ? (
            <p className="text-xs text-muted-foreground">No failed scheduled jobs.</p>
          ) : (
            <ul className="space-y-1.5 border-t pt-3">
              {health.scheduledJobs.recentFailed.map((j) => (
                <li key={j.id} className="text-xs border-b last:border-0 pb-1.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-medium capitalize">{j.actionType.replace(/_/g, " ")}</span>
                    <span className="text-muted-foreground"> · {j.attempts} attempt{j.attempts === 1 ? "" : "s"}</span>
                    <div className="text-rose-600 truncate" title={j.lastError ?? ""}>{j.lastError ?? "failed"}</div>
                  </div>
                  <RetryButton endpoint={`/api/workflow-rules/scheduled-jobs/${j.id}/retry`} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Two-up: outbox + comms */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Event spine */}
        <div className="card-surface p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-sm flex items-center gap-2">
              <Inbox className="size-4" /> Event spine (outbox)
            </h2>
            {health.outbox.recentErrors.length > 0 && (
              <RetryButton endpoint="/api/automation/outbox/retry-all" label="Retry all" doneLabel="Re-queued all" title="Clear errors on every stuck event so the poller retries them" />
            )}
          </div>
          <div className="flex gap-4 mb-3">
            <MiniStat label="Pending" value={health.outbox.pending} tone={health.outbox.pending > 0 ? "amber" : "emerald"} />
            <MiniStat label="Stuck >1h" value={health.outbox.stuck} tone={health.outbox.stuck > 0 ? "rose" : "emerald"} />
          </div>
          {health.outbox.recentErrors.length === 0 ? (
            <p className="text-xs text-muted-foreground">No unprocessed events with errors. The poller is draining cleanly.</p>
          ) : (
            <ul className="space-y-1.5">
              {health.outbox.recentErrors.map((e) => (
                <li key={e.id} className="text-xs border-b last:border-0 pb-1.5 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-mono">{e.kind}</span>{" "}
                    <span className="text-muted-foreground">· {e.attempts} attempt{e.attempts === 1 ? "" : "s"}</span>
                    <div className="text-rose-600 truncate" title={e.lastError}>{e.lastError}</div>
                  </div>
                  <RetryButton endpoint={`/api/automation/outbox/${e.id}/retry`} title="Clear the error so the poller retries this event" />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Message delivery */}
        <div className="card-surface p-4">
          <h2 className="font-semibold text-sm flex items-center gap-2 mb-3">
            <Send className="size-4" /> Message delivery
          </h2>
          <div className="flex flex-wrap gap-4 mb-3">
            <MiniStat label="Delivered" value={health.comms.delivered} tone="emerald" />
            <MiniStat label="Queued" value={health.comms.queued} />
            <MiniStat label="Skipped" value={health.comms.skipped} tone={health.comms.skipped > 0 ? "amber" : undefined} />
            <MiniStat label="Failed" value={health.comms.failed} tone={health.comms.failed > 0 ? "rose" : "emerald"} />
          </div>
          {health.comms.recentFailed.length === 0 ? (
            <p className="text-xs text-muted-foreground">No failed/bounced messages in this window.</p>
          ) : (
            <ul className="space-y-1.5">
              {health.comms.recentFailed.map((c) => (
                <li key={c.id} className="text-xs border-b last:border-0 pb-1.5 flex items-center justify-between gap-2">
                  <span className="capitalize font-medium">{c.channel}</span>
                  <span className="text-rose-600 truncate flex-1 text-right" title={c.reason ?? ""}>{c.reason ?? "failed"}</span>
                  <span className="text-muted-foreground tabular-nums whitespace-nowrap">{fmt(c.at)}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/dashboard/communications" className="inline-block mt-3 text-xs font-medium text-brand-cyan-deep hover:underline">
            Open communications →
          </Link>
        </div>
      </div>
    </div>
  );
}

function Tile({ icon: Icon, label, value, sub, tone }: { icon: any; label: string; value: number; sub?: string; tone?: "rose" | "amber" | "sky" | "emerald" }) {
  const valCls =
    tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : tone === "sky" ? "text-sky-600" : tone === "emerald" ? "text-emerald-600" : "";
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</span>
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${valCls}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone?: "rose" | "amber" | "emerald" }) {
  const cls =
    tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : tone === "emerald" ? "text-emerald-600" : "";
  return (
    <div>
      <div className={`text-xl font-bold tabular-nums ${cls}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function fmt(v: any): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
