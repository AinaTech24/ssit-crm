import { and, eq, sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { db, withTenant, type Tx } from "@/db/client";
import {
  investors,
  leads,
  tasks as tasksTable,
  tenants,
  workflowRuns,
  workflowRunSteps,
  workflowVersions,
  workflows as workflowsTable,
} from "@/db/schema";
import { type WorkflowGraph, type WorkflowNode, WorkflowGraphSchema } from "./schema";
import { handlers } from "./actions";
import type { RunContext } from "./context";

export interface StartRunInput {
  tenantId: string;
  workflowId: string;
  triggeredBy: "event" | "schedule" | "manual" | "webhook" | "recipe";
  triggerId?: string;
  subjectType?: string;
  subjectId?: string;
  variables?: Record<string, unknown>;
  contextSnapshot?: Record<string, any>;
  event?: Record<string, any>;
  triggeredByUserId?: string;
}

/**
 * Start a workflow run. Returns the run id. The first step is enqueued
 * for asynchronous execution by the workflow runner worker.
 *
 * Idempotency: respects `workflows.recurrencePolicy` and the active-subject
 * unique index (workflow_runs_active_subject_uniq, migration 0124) — if a run
 * is already active for the same (workflow, subject), this function returns the
 * existing run id without creating a new one. The recurrence SELECT handles the
 * policy window (once / once_per_day / …); the unique index closes the
 * SELECT-then-INSERT race between two concurrent events for the same subject.
 */
export async function startRun(input: StartRunInput): Promise<{ runId: string; created: boolean }> {
  try {
    return await startRunInner(input);
  } catch (err: any) {
    // Active-run race: a concurrent event already inserted the one allowed
    // active run and the partial unique index rejected this duplicate. Recover
    // by returning the existing active run (the failed INSERT aborted our tx,
    // so the lookup runs in a fresh transaction).
    const pg = (err?.cause ?? err) as any;
    const isActiveDup =
      pg?.code === "23505" &&
      String(pg?.constraint ?? pg?.message ?? "").includes("workflow_runs_active_subject_uniq");
    if (isActiveDup && input.subjectId && input.subjectType) {
      const existing = await withTenant(input.tenantId, async (tx) => {
        const [r] = await tx
          .select()
          .from(workflowRuns)
          .where(
            and(
              eq(workflowRuns.workflowId, input.workflowId),
              eq(workflowRuns.tenantId, input.tenantId),
              eq(workflowRuns.subjectType, input.subjectType!),
              eq(workflowRuns.subjectId, input.subjectId!),
              sql`${workflowRuns.status} IN ('queued','running','paused')`
            )
          )
          .orderBy(sql`${workflowRuns.createdAt} DESC`)
          .limit(1);
        return r;
      });
      if (existing) return { runId: existing.id, created: false };
    }
    throw err;
  }
}

async function startRunInner(input: StartRunInput): Promise<{ runId: string; created: boolean }> {
  return withTenant(input.tenantId, async (tx) => {
    const [wf] = await tx
      .select()
      .from(workflowsTable)
      .where(
        and(
          eq(workflowsTable.id, input.workflowId),
          eq(workflowsTable.tenantId, input.tenantId)
        )
      );
    if (!wf) throw new Error(`Workflow ${input.workflowId} not found`);
    if (!wf.enabled) throw new Error(`Workflow ${input.workflowId} is disabled`);
    if (wf.pausedAt) throw new Error(`Workflow ${input.workflowId} is paused: ${wf.pausedReason}`);
    if (!wf.currentVersionId) throw new Error(`Workflow ${input.workflowId} has no published version`);

    // Recurrence guard — relies on the unique partial index on workflow_runs
    if (input.subjectId && input.subjectType) {
      const window = recurrenceWindow(wf.recurrencePolicy);
      if (window) {
        const [last] = await tx
          .select()
          .from(workflowRuns)
          .where(
            and(
              eq(workflowRuns.workflowId, wf.id),
              eq(workflowRuns.subjectType, input.subjectType),
              eq(workflowRuns.subjectId, input.subjectId),
              eq(workflowRuns.tenantId, input.tenantId),
              sql`${workflowRuns.createdAt} > now() - ${sql.raw(`INTERVAL '${window}'`)}`
            )
          )
          .orderBy(sql`${workflowRuns.createdAt} DESC`)
          .limit(1);
        if (last) {
          return { runId: last.id, created: false };
        }
      }
    }

    // Load version graph
    const [version] = await tx
      .select()
      .from(workflowVersions)
      .where(
        and(
          eq(workflowVersions.id, wf.currentVersionId),
          eq(workflowVersions.tenantId, input.tenantId)
        )
      );
    if (!version) throw new Error("Current version missing");

    const graph = WorkflowGraphSchema.parse(version.graph);

    const runId = uuid();
    await tx.insert(workflowRuns).values({
      id: runId,
      workflowId: wf.id,
      versionId: version.id,
      tenantId: input.tenantId,
      triggeredBy: input.triggeredBy,
      triggerId: input.triggerId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      variables: input.variables ?? {},
      contextSnapshot: input.contextSnapshot,
      status: "queued",
      currentNodeId: graph.startNodeId,
      triggeredByUserId: input.triggeredByUserId,
    });

    // Enqueue first step — done lazily via the workflow_runs.queued state.
    // The worker picks up queued runs in a tight loop. For now we let the
    // worker discover it; in production we also push to BullMQ for low-latency.
    return { runId, created: true };
  }, { userId: input.triggeredByUserId });
}

function recurrenceWindow(policy: string): string | null {
  switch (policy) {
    case "once":
      return "100 years";
    case "once_per_day":
      return "1 day";
    case "once_per_week":
      return "1 week";
    case "once_per_month":
      return "1 month";
    default:
      return null;
  }
}

/**
 * Execute one step of a workflow run. This is the worker's unit of work.
 * Idempotent — safe to retry the same (runId, nodeId, attempt) combination.
 */
export async function executeStep(input: {
  tenantId: string;
  runId: string;
}): Promise<{ status: "completed" | "paused" | "failed" | "running"; nextNodeId?: string }> {
  const { tenantId, runId } = input;
  return withTenant(tenantId, async (tx) => {
    const [run] = await tx
      .select()
      .from(workflowRuns)
      .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.tenantId, tenantId)));
    if (!run) throw new Error(`Run ${runId} not found`);
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
      return { status: run.status as any };
    }
    if (run.status === "paused" && run.pausedUntil && run.pausedUntil > new Date()) {
      return { status: "paused" };
    }

    const [version] = await tx
      .select()
      .from(workflowVersions)
      .where(and(eq(workflowVersions.id, run.versionId), eq(workflowVersions.tenantId, tenantId)));
    if (!version) throw new Error("Version missing");
    const graph = WorkflowGraphSchema.parse(version.graph);

    const nodeId = run.currentNodeId ?? graph.startNodeId;
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) {
      await markRunFailed(tx, run.id, tenantId, `Node ${nodeId} not found in graph`);
      return { status: "failed" };
    }

    if (run.status === "queued") {
      await tx
        .update(workflowRuns)
        .set({ status: "running", startedAt: new Date(), currentNodeId: nodeId })
        .where(and(eq(workflowRuns.id, run.id), eq(workflowRuns.tenantId, tenantId)));
    }

    // Build context
    const ctx = await buildContext(tx, run, version, node);
    const stepId = uuid();

    // Insert pending step row
    await tx.insert(workflowRunSteps).values({
      id: stepId,
      runId: run.id,
      tenantId,
      nodeId: node.id,
      nodeType: node.type,
      attempt: 1,
      status: "running",
      input: { config: node.config },
      startedAt: new Date(),
    });

    const start = Date.now();
    try {
      const handler = handlers[node.type as keyof typeof handlers];
      if (!handler) {
        throw new Error(`No handler for node type '${node.type}'`);
      }

      ctx.stepId = stepId;
      const result = await handler.execute(ctx, node as any, tx);
      const latencyMs = Date.now() - start;

      await tx
        .update(workflowRunSteps)
        .set({
          status: "succeeded",
          output: result.output ?? {},
          completedAt: new Date(),
          latencyMs,
        })
        .where(and(eq(workflowRunSteps.id, stepId), eq(workflowRunSteps.tenantId, tenantId)));

      // Apply variables produced by this step
      if (result.varsPatch && Object.keys(result.varsPatch).length > 0) {
        const merged = { ...(run.variables ?? {}), ...result.varsPatch };
        await tx
          .update(workflowRuns)
          .set({ variables: merged })
          .where(and(eq(workflowRuns.id, run.id), eq(workflowRuns.tenantId, tenantId)));
      }

      // Decide next move
      if (result.kind === "end") {
        await tx
          .update(workflowRuns)
          .set({ status: "completed", completedAt: new Date(), currentNodeId: null })
          .where(and(eq(workflowRuns.id, run.id), eq(workflowRuns.tenantId, tenantId)));
        return { status: "completed" };
      }

      if (result.kind === "pause") {
        await tx
          .update(workflowRuns)
          .set({
            status: "paused",
            pausedUntil: result.until ?? null,
            waitPredicate: result.waitPredicate ?? null,
            waitNodeId: result.waitNodeId ?? node.id,
            currentNodeId: result.waitNodeId ?? node.id,
          })
          .where(and(eq(workflowRuns.id, run.id), eq(workflowRuns.tenantId, tenantId)));
        return { status: "paused" };
      }

      // Continue — find next node
      const nextNodeId = pickNextNode(graph, node.id, result.sourceHandle);
      if (!nextNodeId) {
        // Implicit end
        await tx
          .update(workflowRuns)
          .set({ status: "completed", completedAt: new Date(), currentNodeId: null })
          .where(and(eq(workflowRuns.id, run.id), eq(workflowRuns.tenantId, tenantId)));
        return { status: "completed" };
      }
      await tx
        .update(workflowRuns)
        .set({ currentNodeId: nextNodeId })
        .where(and(eq(workflowRuns.id, run.id), eq(workflowRuns.tenantId, tenantId)));
      return { status: "running", nextNodeId };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      await tx
        .update(workflowRunSteps)
        .set({ status: "failed", error: message, completedAt: new Date(), latencyMs })
        .where(and(eq(workflowRunSteps.id, stepId), eq(workflowRunSteps.tenantId, tenantId)));

      // `continueOnError` — the step is still recorded as failed (so the run
      // timeline and the Control Tower show it), but the run walks on to the
      // next node instead of dying. This exists for multi-channel fan-outs:
      // a firm with no WhatsApp token yet must still get the welcome EMAIL,
      // and one missing integration must not silently cancel the rest of an
      // automation. Opt-in per node, so nothing else changes behaviour.
      if ((node.config as { continueOnError?: boolean } | undefined)?.continueOnError) {
        const nextNodeId = pickNextNode(graph, node.id);
        if (!nextNodeId) {
          await tx
            .update(workflowRuns)
            .set({ status: "completed", completedAt: new Date(), currentNodeId: null })
            .where(and(eq(workflowRuns.id, run.id), eq(workflowRuns.tenantId, tenantId)));
          return { status: "completed" };
        }
        await tx
          .update(workflowRuns)
          .set({ currentNodeId: nextNodeId })
          .where(and(eq(workflowRuns.id, run.id), eq(workflowRuns.tenantId, tenantId)));
        return { status: "running", nextNodeId };
      }

      await markRunFailed(tx, run.id, tenantId, message);
      return { status: "failed" };
    }
  });
}

function pickNextNode(graph: WorkflowGraph, fromId: string, sourceHandle?: string): string | null {
  const edges = graph.edges.filter((e) => e.source === fromId);
  if (edges.length === 0) return null;
  if (sourceHandle) {
    const exact = edges.find((e) => e.sourceHandle === sourceHandle);
    if (exact) return exact.target;
  }
  // Default: first edge without a source handle, else first edge
  const def = edges.find((e) => !e.sourceHandle) ?? edges[0];
  return def?.target ?? null;
}

async function markRunFailed(tx: Tx, runId: string, tenantId: string, error: string) {
  await tx
    .update(workflowRuns)
    .set({ status: "failed", error, completedAt: new Date() })
    .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.tenantId, tenantId)));
}

async function buildContext(
  tx: Tx,
  run: typeof workflowRuns.$inferSelect,
  version: typeof workflowVersions.$inferSelect,
  _node: WorkflowNode
): Promise<RunContext> {
  // Load subject
  let subject: Record<string, any> | null = null;
  if (run.subjectId && run.subjectType) {
    subject = await loadSubject(tx, run.subjectType, run.subjectId, run.tenantId);
  }
  const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, run.tenantId));

  return {
    tenantId: run.tenantId,
    runId: run.id,
    versionId: version.id,
    stepId: "", // populated when handler is invoked
    workflowId: run.workflowId,
    subjectType: run.subjectType,
    subjectId: run.subjectId,
    subject,
    tenant: tenant ?? {},
    vars: (run.variables as Record<string, any>) ?? {},
    event: (run.contextSnapshot as Record<string, any>) ?? null,
    log: (msg, meta) => {
      // eslint-disable-next-line no-console
      console.log(`[wf:${run.id}] ${msg}`, meta ?? "");
    },
  };
}

async function loadSubject(tx: Tx, type: string, id: string, tenantId: string): Promise<Record<string, any> | null> {
  switch (type) {
    case "investor": {
      const [r] = await tx.select().from(investors).where(and(eq(investors.id, id), eq(investors.tenantId, tenantId)));
      return r as any;
    }
    case "lead": {
      const [r] = await tx.select().from(leads).where(and(eq(leads.id, id), eq(leads.tenantId, tenantId)));
      return r as any;
    }
    case "task": {
      const [r] = await tx.select().from(tasksTable).where(and(eq(tasksTable.id, id), eq(tasksTable.tenantId, tenantId)));
      return r as any;
    }
    default:
      return null;
  }
}
