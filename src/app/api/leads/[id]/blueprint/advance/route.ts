import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/leads/[id]/blueprint/advance
 *   Body: { toStageKey: string, remarks?: string }
 *
 * Drives the lead through the formal blueprint.
 *
 * Multi-hop forward jumps: the canonical transition graph only defines
 * adjacent transitions (stage N → N+1). If the user picks a stage that
 * is several steps ahead, we walk through each intermediate transition
 * automatically — each hop writes its own stage_history row so the audit
 * trail records the full path. Side-effect: smart-advance auto-fires for
 * every intermediate stage's on-enter recipes too.
 *
 * Backwards moves and sideways branches are still subject to the
 * transition graph (and the role gate).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql, eq, and } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { clientMetaFromHeaders } from "@/lib/audit";
import { transitionTo } from "@/lib/blueprints/engine";
import { leads, tasks } from "@/db/schema";
import { v4 as uuid } from "uuid";
import { loadEditableLead } from "@/lib/leads/access";
import {
  normalizeEmail,
  normalizeLeadSource,
  normalizeLeadStage,
  normalizePan,
  normalizePhoneLast10,
} from "@/lib/leads/normalize";

export const dynamic = "force-dynamic";

const Body = z.object({
  toStageKey: z.string().min(2).max(60),
  remarks: z.string().max(2000).optional(),
  /**
   * Admin-override move. When true, skip the SOP graph check and any
   * multi-hop walk — just stamp the lead at the target stage directly.
   * Set by the Kanban drag-drop (explicit user intent, no need for the
   * SOP to enforce a path). The guided action buttons leave it false so
   * the SOP prereq gates still run.
   */
  force: z.boolean().optional(),
  fields: z.record(z.string(), z.any()).optional(),
  /** ISO/local datetime — when moving to "call_back_later", schedules a
   *  reminder task for the lead owner at this time. */
  callBackAt: z.string().optional(),
  /** When moving to "ucc_activated", store this UCC on the client (investor). */
  uccNumber: z.string().max(40).optional(),
  /** When moving to "mandate_activated", record the active mandate on the
   *  client: which bank it's on, the max debit amount, and the approval ref. */
  mandateBank: z.string().max(140).optional(),
  mandateIfsc: z.string().max(20).optional(),
  mandateAccountMasked: z.string().max(40).optional(),
  mandateAmount: z.number().nonnegative().optional(),
  mandateRef: z.string().max(60).optional(),
});

/** Store the activated UCC on the client master (the lead's converted investor,
 *  or the investor directly when the blueprint subject is already a client). */
async function storeClientUcc(tx: any, tenantId: string, leadId: string, ucc: string): Promise<void> {
  const v = ucc.trim();
  if (!v) return;
  await tx.execute(sql`
    UPDATE investors SET bse_ucc_code = ${v}, updated_at = now()
    WHERE tenant_id = ${tenantId}::uuid
      AND (id = (SELECT converted_investor_id FROM leads WHERE id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid)
           OR id = ${leadId}::uuid)
  `);
}

/** Store the activated SIP mandate on the client master: status → active, the
 *  approval reference, the max debit amount, and the bank it's drawn on (which
 *  also fills the client's primary bank columns). */
async function storeClientMandate(
  tx: any,
  tenantId: string,
  leadId: string,
  m: { bank?: string; ifsc?: string; masked?: string; amount?: number; ref?: string }
): Promise<void> {
  await tx.execute(sql`
    UPDATE investors SET
      mandate_status = 'active',
      mandate_ref_no = COALESCE(${m.ref ?? null}, mandate_ref_no),
      mandate_amount = COALESCE(${m.amount ?? null}, mandate_amount),
      bank_name = COALESCE(${m.bank ?? null}, bank_name),
      bank_ifsc = COALESCE(${m.ifsc ?? null}, bank_ifsc),
      bank_account_masked = COALESCE(${m.masked ?? null}, bank_account_masked),
      updated_at = now()
    WHERE tenant_id = ${tenantId}::uuid
      AND (id = (SELECT converted_investor_id FROM leads WHERE id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid)
           OR id = ${leadId}::uuid)
  `);
}

/** Stages whose transition schedules a next-touch reminder for the lead owner so
 *  parked leads never go silent. (call_back_later already did; the other two
 *  loop stages promised "resurface" but scheduled nothing.) */
const NEXT_TOUCH_STAGES = ["call_back_later", "call_not_connected", "contact_in_future"];

/** Create a next-touch reminder task for the lead owner at the chosen time. The
 *  wording adapts to the loop stage (call back vs long-term re-engagement). */
async function scheduleNextTouchReminder(
  tx: any,
  tenantId: string,
  leadId: string,
  fallbackAssigneeId: string,
  callBackAt: string,
  stageKey: string
): Promise<void> {
  const due = new Date(callBackAt);
  if (isNaN(due.getTime())) return; // ignore an unparseable date rather than fail the move
  const lr = await tx.execute(
    sql`SELECT name, owner_id FROM leads WHERE id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1`
  );
  const lead = lr.rows[0] as { name?: string; owner_id?: string } | undefined;
  const title =
    stageKey === "contact_in_future"
      ? `Re-engage lead: ${lead?.name ?? "lead"}`
      : `Call back: ${lead?.name ?? "lead"}`;
  await tx.insert(tasks).values({
    id: uuid(),
    tenantId,
    assigneeId: lead?.owner_id ?? fallbackAssigneeId,
    subjectType: "lead",
    subjectId: leadId,
    relatedLeadId: leadId,
    type: "follow_up",
    title,
    priority: "normal",
    status: "open",
    dueAt: due,
  } as any);
}

/** On a bank-rejected mandate, create a high-priority task to re-do it. Assigned
 *  to the lead owner (or the acting user if none). */
async function createRedoMandateTask(tx: any, tenantId: string, leadId: string, fallbackAssigneeId: string): Promise<void> {
  const lr = await tx.execute(
    sql`SELECT name, owner_id FROM leads WHERE id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1`
  );
  const lead = lr.rows[0] as { name?: string; owner_id?: string } | undefined;
  await tx.insert(tasks).values({
    id: uuid(),
    tenantId,
    assigneeId: lead?.owner_id ?? fallbackAssigneeId,
    subjectType: "lead",
    subjectId: leadId,
    relatedLeadId: leadId,
    type: "follow_up",
    title: `Re-do SIP mandate — bank rejected: ${lead?.name ?? "client"}`,
    description: "The bank rejected the mandate. Resolve the issue and re-register the NACH / e-mandate.",
    priority: "high",
    status: "open",
  } as any);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    // Capability gate (ownership is further enforced by loadEditableLead).
    requireAny(session.roles, ["lead.edit.all", "lead.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const { id } = await params;
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { remarks, force, fields, callBackAt, uccNumber, mandateBank, mandateIfsc, mandateAccountMasked, mandateAmount, mandateRef } = parsed.data;

    // Validate the target stage. normalizeLeadStage() falls back to "new" for
    // unrecognized input — detect that silent coercion and 400, instead of
    // (under force) stamping the lead backward to stage 1.
    const toStageKey = normalizeLeadStage(parsed.data.toStageKey);
    const rawKey = parsed.data.toStageKey.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (toStageKey === "new" && rawKey !== "new") {
      return NextResponse.json({ error: `Unknown stage "${parsed.data.toStageKey}"` }, { status: 400 });
    }

    const clientMeta = clientMetaFromHeaders(req.headers);

    const res = await withTenant(session.tenantId, async (tx) => {
      await loadEditableLead(tx, session, id);

      // Update any required fields collected during the transition
      const safeFields = sanitizeLeadFields(fields);
      if (Object.keys(safeFields).length > 0) {
        await tx
          .update(leads)
          .set({
            ...safeFields,
            updatedAt: new Date(),
          })
          .where(and(eq(leads.id, id), eq(leads.tenantId, session.tenantId)));
      }

      // Force mode — admin override — (e.g. Kanban drag). Skip the SOP graph
      // and just move directly. No walk, no intermediate history rows. The move
      // is audit-logged (forced=true) by transitionTo.
      if (force) {
        return await transitionTo(tx, session.tenantId, id, toStageKey, {
          actorUserId: session.userId,
          actorRoles: session.roles ?? [],
          remarks: remarks ?? `Forced move via Kanban drag.`,
          systemBypass: true,
          ...clientMeta,
        });
      }

      // 1. Try the direct one-hop transition first — the cheap path.
      const first = await transitionTo(tx, session.tenantId, id, toStageKey, {
        actorUserId: session.userId,
        actorRoles: session.roles ?? [],
        remarks,
        ...clientMeta,
      });
      if (first.ok) {
        if (NEXT_TOUCH_STAGES.includes(toStageKey) && callBackAt) {
          await scheduleNextTouchReminder(tx, session.tenantId, id, session.userId, callBackAt, toStageKey);
        }
        if (toStageKey === "ucc_activated" && uccNumber) {
          await storeClientUcc(tx, session.tenantId, id, uccNumber);
        }
        if (toStageKey === "mandate_activated") {
          await storeClientMandate(tx, session.tenantId, id, {
            bank: mandateBank?.trim() || undefined,
            ifsc: mandateIfsc?.trim() || undefined,
            masked: mandateAccountMasked?.trim() || undefined,
            amount: mandateAmount,
            ref: mandateRef?.trim() || undefined,
          });
        }
        if (toStageKey === "mandate_reject") {
          await createRedoMandateTask(tx, session.tenantId, id, session.userId);
        }
        return first;
      }
      // Don't let the multi-hop walk silently bypass a prerequisite / role /
      // terminal block from the direct hop — surface it so the user fixes it.
      if (first.code === "prereq" || first.code === "role" || first.code === "terminal") return first;

      // 2. No direct transition. If the target stage is forward in the
      //    canonical order, walk hop-by-hop along the **happy path**
      //    (skipping dead-end branches like not_qualified, call-back
      //    loops, and retry stages) so multi-step jumps stay on the
      //    main SOP rail.
      const HAPPY_PATH = [
        "new",
        "call_done",
        "meeting_scheduled",
        "meeting_done",
        "won_lead",
        "request_documents",
        "documents_pending",
        "documents_received",
        "kyc_validated",
        "ucc_create",
        "ucc_activated",
        "mandate_create",
        "mandate_activated",
        "make_transaction",
        "transaction_successful",
        "family_mapping",
        "update_information",
        "add_in_review_sheet",
      ];
      const targetIdx = HAPPY_PATH.indexOf(toStageKey);
      if (targetIdx < 0) return first; // off-path target (e.g. kyc_pending) — keep original error

      // Look up the lead's current stage to compute distance.
      const cur = await tx.execute(sql`
        SELECT current_stage_key FROM lead_blueprint_instances WHERE lead_id = ${id}::uuid LIMIT 1
      `);
      const currentKey = (cur.rows[0] as any)?.current_stage_key as string | undefined;
      const currentIdx = currentKey ? HAPPY_PATH.indexOf(currentKey) : -1;
      if (currentIdx < 0 || targetIdx <= currentIdx) {
        // Current stage isn't on the happy path, or move is backwards/unchanged.
        // Return the original error — caller can retry with force=true.
        return first;
      }

      // Walk forward along the happy path. Each hop uses systemBypass so
      // the intermediate transitions don't need to be defined in the graph.
      // Intermediate hops suppress their on-enter/on-exit automations — a stage
      // the lead only passes THROUGH shouldn't fire its recipes; only the final
      // target stage does.
      let last = first;
      for (let i = currentIdx + 1; i <= targetIdx; i++) {
        const nextKey = HAPPY_PATH[i];
        const isFinal = i === targetIdx;
        last = await transitionTo(tx, session.tenantId, id, nextKey, {
          actorUserId: session.userId,
          actorRoles: session.roles ?? [],
          remarks: isFinal ? remarks : `Auto-skipped en route to ${toStageKey}`,
          systemBypass: true,
          suppressAutomations: !isFinal,
          ...clientMeta,
        });
        if (!last.ok) return last;
      }
      return last;
    });

    if (!res.ok) {
      return NextResponse.json({ error: res.reason }, { status: 409 });
    }
    return NextResponse.json(res);
  } catch (err: any) {
    return handleApiError(err);
  }
}

function sanitizeLeadFields(fields?: Record<string, any>) {
  if (!fields) return {};
  const out: Record<string, any> = {};
  if (typeof fields.name === "string") out.name = fields.name.trim();
  if (typeof fields.email === "string") {
    out.email = fields.email.trim() || null;
    out.emailNormalized = normalizeEmail(fields.email);
  }
  if (typeof fields.phone === "string") {
    out.phone = fields.phone.trim() || null;
    out.phoneNormalized = normalizePhoneLast10(fields.phone);
  }
  if (typeof fields.pan === "string") out.pan = normalizePan(fields.pan);
  if (typeof fields.city === "string") out.city = fields.city.trim() || null;
  if (typeof fields.pincode === "string") out.pincode = fields.pincode.trim() || null;
  if (typeof fields.intendedAmount === "string" || typeof fields.intendedAmount === "number") {
    out.intendedAmount = String(fields.intendedAmount).trim() || null;
  }
  if (typeof fields.source === "string") out.source = normalizeLeadSource(fields.source);
  if (typeof fields.nextFollowUpAt === "string") out.nextFollowUpAt = new Date(fields.nextFollowUpAt);
  if (typeof fields.lostReason === "string") out.lostReason = fields.lostReason.trim() || null;
  if (typeof fields.lostAt === "string") out.lostAt = new Date(fields.lostAt);
  return out;
}
