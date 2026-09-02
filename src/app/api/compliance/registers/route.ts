import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/compliance/registers — add a row to one of the AMFI DDQ registers.
 * PATCH — update status / acknowledgement flags on an existing row.
 *
 * register = dsc | incident | unsuitability, mapping to DDQ 4.26, 4.17-4.20b/6.x
 * and 2.4b respectively. Compliance data, so it is capability-gated rather than
 * merely session-gated.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { dscDeclarations, complianceIncidents, unsuitabilityAcks } from "@/db/schema";

export const dynamic = "force-dynamic";

const DscBody = z.object({
  register: z.literal("dsc"),
  financialYear: z.string().min(4).max(12),
  subjectType: z.enum(["self", "sub_distributor"]).default("self"),
  subjectName: z.string().max(200).optional(),
  arn: z.string().max(40).optional(),
  status: z.enum(["pending", "submitted", "acknowledged"]).default("pending"),
  submittedOn: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

const IncidentBody = z.object({
  register: z.literal("incident"),
  kind: z.enum([
    "misselling",
    "third_party_payment",
    "regulatory_action",
    "litigation",
    "arn_euin_suspension",
    "warning_letter",
  ]),
  occurredOn: z.string(),
  title: z.string().min(2).max(300),
  description: z.string().max(4000).optional(),
  amcName: z.string().max(200).optional(),
  reportedToAmc: z.boolean().default(false),
  reportedOn: z.string().optional(),
  remedialAction: z.string().max(4000).optional(),
  status: z.enum(["open", "under_review", "resolved", "closed"]).default("open"),
});

const UnsuitBody = z.object({
  register: z.literal("unsuitability"),
  investorId: z.string().uuid(),
  schemeName: z.string().max(300).optional(),
  transactionRef: z.string().max(120).optional(),
  reason: z.string().min(2).max(2000),
  communicatedOn: z.string(),
  channel: z.string().max(40).optional(),
  clientAcknowledged: z.boolean().default(false),
  acknowledgedOn: z.string().optional(),
  executionOnlyConfirmed: z.boolean().default(false),
  confirmedOn: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

const Body = z.discriminatedUnion("register", [DscBody, IncidentBody, UnsuitBody]);

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["compliance.edit", "settings.masters"], session.permissions);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });
    }
    const b = parsed.data;

    const created = await withTenant(
      session.tenantId,
      async (tx) => {
        if (b.register === "dsc") {
          const [row] = await tx
            .insert(dscDeclarations)
            .values({
              tenantId: session.tenantId,
              financialYear: b.financialYear,
              subjectType: b.subjectType,
              subjectName: b.subjectName ?? null,
              arn: b.arn ?? null,
              status: b.status,
              submittedOn: b.submittedOn || null,
              notes: b.notes ?? null,
            } as any)
            .returning();
          return row;
        }
        if (b.register === "incident") {
          const [row] = await tx
            .insert(complianceIncidents)
            .values({
              tenantId: session.tenantId,
              kind: b.kind,
              occurredOn: b.occurredOn,
              title: b.title,
              description: b.description ?? null,
              amcName: b.amcName ?? null,
              reportedToAmc: b.reportedToAmc,
              reportedOn: b.reportedOn || null,
              remedialAction: b.remedialAction ?? null,
              status: b.status,
            } as any)
            .returning();
          return row;
        }
        const [row] = await tx
          .insert(unsuitabilityAcks)
          .values({
            tenantId: session.tenantId,
            investorId: b.investorId,
            schemeName: b.schemeName ?? null,
            transactionRef: b.transactionRef ?? null,
            reason: b.reason,
            communicatedOn: b.communicatedOn,
            channel: b.channel ?? null,
            clientAcknowledged: b.clientAcknowledged,
            acknowledgedOn: b.acknowledgedOn || null,
            executionOnlyConfirmed: b.executionOnlyConfirmed,
            confirmedOn: b.confirmedOn || null,
            notes: b.notes ?? null,
            createdByUserId: session.userId,
          } as any)
          .returning();
        return row;
      },
      { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles }
    );

    return NextResponse.json({ ok: true, row: created });
  } catch (err) {
    return handleApiError(err);
  }
}

const PatchBody = z.object({
  register: z.enum(["dsc", "incident", "unsuitability"]),
  id: z.string().uuid(),
  patch: z.record(z.string(), z.any()),
});

/** Narrow allow-lists — a PATCH may only move the workflow fields. */
const PATCHABLE: Record<string, string[]> = {
  dsc: ["status", "submittedOn", "notes"],
  incident: ["status", "reportedToAmc", "reportedOn", "remedialAction", "resolution", "closedOn"],
  unsuitability: ["clientAcknowledged", "acknowledgedOn", "executionOnlyConfirmed", "confirmedOn", "notes"],
};

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["compliance.edit", "settings.masters"], session.permissions);
    const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
    const { register, id, patch } = parsed.data;

    const allowed = PATCHABLE[register] ?? [];
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(patch)) if (allowed.includes(k)) clean[k] = v === "" ? null : v;
    if (Object.keys(clean).length === 0) return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    clean.updatedAt = new Date();

    const table =
      register === "dsc" ? dscDeclarations : register === "incident" ? complianceIncidents : unsuitabilityAcks;

    await withTenant(
      session.tenantId,
      async (tx) => {
        await tx.update(table as any).set(clean).where(and(eq((table as any).id, id), eq((table as any).tenantId, session.tenantId)));
      },
      { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles }
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
