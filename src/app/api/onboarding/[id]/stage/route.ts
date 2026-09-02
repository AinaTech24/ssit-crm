import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/onboarding/[id]/stage
 * Body: { stage, remarks?, pendingDocuments?[] }
 *
 * Marks a stage as done. Auto-advances `currentStage` to the next not-yet-done
 * stage. Handles all 3 spec automations:
 *
 *   1. Create task for next stage — auto-creates a task assigned to the pipeline's RM.
 *   2. Notify back office for pending documents — when `pendingDocuments` is
 *      non-empty after the update, drops in-app notifications for back_office users.
 *   3. Send welcome communication after first investment — when the
 *      `first_investment` stage transitions to done, fires an outbox event so
 *      the `first_investment_welcome` workflow (or any subscriber) can pick it up.
 *
 * When the final stage (`first_review`) is marked done, the pipeline auto-
 * closes: status = 'completed', actualCompletionAt = today.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import {
  onboardingPipelines,
  ONBOARDING_STAGES,
  tasks,
  notifications,
  eventsOutbox,
  investors,
} from "@/db/schema";

export const dynamic = "force-dynamic";

const STAGE_LABELS: Record<string, string> = {
  first_meeting: "First Meeting Done",
  documents: "Documents Collected",
  kyc: "KYC Checked",
  risk_profile: "Risk Profile Completed",
  goal_mapping: "Goal Mapping Done",
  ucc_can: "UCC / CAN Created",
  mandate: "Mandate Registered",
  plan_shared: "Investment Plan Shared",
  first_investment: "SIP / Lumpsum Started",
  welcome_kit: "Welcome Kit Sent",
  first_review: "First Review Scheduled",
};

const Body = z.object({
  stage: z.enum(ONBOARDING_STAGES),
  remarks: z.string().optional(),
  pendingDocuments: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "onboarding.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const body = parse.data;
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      // Lock the pipeline row FOR UPDATE before the read-modify-write of the
      // stages jsonb. Two RMs marking different stages concurrently would
      // otherwise both read the pre-update blob and the second writer's
      // full-object overwrite would silently drop the first's stage entry
      // (a lost update). The lock serializes them.
      const pipe = (await tx
        .select()
        .from(onboardingPipelines)
        .where(and(eq(onboardingPipelines.id, id), eq(onboardingPipelines.tenantId, session.tenantId)))
        .limit(1)
        .for("update"))[0];
      if (!pipe) throw Object.assign(new Error("pipeline not found"), { status: 404 });

      const stages = { ...(pipe.stages as Record<string, any>) };

      // Idempotency: if this stage is already marked done, don't re-fire the
      // side effects (next-stage task, welcome outbox event, notifications).
      if (stages[body.stage]) {
        const next = ONBOARDING_STAGES.find((s) => !stages[s]) ?? null;
        return {
          id,
          currentStage: pipe.currentStage,
          stageJustDone: body.stage,
          nextStage: next,
          allDone: ONBOARDING_STAGES.every((s) => stages[s]),
          alreadyDone: true,
        };
      }

      stages[body.stage] = {
        doneAt: new Date().toISOString(),
        byUserId: session.userId,
        remarks: body.remarks,
      };

      // Pick the next not-yet-done stage in canonical order
      const nextStage = ONBOARDING_STAGES.find((s) => !stages[s]) ?? null;
      const isLast = body.stage === "first_review";
      const allDone = ONBOARDING_STAGES.every((s) => stages[s]);

      const patch: any = {
        stages,
        currentStage: allDone ? "completed" : (nextStage ?? body.stage),
        updatedAt: new Date(),
      };
      if (body.pendingDocuments !== undefined) {
        patch.pendingDocuments = body.pendingDocuments;
      }
      if (allDone) {
        patch.status = "completed";
        patch.actualCompletionAt = new Date().toISOString().slice(0, 10);
      }

      await tx
        .update(onboardingPipelines)
        .set(patch)
        .where(and(eq(onboardingPipelines.id, id), eq(onboardingPipelines.tenantId, session.tenantId)));

      // Outbox event — any workflow can subscribe (e.g. welcome comm)
      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: `onboarding.stage.${body.stage}`,
        entityType: "onboarding_pipeline",
        entityId: id,
        before: { currentStage: pipe.currentStage },
        after: {
          stage: body.stage,
          nextStage: patch.currentStage,
          investorId: pipe.investorId,
        },
        meta: { userId: session.userId, remarks: body.remarks } as any,
      } as any);

      // ─── Automation 1 — create task for next stage ────────────────────────
      if (nextStage && !allDone) {
        await tx.insert(tasks).values({
          id: uuid(),
          tenantId: session.tenantId,
          branchId: pipe.branchId ?? session.branchId,
          assigneeId: pipe.assignedRmId ?? session.userId,
          subjectType: "investor",
          subjectId: pipe.investorId,
          type: "onboarding",
          title: `Onboarding: ${STAGE_LABELS[nextStage]}`,
          description: `Next step for onboarding pipeline. Stage "${STAGE_LABELS[body.stage]}" completed by ${session.name}.`,
          priority: "normal",
          status: "open",
          dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days
        } as any);
      }

      // ─── Automation 2 — notify back office for pending documents ──────────
      const pendingDocs = patch.pendingDocuments ?? pipe.pendingDocuments ?? [];
      if (pendingDocs.length > 0) {
        const investor = (await tx.select().from(investors).where(eq(investors.id, pipe.investorId)).limit(1))[0];
        const investorName = investor?.name ?? "Investor";

        // Find back_office + ops users in this tenant
        const recipients = await tx.execute(sql`
          SELECT id FROM users
          WHERE tenant_id = ${session.tenantId}
            AND status = 'active'
            AND (roles && ARRAY['back_office','ops']::text[])
        `);
        for (const r of recipients.rows as { id: string }[]) {
          // Dedupe by pipeline id + user — one open notification per pipeline
          const exists = await tx.execute(sql`
            SELECT 1 FROM notifications
            WHERE tenant_id = ${session.tenantId}
              AND user_id = ${r.id}
              AND kind = 'onboarding.documents.pending'
              AND meta->>'pipeline_id' = ${id}
              AND read_at IS NULL
            LIMIT 1
          `);
          if (exists.rows.length) continue;

          await tx.insert(notifications).values({
            id: uuid(),
            tenantId: session.tenantId,
            userId: r.id,
            kind: "onboarding.documents.pending",
            title: `Documents pending — ${investorName}`,
            body: `${pendingDocs.length} document${pendingDocs.length === 1 ? "" : "s"} pending: ${pendingDocs.slice(0, 3).join(", ")}${pendingDocs.length > 3 ? "…" : ""}`,
            linkUrl: `/dashboard/onboarding/${id}`,
            severity: "warning",
            meta: { pipeline_id: id, investor_id: pipe.investorId, pending_docs: pendingDocs } as any,
          } as any);
        }
      }

      // ─── Automation 3 — first investment welcome ─────────────────────────
      // The outbox event 'onboarding.stage.first_investment' is the contract.
      // Any workflow listening for that kind fires (e.g. a welcome WA/email
      // template). We also drop an in-app success notification for the RM.
      if (body.stage === "first_investment" && pipe.assignedRmId) {
        const investor = (await tx.select().from(investors).where(eq(investors.id, pipe.investorId)).limit(1))[0];
        await tx.insert(notifications).values({
          id: uuid(),
          tenantId: session.tenantId,
          userId: pipe.assignedRmId,
          kind: "onboarding.first_investment",
          title: `🎉 First investment booked — ${investor?.name ?? "investor"}`,
          body: `Welcome comm queued. Next stage: Welcome Kit.`,
          linkUrl: `/dashboard/onboarding/${id}`,
          severity: "success",
          meta: { pipeline_id: id } as any,
        } as any);
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "onboarding.stage_done",
        entityType: "onboarding_pipeline",
        entityId: id,
        before: { currentStage: pipe.currentStage },
        after: { stage: body.stage, nextStage: patch.currentStage, allDone },
        ...clientMeta,
      });

      return {
        id,
        currentStage: patch.currentStage,
        stageJustDone: body.stage,
        nextStage,
        allDone,
      };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
