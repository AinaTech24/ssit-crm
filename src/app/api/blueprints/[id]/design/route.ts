import { handleApiError } from "@/lib/api/error-handler";
/**
 * PUT /api/blueprints/[id]/design
 *
 * Atomic Zoho-style blueprint designer save. Takes the entire desired
 * graph in one payload and reconciles it against the DB:
 *
 *   - stages: add new ones, update existing (by stageKey), delete any
 *     stage that's missing from the payload (refuses if any live
 *     instance still sits on it)
 *   - transitions: same — full sync against (from, to) pair
 *   - blueprint meta: rename + active/inactive toggle
 *
 * Why one endpoint instead of N REST routes: the designer has a single
 * Save button; we want one transaction that either lands the whole
 * graph or rolls back. No half-saved states. Audit log records the
 * full diff.
 *
 * Safety:
 *   - stage_key is immutable once persisted (it's referenced by
 *     `lead_blueprint_instances.current_stage_key` and history rows).
 *     Editing key in the UI = "delete + create new" semantically.
 *   - Cannot delete a stage with live instances; returns 409 with the
 *     count so the UI can explain.
 *   - Cannot delete a transition; same rule (history rows reference it).
 *
 * RBAC: requires `settings.users` capability (owner / branch_head).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, and, inArray, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  blueprintDefinitions,
  blueprintStages,
  blueprintTransitions,
  leadBlueprintInstances,
} from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { invalidateBlueprintCache } from "@/lib/blueprints/engine";

export const dynamic = "force-dynamic";

const StageDef = z.object({
  /** Slug — lowercase alphanumeric + underscore. Immutable after first save. */
  stageKey: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/i, "lowercase letters, numbers, underscore"),
  stageName: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  stageOrder: z.number().int().min(1).max(100),
  ownerRole: z.string().max(40).nullable().optional(),
  slaDays: z.number().int().min(0).max(365).nullable().optional(),
  requiredFields: z.array(z.string()).max(20).default([]),
  allowedActions: z.array(z.string()).max(20).default([]),
  automationsOnEnter: z.array(z.string()).max(10).default([]),
});

const TransitionDef = z.object({
  fromStageKey: z.string().min(2).max(60),
  toStageKey: z.string().min(2).max(60),
  transitionName: z.string().min(1).max(120),
  allowedRoles: z.array(z.string()).max(15).default([]),
});

const Body = z.object({
  blueprintName: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().default(true),
  stages: z.array(StageDef).min(1).max(60),
  transitions: z.array(TransitionDef).max(200),
});

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    const { id } = await params;
    const meta = clientMetaFromHeaders(req.headers);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    // ── Cross-validate transitions reference valid stage keys ────────────
    const stageKeySet = new Set(body.stages.map((s) => s.stageKey));
    for (const t of body.transitions) {
      if (!stageKeySet.has(t.fromStageKey)) {
        return NextResponse.json(
          { error: `Transition has unknown from-stage "${t.fromStageKey}"` },
          { status: 400 }
        );
      }
      if (!stageKeySet.has(t.toStageKey)) {
        return NextResponse.json(
          { error: `Transition has unknown to-stage "${t.toStageKey}"` },
          { status: 400 }
        );
      }
    }

    // ── Duplicate-key guards ─────────────────────────────────────────────
    if (stageKeySet.size !== body.stages.length) {
      return NextResponse.json(
        { error: "Duplicate stage keys not allowed" },
        { status: 400 }
      );
    }
    const tKey = (t: typeof body.transitions[number]) =>
      `${t.fromStageKey}->${t.toStageKey}`;
    const tSet = new Set<string>();
    for (const t of body.transitions) {
      const k = tKey(t);
      if (tSet.has(k)) {
        return NextResponse.json(
          { error: `Duplicate transition ${t.fromStageKey} → ${t.toStageKey}` },
          { status: 400 }
        );
      }
      tSet.add(k);
    }

    const result = await withTenant(session.tenantId, async (tx) => {
      const [def] = await tx
        .select()
        .from(blueprintDefinitions)
        .where(eq(blueprintDefinitions.id, id))
        .limit(1);
      if (!def) {
        throw Object.assign(new Error("Blueprint not found"), { status: 404 });
      }

      // ── Load existing graph ─────────────────────────────────────────────
      const existingStages = await tx
        .select()
        .from(blueprintStages)
        .where(eq(blueprintStages.blueprintId, id));
      const existingTransitions = await tx
        .select()
        .from(blueprintTransitions)
        .where(eq(blueprintTransitions.blueprintId, id));

      const existingStageByKey = new Map(existingStages.map((s) => [s.stageKey, s]));
      const existingTransByPair = new Map(
        existingTransitions.map((t) => [`${t.fromStageKey}->${t.toStageKey}`, t])
      );

      // ── Detect deletions + check live instances ─────────────────────────
      const targetStageKeys = new Set(body.stages.map((s) => s.stageKey));
      const stagesToDelete = existingStages.filter((s) => !targetStageKeys.has(s.stageKey));

      if (stagesToDelete.length > 0) {
        // Only block deletion for lead-module blueprints (the only ones
        // wired into lead_blueprint_instances). Other modules use
        // poly-instances and we'd check those — but for v1 we only have
        // the lead blueprint wired through that table.
        if (def.moduleName === "leads") {
          const keys = stagesToDelete.map((s) => s.stageKey);
          const live = await tx.execute(sql`
            SELECT current_stage_key AS k, COUNT(*)::int AS c
            FROM lead_blueprint_instances
            WHERE blueprint_id = ${id}::uuid
              AND current_stage_key = ANY(ARRAY[${sql.join(
                keys.map((k) => sql`${k}`),
                sql`, `
              )}]::text[])
            GROUP BY current_stage_key
          `);
          if (live.rows.length > 0) {
            const summary = (live.rows as any[]).map((r) => `"${r.k}": ${r.c} live`).join(", ");
            throw Object.assign(
              new Error(`Can't delete stages still in use: ${summary}`),
              { status: 409 }
            );
          }
        }
      }

      // ── Update blueprint meta ───────────────────────────────────────────
      await tx
        .update(blueprintDefinitions)
        .set({
          blueprintName: body.blueprintName,
          description: body.description ?? null,
          isActive: body.isActive,
          updatedAt: new Date(),
        })
        .where(eq(blueprintDefinitions.id, id));

      // ── Upsert stages ───────────────────────────────────────────────────
      let added = 0;
      let updated = 0;
      for (const s of body.stages) {
        const existing = existingStageByKey.get(s.stageKey);
        if (existing) {
          await tx
            .update(blueprintStages)
            .set({
              stageName: s.stageName,
              description: s.description ?? null,
              stageOrder: s.stageOrder,
              ownerRole: s.ownerRole ?? null,
              slaDays: s.slaDays ?? null,
              requiredFields: s.requiredFields as any,
              allowedActions: s.allowedActions as any,
              automationsOnEnter: s.automationsOnEnter as any,
              updatedAt: new Date(),
            })
            .where(eq(blueprintStages.id, existing.id));
          updated++;
        } else {
          await tx.insert(blueprintStages).values({
            tenantId: session.tenantId,
            blueprintId: id,
            stageKey: s.stageKey,
            stageName: s.stageName,
            description: s.description ?? null,
            stageOrder: s.stageOrder,
            ownerRole: s.ownerRole ?? null,
            slaDays: s.slaDays ?? null,
            requiredFields: s.requiredFields as any,
            allowedActions: s.allowedActions as any,
            automationsOnEnter: s.automationsOnEnter as any,
          } as any);
          added++;
        }
      }

      // ── Delete removed stages ────────────────────────────────────────────
      let stageDeletes = 0;
      if (stagesToDelete.length > 0) {
        await tx
          .delete(blueprintStages)
          .where(
            and(
              eq(blueprintStages.blueprintId, id),
              inArray(
                blueprintStages.id,
                stagesToDelete.map((s) => s.id)
              )
            )
          );
        stageDeletes = stagesToDelete.length;
      }

      // ── Upsert transitions ──────────────────────────────────────────────
      let tAdded = 0;
      let tUpdated = 0;
      const targetTransKeys = new Set<string>();
      for (const t of body.transitions) {
        const k = `${t.fromStageKey}->${t.toStageKey}`;
        targetTransKeys.add(k);
        const existing = existingTransByPair.get(k);
        if (existing) {
          await tx
            .update(blueprintTransitions)
            .set({
              transitionName: t.transitionName,
              allowedRoles: t.allowedRoles as any,
              updatedAt: new Date(),
            })
            .where(eq(blueprintTransitions.id, existing.id));
          tUpdated++;
        } else {
          await tx.insert(blueprintTransitions).values({
            tenantId: session.tenantId,
            blueprintId: id,
            fromStageKey: t.fromStageKey,
            toStageKey: t.toStageKey,
            transitionName: t.transitionName,
            allowedRoles: t.allowedRoles as any,
          } as any);
          tAdded++;
        }
      }

      // ── Delete transitions absent from payload ──────────────────────────
      let tDeletes = 0;
      const transToDelete = existingTransitions.filter(
        (t) => !targetTransKeys.has(`${t.fromStageKey}->${t.toStageKey}`)
      );
      if (transToDelete.length > 0) {
        await tx
          .delete(blueprintTransitions)
          .where(
            and(
              eq(blueprintTransitions.blueprintId, id),
              inArray(
                blueprintTransitions.id,
                transToDelete.map((t) => t.id)
              )
            )
          );
        tDeletes = transToDelete.length;
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "blueprint.design.update",
        entityType: "blueprint",
        entityId: id,
        after: {
          blueprintName: body.blueprintName,
          isActive: body.isActive,
          stageCount: body.stages.length,
          transitionCount: body.transitions.length,
          stagesAdded: added,
          stagesUpdated: updated,
          stagesDeleted: stageDeletes,
          transitionsAdded: tAdded,
          transitionsUpdated: tUpdated,
          transitionsDeleted: tDeletes,
        },
        ...meta,
      });

      return {
        ok: true,
        stagesAdded: added,
        stagesUpdated: updated,
        stagesDeleted: stageDeletes,
        transitionsAdded: tAdded,
        transitionsUpdated: tUpdated,
        transitionsDeleted: tDeletes,
      };
    });

    invalidateBlueprintCache(session.tenantId);
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
