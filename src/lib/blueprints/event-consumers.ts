/**
 * Blueprint lifecycle-event consumers.
 *
 * The blueprint engine emits three internal outbox events that, until now, had
 * NO subscriber (so the metadata was inert):
 *
 *   blueprint.stage.enter / blueprint.stage.exit
 *     — carry a `recipeKey`; we run that tenant's matching enabled workflow for
 *       the subject. This is what makes a stage's `automationsOnEnter` actually
 *       fire (send the doc checklist, the won-lead celebration, etc.).
 *
 *   blueprint.stage.delayed  (lead journey)
 *     — an SLA breach. We turn it into an actionable TASK for the lead's owner
 *       instead of just flipping a flag nobody sees.
 *
 * Wired into the outbox poller (src/workers/outbox-poller.ts). All best-effort:
 * a failure here is logged, never blocks the rest of outbox processing.
 */

import { and, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { workflows } from "@/db/schema";
import { startRun } from "@/lib/workflow/runner";

/** Returns true if the event was a blueprint.stage.* event (handled here). */
export async function handleBlueprintStageEvent(event: any): Promise<boolean> {
  const kind: string = typeof event?.kind === "string" ? event.kind : "";
  if (!kind.startsWith("blueprint.stage.")) return false;

  const tenantId: string = event.tenant_id;
  const after = (event.after ?? {}) as { recipeKey?: string; stageKey?: string; stageName?: string; slaDays?: number };

  // ── Stage automations: run the named recipe's workflow for the subject ──
  if (kind === "blueprint.stage.enter" || kind === "blueprint.stage.exit") {
    const recipeKey = after.recipeKey;
    if (!recipeKey) return true;

    const wf = await withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select({ id: workflows.id })
        .from(workflows)
        .where(and(eq(workflows.tenantId, tenantId), eq(workflows.recipeKey, recipeKey), eq(workflows.enabled, true)))
        .limit(1);
      return row ?? null;
    });
    // No enabled workflow installed for this recipe → silent no-op (the stage
    // automation is simply "not configured", not an error).
    if (!wf) return true;

    await startRun({
      tenantId,
      workflowId: wf.id,
      triggeredBy: "event",
      subjectType: event.entity_type,
      subjectId: event.entity_id,
      contextSnapshot: { stageKey: after.stageKey ?? null, recipeKey, via: kind },
      event,
    });
    return true;
  }

  // ── SLA breach → owner task (lead journey only; SR/complaints have their own
  //    escalation sweep). ──
  if (kind === "blueprint.stage.delayed" && event.entity_type === "lead") {
    await createLeadDelayTask(tenantId, event.entity_id, after);
    return true;
  }

  return true;
}

async function createLeadDelayTask(
  _tenantId: string,
  _leadId: string,
  _after: { stageKey?: string; stageName?: string; slaDays?: number }
): Promise<void> {
  // Auto blueprint-SLA "Lead overdue at ..." TASK creation is disabled per firm
  // preference. The SLA breach still raises an in-app notification (see
  // workers/blueprint-sla-worker.ts) and flips the blueprint instance's delayed
  // flag — it simply no longer auto-creates a task in the Tasks list. Restore
  // the INSERT here (git history) to re-enable.
}
