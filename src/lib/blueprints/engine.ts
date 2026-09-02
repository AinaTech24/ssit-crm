/**
 * Blueprint engine — runtime helpers.
 *
 *   ensureActiveBlueprint(tx, tenantId)
 *     Lazily seeds the canonical lead-to-client blueprint for a tenant.
 *
 *   ensureInstance(tx, tenantId, leadId)
 *     Creates a lead_blueprint_instances row + initial stage_history entry
 *     when a lead hits the system for the first time.
 *
 *   transitionTo(tx, leadId, toStageKey, opts)
 *     Validates the transition exists, role is allowed, exit conditions of
 *     the current stage are met. On success: stamps exited_at on the current
 *     history row, opens a new one for the target stage, updates the
 *     instance, runs on-exit + on-enter automation recipes (via outbox event
 *     emit — they're picked up by the workflow runner).
 *
 *   getStage(tx, leadId)
 *     Returns { current, all, history, isDelayed } for the lead-detail UI.
 *
 *   markDelayedInstances(tx)
 *     Worker — sets is_delayed=true on instances whose stage SLA has elapsed.
 */

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { recomputeLeadScore } from "@/lib/leads/recompute";
import { recordAudit } from "@/lib/audit";
import {
  blueprintDefinitions,
  blueprintStages,
  blueprintTransitions,
  leadBlueprintInstances,
  leadStageHistory,
  eventsOutbox,
  leads,
} from "@/db/schema";
import {
  LEAD_TO_CLIENT_BLUEPRINT_NAME,
  LEAD_TO_CLIENT_STAGES,
  LEAD_TO_CLIENT_TRANSITIONS,
  stageDisposition,
  onboardingBranchOf,
} from "./lead_to_client";
import { checkPrerequisites } from "./prerequisites";

const MODULE = "leads";

// Process-local cache for the lead-to-client blueprint definition per tenant.
// Definitions change only when the owner edits stages in /settings/blueprints
// (rare), so caching saves a hot-path SELECT on every lead detail page load.
const ACTIVE_BP_CACHE = new Map<string, { id: string; cachedAt: number }>();
const BP_CACHE_TTL_MS = 5 * 60 * 1000;

export function invalidateBlueprintCache(tenantId?: string) {
  if (tenantId) ACTIVE_BP_CACHE.delete(tenantId);
  else ACTIVE_BP_CACHE.clear();
}

// ── Seeder ───────────────────────────────────────────────────────────────

export async function ensureActiveBlueprint(tx: Tx, tenantId: string) {
  // Fast path: cached id
  const cached = ACTIVE_BP_CACHE.get(tenantId);
  if (cached && Date.now() - cached.cachedAt < BP_CACHE_TTL_MS) {
    const [def] = await tx
      .select()
      .from(blueprintDefinitions)
      .where(eq(blueprintDefinitions.id, cached.id))
      .limit(1);
    if (def) return def;
    ACTIVE_BP_CACHE.delete(tenantId);
  }

  // Look up by (tenant, module) without filtering by is_active first.
  // If a tenant admin deactivated the blueprint via the designer, an
  // inactive row is still on disk and we'd otherwise hit the unique
  // index on (tenant, module, name, version) when re-seeding. We prefer
  // the active one if both exist, else return any.
  const existing = await tx
    .select()
    .from(blueprintDefinitions)
    .where(
      and(
        eq(blueprintDefinitions.tenantId, tenantId),
        eq(blueprintDefinitions.moduleName, MODULE)
      )
    )
    .orderBy(desc(blueprintDefinitions.isActive));
  if (existing.length) {
    ACTIVE_BP_CACHE.set(tenantId, { id: existing[0].id, cachedAt: Date.now() });
    return existing[0];
  }

  const [def] = await tx
    .insert(blueprintDefinitions)
    .values({
      tenantId,
      moduleName: MODULE,
      blueprintName: LEAD_TO_CLIENT_BLUEPRINT_NAME,
      description: "Full Lead → Client SOP — 30 stages with branching paths (call-back loops, KYC routes, mandate/transaction retries).",
      versionNumber: 1,
      isActive: true,
    })
    .returning();

  for (const s of LEAD_TO_CLIENT_STAGES) {
    await tx.insert(blueprintStages).values({
      tenantId,
      blueprintId: def.id,
      stageKey: s.key,
      stageName: s.name,
      description: s.description ?? null,
      stageOrder: s.order,
      ownerRole: s.ownerRole,
      requiredFields: s.requiredFields as any,
      slaDays: s.slaDays ?? null,
      allowedActions: s.allowedActions as any,
      automationsOnEnter: s.automationsOnEnter as any,
      automationsOnExit: s.automationsOnExit as any,
    });
  }
  for (const t of LEAD_TO_CLIENT_TRANSITIONS) {
    await tx.insert(blueprintTransitions).values({
      tenantId,
      blueprintId: def.id,
      fromStageKey: t.from,
      toStageKey: t.to,
      transitionName: t.name,
      allowedRoles: (t.allowedRoles ?? []) as any,
    });
  }
  ACTIVE_BP_CACHE.set(tenantId, { id: def.id, cachedAt: Date.now() });
  return def;
}

// ── Instance management ──────────────────────────────────────────────────

export async function ensureInstance(tx: Tx, tenantId: string, leadId: string) {
  const [existing] = await tx
    .select()
    .from(leadBlueprintInstances)
    .where(and(eq(leadBlueprintInstances.tenantId, tenantId), eq(leadBlueprintInstances.leadId, leadId)))
    .limit(1);
  if (existing) return existing;

  const def = await ensureActiveBlueprint(tx, tenantId);
  const [firstStage] = await tx
    .select()
    .from(blueprintStages)
    .where(eq(blueprintStages.blueprintId, def.id))
    .orderBy(asc(blueprintStages.stageOrder))
    .limit(1);
  if (!firstStage) throw new Error("Blueprint has no stages");

  const now = new Date();
  // Race-safe create: two near-simultaneous first-touch events (e.g. the
  // lead-detail GET racing a call-outcome auto-advance) both pass the SELECT
  // above. ON CONFLICT on the (tenant, lead) unique index turns the loser into
  // a no-op insert instead of a thrown duplicate-key (which, swallowed inside a
  // parent tx by autoAdvance, would otherwise poison the whole transaction).
  const [inst] = await tx
    .insert(leadBlueprintInstances)
    .values({
      tenantId,
      leadId,
      blueprintId: def.id,
      currentStageKey: firstStage.stageKey,
      status: "in_progress",
      startedAt: now,
      stageEnteredAt: now,
    })
    .onConflictDoNothing({ target: [leadBlueprintInstances.tenantId, leadBlueprintInstances.leadId] })
    .returning();

  if (!inst) {
    // Lost the create race — the concurrent tx already made it. Re-read.
    const [existing2] = await tx
      .select()
      .from(leadBlueprintInstances)
      .where(and(eq(leadBlueprintInstances.tenantId, tenantId), eq(leadBlueprintInstances.leadId, leadId)))
      .limit(1);
    return existing2;
  }

  await tx.insert(leadStageHistory).values({
    tenantId,
    leadId,
    instanceId: inst.id,
    stageKey: firstStage.stageKey,
    enteredAt: now,
  });

  return inst;
}

// ── Transitions ──────────────────────────────────────────────────────────

export interface TransitionOptions {
  /** User invoking the transition — used for role check + audit. */
  actorUserId?: string;
  actorRoles?: string[];
  remarks?: string;
  /** If set, override role + transition-graph + prerequisite checks (use
   *  sparingly — for system/auto-advance events and explicit admin overrides). */
  systemBypass?: boolean;
  /** Suppress on-enter / on-exit automation emission — used for the
   *  intermediate hops of a multi-stage walk so only the FINAL target fires
   *  its recipes (a passed-through stage shouldn't trigger sends). */
  suppressAutomations?: boolean;
  /** Threaded into the audit_log row for forensics. */
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface TransitionResult {
  ok: boolean;
  reason?: string;
  /** Machine code so callers can branch (e.g. don't bypass a prereq failure). */
  code?: "no_transition" | "role" | "prereq" | "terminal" | "stage_not_found";
  fromStage?: string;
  toStage?: string;
}

export async function transitionTo(
  tx: Tx,
  tenantId: string,
  leadId: string,
  toStageKey: string,
  opts: TransitionOptions = {}
): Promise<TransitionResult> {
  const inst = await ensureInstance(tx, tenantId, leadId);

  // ── P0: serialize concurrent transitions on this instance ──────────────
  // Lock the instance row FOR UPDATE and re-read the committed current stage.
  // A double-click / retried POST / auto-advance racing a manual advance now
  // blocks here until the in-flight transition commits, then re-evaluates
  // against the TRUE current stage — instead of both reading the stale stage
  // and double-firing history rows + stage automations.
  const lockRes = await tx.execute(
    sql`SELECT current_stage_key, status FROM lead_blueprint_instances WHERE id = ${inst.id}::uuid FOR UPDATE` as any
  );
  const lockedRow = (lockRes.rows?.[0] ?? {}) as { current_stage_key?: string; status?: string };
  const currentStageKey = lockedRow.current_stage_key ?? inst.currentStageKey;
  const instStatus = lockedRow.status ?? inst.status;

  if (currentStageKey === toStageKey) {
    // The blueprint instance is already at the target, but leads.stage (the
    // legacy column the Kanban + list read) can drift out of sync — e.g. a card
    // shown under an alias, or a prior direct stage edit. Mirror it anyway so a
    // drag that the board treats as a real move actually persists; otherwise the
    // card snaps back to its old column on the next load. No-op when already equal.
    await tx.execute(
      sql`UPDATE leads SET stage = ${toStageKey}, updated_at = now() WHERE id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid AND stage IS DISTINCT FROM ${toStageKey}` as any
    );
    return { ok: true, fromStage: toStageKey, toStage: toStageKey };
  }

  // ── Terminal guard ─────────────────────────────────────────────────────
  // A completed journey (Active Client) is frozen — even systemBypass/force
  // must not silently reopen it and re-fire on-enter automations.
  if (instStatus === "completed") {
    return { ok: false, code: "terminal", reason: "This journey is already completed and cannot be advanced." };
  }

  // Look up the transition
  const [tr] = await tx
    .select()
    .from(blueprintTransitions)
    .where(
      and(
        eq(blueprintTransitions.blueprintId, inst.blueprintId),
        eq(blueprintTransitions.fromStageKey, currentStageKey),
        eq(blueprintTransitions.toStageKey, toStageKey)
      )
    )
    .limit(1);
  if (!tr && !opts.systemBypass) {
    return { ok: false, code: "no_transition", reason: `No transition defined from "${currentStageKey}" to "${toStageKey}"` };
  }

  // Role gate
  if (!opts.systemBypass && tr) {
    const allowed = (tr.allowedRoles as string[]) ?? [];
    if (allowed.length > 0 && opts.actorRoles && !opts.actorRoles.some((r) => allowed.includes(r))) {
      return { ok: false, code: "role", reason: `Your role isn't allowed to perform "${tr.transitionName}"` };
    }
  }

  // Stage rows for on-exit / on-enter automations
  const [fromStage] = await tx
    .select()
    .from(blueprintStages)
    .where(and(eq(blueprintStages.blueprintId, inst.blueprintId), eq(blueprintStages.stageKey, currentStageKey)))
    .limit(1);
  const [toStage] = await tx
    .select()
    .from(blueprintStages)
    .where(and(eq(blueprintStages.blueprintId, inst.blueprintId), eq(blueprintStages.stageKey, toStageKey)))
    .limit(1);
  if (!toStage) return { ok: false, code: "stage_not_found", reason: "Target stage not found" };

  // ── P1: enforce prerequisites server-side ──────────────────────────────
  // The SAME artefact checklist the UI surfaces via /can-advance is now also a
  // hard server gate — a direct curl/replay can no longer reach (e.g.)
  // documents_received with no docs on file. systemBypass (auto-advance from
  // an action that JUST created the artefact, or an explicit admin override)
  // intentionally skips it.
  if (!opts.systemBypass) {
    const prereq = await checkPrerequisites(tx, tenantId, leadId, toStageKey);
    if (!prereq.ok) {
      const missing = prereq.items.filter((i) => !i.satisfied).map((i) => i.label).join("; ");
      return { ok: false, code: "prereq", reason: `Complete these first: ${missing}` };
    }
  }

  const now = new Date();

  // Close the open history row
  const [openHistory] = await tx
    .select()
    .from(leadStageHistory)
    .where(and(eq(leadStageHistory.instanceId, inst.id), isNull(leadStageHistory.exitedAt)))
    .orderBy(desc(leadStageHistory.enteredAt))
    .limit(1);
  if (openHistory) {
    const durationSec = Math.max(0, Math.floor((now.getTime() - new Date(openHistory.enteredAt).getTime()) / 1000));
    const breached = fromStage?.slaDays != null && durationSec > fromStage.slaDays * 86400;
    await tx
      .update(leadStageHistory)
      .set({
        exitedAt: now,
        durationSeconds: durationSec,
        breachedSla: breached,
        completedBy: opts.actorUserId ?? null,
        transitionName: tr?.transitionName ?? "system",
        remarks: opts.remarks ?? null,
      })
      .where(eq(leadStageHistory.id, openHistory.id));
  }

  // Open new history row — stamp the entering actor (not only the exiting one)
  // and capture its id for the outbox dedup key.
  const [newHistory] = await tx
    .insert(leadStageHistory)
    .values({
      tenantId,
      leadId,
      instanceId: inst.id,
      stageKey: toStageKey,
      enteredAt: now,
      enteredBy: opts.actorUserId ?? null,
    })
    .returning({ id: leadStageHistory.id });

  // Update instance pointer. Disposition is derived from the stage's flavour
  // (terminal_success → completed, lead-phase terminal_failure → lost) rather
  // than a hard-coded "is it stage 30?", so lost leads close out correctly and
  // retryable failure stages (mandate_reject / transaction_failed) stay open.
  const disposition = stageDisposition(toStageKey);
  await tx
    .update(leadBlueprintInstances)
    .set({
      currentStageKey: toStageKey,
      stageEnteredAt: now,
      isDelayed: false,
      delayedSince: null,
      status: disposition === "completed" ? "completed" : disposition === "lost" ? "lost" : "in_progress",
      completedAt: disposition === "completed" ? now : null,
      updatedAt: now,
    })
    .where(eq(leadBlueprintInstances.id, inst.id));

  // Mirror the new stage back onto leads.stage so the Kanban + filters + any
  // other consumer that still reads the legacy column stays in sync. Explicit
  // tenant_id predicate (not RLS-only) for defense-in-depth.
  await tx.execute(
    sql`UPDATE leads SET stage = ${toStageKey}, stage_changed_at = ${now}, updated_at = ${now} WHERE id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid` as any
  );

  // Re-score the lead off the freshly-mirrored stage. Every blueprint
  // transition (call-outcome, advance, sync) flows through here, so this is
  // the single point that keeps leads.lead_score in step with the funnel.
  await recomputeLeadScore(tx, leadId, now.getTime());

  // Central audit trail — every transition (manual, auto, force) lands in
  // audit_log alongside the rest of the app's mutations. recordAudit swallows
  // its own errors, so it never poisons the transition.
  await recordAudit(tx, {
    tenantId,
    actorUserId: opts.actorUserId ?? null,
    actorType: opts.systemBypass ? "system" : "user",
    action: "lead.blueprint.advance",
    entityType: "lead",
    entityId: leadId,
    before: { stage: currentStageKey },
    after: { stage: toStageKey, status: disposition },
    reason: opts.remarks ?? null,
    meta: { transition: tr?.transitionName ?? null, forced: !!opts.systemBypass },
    ipAddress: opts.ipAddress ?? null,
    userAgent: opts.userAgent ?? null,
  });

  // Emit lifecycle events for any wired automations — unless suppressed (an
  // intermediate hop of a multi-stage walk). Each event carries a deterministic
  // dedup key (the new history row id) so a retried emit is a no-op while a
  // genuine second entry into a looped stage still fires.
  if (!opts.suppressAutomations) {
    const onExit = (fromStage?.automationsOnExit as string[]) ?? [];
    const onEnter = (toStage.automationsOnEnter as string[]) ?? [];
    for (const recipe of [...onExit.map((r) => ({ phase: "exit", r })), ...onEnter.map((r) => ({ phase: "enter", r }))]) {
      await tx
        .insert(eventsOutbox)
        .values({
          tenantId,
          kind: `blueprint.stage.${recipe.phase}`,
          entityType: "lead",
          entityId: leadId,
          after: {
            instanceId: inst.id,
            stageKey: recipe.phase === "enter" ? toStageKey : currentStageKey,
            recipeKey: recipe.r,
          },
          meta: { actorUserId: opts.actorUserId ?? null, transition: tr?.transitionName ?? null } as any,
          dedupKey: `bp:${newHistory.id}:${recipe.phase}:${recipe.r}`,
        } as any)
        .onConflictDoNothing({ target: eventsOutbox.dedupKey, where: sql`dedup_key IS NOT NULL` });
    }
  }

  return { ok: true, fromStage: currentStageKey, toStage: toStageKey };
}

// ── Read helpers for the UI ─────────────────────────────────────────────

export interface StageView {
  current: {
    key: string;
    name: string;
    description: string | null;
    ownerRole: string | null;
    order: number;
    slaDays: number | null;
    allowedActions: string[];
    requiredFields: string[];
    /** Seconds since the lead entered this stage. */
    secondsInStage: number;
    /** Days remaining (negative = overdue). null if no SLA. */
    slaRemainingDays: number | null;
    isDelayed: boolean;
  };
  /** The lead's product pipeline (mf | insurance | general) — drives which
   *  onboarding branch the journey + actions show. */
  pipeline: string;
  allStages: Array<{
    key: string;
    name: string;
    order: number;
    status: "done" | "current" | "upcoming";
    /**
     * Which side of the journey owns this stage. Lead-phase stages (order ≤ 10,
     * "new" … "not_qualified") show in the Leads module; from "Won Lead" the
     * client-phase stages (order ≥ 11: request_documents … add_in_review_sheet)
     * show in the Clients module instead. Boundary = LEAD_PHASE_LAST_ORDER (10).
     */
    phase: "lead" | "client";
  }>;
  history: Array<{
    stageKey: string;
    stageName: string;
    enteredAt: Date;
    exitedAt: Date | null;
    durationSeconds: number | null;
    breachedSla: boolean;
  }>;
}

export async function getStage(tx: Tx, tenantId: string, leadId: string): Promise<StageView> {
  const inst = await ensureInstance(tx, tenantId, leadId);
  const allDbStages = await tx
    .select()
    .from(blueprintStages)
    .where(eq(blueprintStages.blueprintId, inst.blueprintId))
    .orderBy(asc(blueprintStages.stageOrder));

  // Which onboarding branch does this lead follow? Insurance-primary leads walk
  // the insurance journey; everyone else (mf / general) walks MF onboarding.
  const [leadRow] = await tx
    .select({ pipeline: leads.pipeline })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);
  const pipeline = (leadRow?.pipeline as string) ?? "mf";
  const branch: "mf" | "insurance" = pipeline === "insurance" ? "insurance" : "mf";

  // Hide the OFF-branch onboarding stages so the stepper shows one clean path.
  // Lead-phase / shared stages always show; the current stage is never hidden
  // (e.g. if a lead is mid-insurance but its pipeline flag was changed).
  const stages = allDbStages.filter((s) => {
    if (s.stageKey === inst.currentStageKey) return true;
    const b = onboardingBranchOf(s.stageKey);
    return b === null || b === branch;
  });
  const currentIdx = stages.findIndex((s) => s.stageKey === inst.currentStageKey);
  const current = stages[currentIdx];

  const history = await tx
    .select()
    .from(leadStageHistory)
    .where(eq(leadStageHistory.instanceId, inst.id))
    .orderBy(asc(leadStageHistory.enteredAt));

  const now = Date.now();
  const secondsInStage = Math.max(0, Math.floor((now - new Date(inst.stageEnteredAt).getTime()) / 1000));
  const slaRemainingDays =
    current?.slaDays != null ? current.slaDays - secondsInStage / 86400 : null;

  return {
    current: {
      key: current.stageKey,
      name: current.stageName,
      description: current.description,
      ownerRole: current.ownerRole,
      order: current.stageOrder,
      slaDays: current.slaDays,
      allowedActions: (current.allowedActions as string[]) ?? [],
      requiredFields: (current.requiredFields as string[]) ?? [],
      secondsInStage,
      slaRemainingDays,
      isDelayed: inst.isDelayed,
    },
    pipeline,
    allStages: stages.map((s, i) => ({
      key: s.stageKey,
      name: s.stageName,
      order: s.stageOrder,
      status: i < currentIdx ? "done" : i === currentIdx ? "current" : "upcoming",
      // Cut-over at stage 10 (Not Qualified is the last lead-phase
      // stage in the new SOP graph; Won Lead at stage 9 is the success
      // boundary that converts to Client). See LEAD_PHASE_LAST_ORDER.
      phase: s.stageOrder <= 10 ? "lead" : "client",
    })),
    history: history.map((h) => {
      const stage = allDbStages.find((s) => s.stageKey === h.stageKey);
      return {
        stageKey: h.stageKey,
        stageName: stage?.stageName ?? h.stageKey,
        enteredAt: new Date(h.enteredAt),
        exitedAt: h.exitedAt ? new Date(h.exitedAt) : null,
        durationSeconds: h.durationSeconds,
        breachedSla: h.breachedSla,
      };
    }),
  };
}
