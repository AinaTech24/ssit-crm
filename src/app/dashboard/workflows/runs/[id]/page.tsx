import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, asc } from "drizzle-orm";
import { ChevronLeft, Play, Pause, Check, X } from "lucide-react";
import { withTenant } from "@/db/client";
import { workflowRuns, workflowRunSteps, workflows } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { canViewMonitor } from "@/lib/automation/control-tower";
import { formatDate, formatRelative } from "@/lib/utils";

const STATUS_ICONS: Record<string, any> = {
  queued: Pause,
  running: Play,
  paused: Pause,
  completed: Check,
  failed: X,
  cancelled: X,
};
const STATUS_COLORS: Record<string, string> = {
  queued: "text-muted-foreground",
  running: "text-blue-600",
  paused: "text-amber-600",
  completed: "text-emerald-600",
  failed: "text-rose-600",
  cancelled: "text-gray-600",
};

export const dynamic = "force-dynamic";

export default async function WorkflowRunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  // Run detail exposes the error trace + run variables (which can hold investor
  // PII). Gate it like the monitor list + the sidebar link — not just any
  // logged-in user. 404 rather than 403 so we don't reveal run existence.
  if (!canViewMonitor(session.roles, session.permissions)) notFound();
  const data = await withTenant(session.tenantId, async (tx) => {
    const run = (await tx
      .select()
      .from(workflowRuns)
      .where(and(eq(workflowRuns.id, id), eq(workflowRuns.tenantId, session.tenantId)))
      .limit(1))[0];
    if (!run) return null;
    const wf = (await tx
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, run.workflowId), eq(workflows.tenantId, session.tenantId)))
      .limit(1))[0];
    const steps = await tx
      .select()
      .from(workflowRunSteps)
      .where(and(eq(workflowRunSteps.runId, id), eq(workflowRunSteps.tenantId, session.tenantId)))
      .orderBy(asc(workflowRunSteps.startedAt));
    return { run, wf, steps };
  });
  if (!data) notFound();

  const StatusIcon = STATUS_ICONS[data.run.status] ?? Pause;

  return (
    <div className="space-y-6 max-w-5xl">
      <Link
        href={`/dashboard/workflows/${data.run.workflowId}`}
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to workflow
      </Link>

      <div className="border rounded-lg bg-card p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Run for {data.wf?.name ?? "—"}
            </h1>
            <div className="flex items-center gap-3 mt-1 text-sm">
              <span className={`flex items-center gap-1 ${STATUS_COLORS[data.run.status]}`}>
                <StatusIcon className="size-4" />
                <span className="capitalize">{data.run.status}</span>
              </span>
              <span className="text-muted-foreground">triggered {formatRelative(data.run.createdAt)} by {data.run.triggeredBy}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1 font-mono">
              run: {data.run.id.slice(0, 8)} · {data.run.subjectType ?? "no subject"}
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            Started {data.run.startedAt ? formatRelative(data.run.startedAt) : "—"}<br />
            Completed {data.run.completedAt ? formatRelative(data.run.completedAt) : "—"}
          </div>
        </div>
        {data.run.error && (
          <div className="mt-4 border-l-4 border-rose-500 bg-rose-50 p-3 text-sm text-rose-900">
            <div className="font-medium">Error</div>
            <div className="mt-1 font-mono text-xs">{data.run.error}</div>
          </div>
        )}
      </div>

      <div className="border rounded-lg bg-card">
        <div className="border-b px-4 py-2.5 font-medium">Step trace ({data.steps.length})</div>
        {data.steps.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No steps recorded.</div>
        ) : (
          <ul className="divide-y">
            {data.steps.map((s) => {
              const Icon = STATUS_ICONS[s.status] ?? Pause;
              return (
                <li key={s.id} className="px-4 py-3 flex items-start gap-3">
                  <Icon className={`size-4 mt-0.5 ${STATUS_COLORS[s.status] ?? ""}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-mono text-xs">{s.nodeId}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-xs uppercase text-muted-foreground">{s.nodeType}</span>
                      {s.attempt > 1 && <span className="text-xs text-amber-600">attempt {s.attempt}</span>}
                    </div>
                    {s.error && <div className="text-xs text-rose-600 mt-1 font-mono">{s.error}</div>}
                  </div>
                  <div className="text-xs text-muted-foreground text-right">
                    {s.completedAt ? formatRelative(s.completedAt) : "in progress"}<br />
                    {s.latencyMs != null && <span>{s.latencyMs}ms</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {Object.keys(data.run.variables ?? {}).length > 0 && (
        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold mb-3">Run variables</h2>
          <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">{JSON.stringify(data.run.variables, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
