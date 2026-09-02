/**
 * Polymorphic blueprint engine — same as engine.ts but accepts any
 * subject_type (lead / service_request / complaint / sip_rejection / investor).
 *
 * Public API:
 *   - ensureCatalogSeeded(tx, tenantId)     — seeds all 5 catalog blueprints
 *   - ensureInstanceFor(tx, tenantId, subjectType, subjectId)
 *   - transitionPoly(tx, tenantId, subjectType, subjectId, toStageKey, opts)
 *   - getStageFor(tx, tenantId, subjectType, subjectId)
 *
 * Reuses blueprint_definitions / blueprint_stages / blueprint_transitions
 * but writes to the polymorphic blueprint_instances / blueprint_stage_history
 * tables instead of the legacy lead_* tables.
 */

import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  blueprintDefinitions,
  blueprintStages,
  blueprintTransitions,
  blueprintInstances,
  blueprintStageHistory,
  eventsOutbox,
} from "@/db/schema";
import { BLUEPRINT_CATALOG } from "./catalog";

export type SubjectType = "lead" | "service_request" | "complaint" | "sip_rejection" | "investor";

// ── Seeding ──────────────────────────────────────────────────────────────

export async function ensureCatalogSeeded(tx: Tx, tenantId: string): Promise<void> {
  for (const entry of BLUEPRINT_CATALOG) {
    // Look up by (tenant, module) regardless of is_active. If a tenant
    // admin toggled this blueprint to Inactive via the designer, the
    // row is still there — re-seeding would hit the unique index on
    // (tenant_id, module_name, blueprint_name, version_number). We
    // respect the admin's choice and leave the inactive row alone.
    const [existing] = await tx
      .select()
      .from(blueprintDefinitions)
      .where(
        and(
          eq(blueprintDefinitions.tenantId, tenantId),
          eq(blueprintDefinitions.moduleName, entry.moduleName)
        )
      )
      .limit(1);
    if (existing) continue;

    const [def] = await tx
      .insert(blueprintDefinitions)
      .values({
        tenantId,
        moduleName: entry.moduleName,
        blueprintName: entry.blueprintName,
        description: entry.description ?? null,
        versionNumber: 1,
        isActive: true,
      })
      .returning();

    for (const s of entry.stages) {
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
    for (const t of entry.transitions) {
      await tx.insert(blueprintTransitions).values({
        tenantId,
        blueprintId: def.id,
        fromStageKey: t.from,
        toStageKey: t.to,
        transitionName: t.name,
        allowedRoles: (t.allowedRoles ?? []) as any,
      });
    }
  }
}

// ── Subject → blueprint lookup ──────────────────────────────────────────

const SUBJECT_TO_MODULE: Record<SubjectType, string> = {
  lead: "leads",
  service_request: "service_requests",
  complaint: "complaints",
  sip_rejection: "sip_rejections",
  investor: "client_reviews",
};

async function activeBlueprintFor(tx: Tx, tenantId: string, subjectType: SubjectType) {
  const moduleName = SUBJECT_TO_MODULE[subjectType];
  const [bp] = await tx
    .select()
    .from(blueprintDefinitions)
    .where(
      and(
        eq(blueprintDefinitions.tenantId, tenantId),
        eq(blueprintDefinitions.moduleName, moduleName),
        eq(blueprintDefinitions.isActive, true)
      )
    )
    .limit(1);
  if (!bp) {
    // Lazy-seed if missing
    await ensureCatalogSeeded(tx, tenantId);
    const [bpAfter] = await tx
      .select()
      .from(blueprintDefinitions)
      .where(
        and(
          eq(blueprintDefinitions.tenantId, tenantId),
          eq(blueprintDefinitions.moduleName, moduleName),
          eq(blueprintDefinitions.isActive, true)
        )
      )
      .limit(1);
    return bpAfter;
  }
  return bp;
}

// ── Instance management ─────────────────────────────────────────────────

export async function ensureInstanceFor(
  tx: Tx,
  tenantId: string,
  subjectType: SubjectType,
  subjectId: string
) {
  const [existing] = await tx
    .select()
    .from(blueprintInstances)
    .where(
      and(
        eq(blueprintInstances.tenantId, tenantId),
        eq(blueprintInstances.subjectType, subjectType),
        eq(blueprintInstances.subjectId, subjectId)
      )
    )
    .limit(1);
  if (existing) return existing;

  const bp = await activeBlueprintFor(tx, tenantId, subjectType);
  if (!bp) throw new Error(`No active blueprint for subject_type=${subjectType}`);

  const [firstStage] = await tx
    .select()
    .from(blueprintStages)
    .where(eq(blueprintStages.blueprintId, bp.id))
    .orderBy(asc(blueprintStages.stageOrder))
    .limit(1);
  if (!firstStage) throw new Error("Blueprint has no stages");

  const now = new Date();
  const [inst] = await tx
    .insert(blueprintInstances)
    .values({
      tenantId,
      blueprintId: bp.id,
      subjectType,
      subjectId,
      currentStageKey: firstStage.stageKey,
      status: "in_progress",
      startedAt: now,
      stageEnteredAt: now,
    })
    .returning();

  await tx.insert(blueprintStageHistory).values({
    tenantId,
    subjectType,
    subjectId,
    instanceId: inst.id,
    stageKey: firstStage.stageKey,
    enteredAt: now,
  });
  return inst;
}

// ── Transitions ──────────────────────────────────────────────────────────

export interface PolyTransitionOpts {
  actorUserId?: string;
  actorRoles?: string[];
  remarks?: string;
  systemBypass?: boolean;
}

export async function transitionPoly(
  tx: Tx,
  tenantId: string,
  subjectType: SubjectType,
  subjectId: string,
  toStageKey: string,
  opts: PolyTransitionOpts = {}
) {
  const inst = await ensureInstanceFor(tx, tenantId, subjectType, subjectId);
  if (inst.currentStageKey === toStageKey) return { ok: true, fromStage: toStageKey, toStage: toStageKey };

  const [tr] = await tx
    .select()
    .from(blueprintTransitions)
    .where(
      and(
        eq(blueprintTransitions.blueprintId, inst.blueprintId),
        eq(blueprintTransitions.fromStageKey, inst.currentStageKey),
        eq(blueprintTransitions.toStageKey, toStageKey)
      )
    )
    .limit(1);
  if (!tr && !opts.systemBypass) {
    return { ok: false, reason: `No transition defined from "${inst.currentStageKey}" to "${toStageKey}"` };
  }

  if (!opts.systemBypass && tr) {
    const allowed = (tr.allowedRoles as string[]) ?? [];
    if (allowed.length > 0 && opts.actorRoles && !opts.actorRoles.some((r) => allowed.includes(r))) {
      return { ok: false, reason: `Your role isn't allowed to perform "${tr.transitionName}"` };
    }
  }

  const [fromStage] = await tx
    .select()
    .from(blueprintStages)
    .where(and(eq(blueprintStages.blueprintId, inst.blueprintId), eq(blueprintStages.stageKey, inst.currentStageKey)))
    .limit(1);
  const [toStage] = await tx
    .select()
    .from(blueprintStages)
    .where(and(eq(blueprintStages.blueprintId, inst.blueprintId), eq(blueprintStages.stageKey, toStageKey)))
    .limit(1);
  if (!toStage) return { ok: false, reason: "Target stage not found" };

  const now = new Date();
  const [openHistory] = await tx
    .select()
    .from(blueprintStageHistory)
    .where(and(eq(blueprintStageHistory.instanceId, inst.id), isNull(blueprintStageHistory.exitedAt)))
    .orderBy(desc(blueprintStageHistory.enteredAt))
    .limit(1);
  if (openHistory) {
    const durationSec = Math.max(0, Math.floor((now.getTime() - new Date(openHistory.enteredAt).getTime()) / 1000));
    const breached = fromStage?.slaDays != null && durationSec > fromStage.slaDays * 86400;
    await tx
      .update(blueprintStageHistory)
      .set({
        exitedAt: now,
        durationSeconds: durationSec,
        breachedSla: breached,
        completedBy: opts.actorUserId ?? null,
        transitionName: tr?.transitionName ?? "system",
        remarks: opts.remarks ?? null,
      })
      .where(eq(blueprintStageHistory.id, openHistory.id));
  }

  await tx.insert(blueprintStageHistory).values({
    tenantId,
    subjectType,
    subjectId,
    instanceId: inst.id,
    stageKey: toStageKey,
    enteredAt: now,
  });

  const allStages = await tx
    .select()
    .from(blueprintStages)
    .where(eq(blueprintStages.blueprintId, inst.blueprintId))
    .orderBy(asc(blueprintStages.stageOrder));
  const isTerminal = toStage.stageOrder === allStages[allStages.length - 1]?.stageOrder;

  await tx
    .update(blueprintInstances)
    .set({
      currentStageKey: toStageKey,
      stageEnteredAt: now,
      isDelayed: false,
      delayedSince: null,
      status: isTerminal ? "completed" : "in_progress",
      completedAt: isTerminal ? now : null,
      updatedAt: now,
    })
    .where(eq(blueprintInstances.id, inst.id));

  // Emit lifecycle events
  const onExit = (fromStage?.automationsOnExit as string[]) ?? [];
  const onEnter = (toStage.automationsOnEnter as string[]) ?? [];
  for (const recipe of [...onExit.map((r) => ({ phase: "exit", r })), ...onEnter.map((r) => ({ phase: "enter", r }))]) {
    await tx.insert(eventsOutbox).values({
      tenantId,
      kind: `blueprint.stage.${recipe.phase}`,
      entityType: subjectType,
      entityId: subjectId,
      after: {
        instanceId: inst.id,
        stageKey: recipe.phase === "enter" ? toStageKey : inst.currentStageKey,
        recipeKey: recipe.r,
      },
      meta: { actorUserId: opts.actorUserId ?? null, transition: tr?.transitionName ?? null } as any,
    } as any);
  }

  return { ok: true, fromStage: inst.currentStageKey, toStage: toStageKey };
}

// ── Read helpers ─────────────────────────────────────────────────────────

export async function getStageFor(tx: Tx, tenantId: string, subjectType: SubjectType, subjectId: string) {
  const inst = await ensureInstanceFor(tx, tenantId, subjectType, subjectId);
  const stages = await tx
    .select()
    .from(blueprintStages)
    .where(eq(blueprintStages.blueprintId, inst.blueprintId))
    .orderBy(asc(blueprintStages.stageOrder));
  const currentIdx = stages.findIndex((s) => s.stageKey === inst.currentStageKey);
  const current = stages[currentIdx];

  const history = await tx
    .select()
    .from(blueprintStageHistory)
    .where(eq(blueprintStageHistory.instanceId, inst.id))
    .orderBy(asc(blueprintStageHistory.enteredAt));

  const now = Date.now();
  const secondsInStage = Math.max(0, Math.floor((now - new Date(inst.stageEnteredAt).getTime()) / 1000));
  const slaRemainingDays = current?.slaDays != null ? current.slaDays - secondsInStage / 86400 : null;

  return {
    instance: inst,
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
    allStages: stages.map((s, i) => ({
      key: s.stageKey,
      name: s.stageName,
      order: s.stageOrder,
      status: i < currentIdx ? "done" : i === currentIdx ? "current" : "upcoming",
    })),
    history: history.map((h) => {
      const stage = stages.find((s) => s.stageKey === h.stageKey);
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
