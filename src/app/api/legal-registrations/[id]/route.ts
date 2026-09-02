import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET    /api/legal-registrations/[id]  — read one
 * PATCH  /api/legal-registrations/[id]  — partial update
 * DELETE /api/legal-registrations/[id]  — soft-surrender (status=surrendered)
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { legalRegistrations } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const AUTHORITIES = [
  "AMFI",
  "SEBI",
  "IRDAI",
  "GST",
  "Income_Tax",
  "MCA",
  "RBI",
  "State_Govt",
  "Local_Authority",
  "Trademark_Registry",
  "FIU_IND",
  "Other",
] as const;
const FREQUENCIES = [
  "perpetual",
  "annual",
  "biennial",
  "triennial",
  "5_year",
  "10_year",
  "on_demand",
  "other",
] as const;
const STATUSES = [
  "active",
  "expired",
  "pending_renewal",
  "surrendered",
  "rejected",
] as const;

const PatchBody = z.object({
  registeredInNameOf: z.string().min(1).max(200).optional(),
  authority: z.enum(AUTHORITIES).optional(),
  authorityOther: z.string().max(80).nullable().optional(),
  registrationFor: z.string().min(1).max(300).optional(),
  registrationNumber: z.string().max(80).nullable().optional(),
  registrationDate: z.string().nullable().optional(),
  expiryAt: z.string().nullable().optional(),
  renewalFrequency: z.enum(FREQUENCIES).optional(),
  renewalDetails: z.string().max(2000).nullable().optional(),
  status: z.enum(STATUSES).optional(),
  documents: z
    .array(
      z.object({
        label: z.string().min(1).max(120),
        url: z.string().url(),
        uploadedAt: z.string().optional(),
        uploadedBy: z.string().optional(),
      })
    )
    .max(20)
    .optional(),
  remarks: z.string().max(4000).nullable().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    const { id } = await params;
    const row = await withTenant(session.tenantId, async (tx) => {
      const [r] = await tx
        .select()
        .from(legalRegistrations)
        .where(eq(legalRegistrations.id, id))
        .limit(1);
      return r;
    });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ registration: row });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    const { id } = await params;
    const parse = PatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const meta = clientMetaFromHeaders(req.headers);
    const body = parse.data;

    const result = await withTenant(session.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(legalRegistrations)
        .where(eq(legalRegistrations.id, id));
      if (!existing) return null;

      const patch: any = { updatedAt: new Date() };
      for (const k of Object.keys(body) as Array<keyof typeof body>) {
        if (body[k] === undefined) continue;
        patch[k] = body[k] === "" ? null : body[k];
      }

      const [next] = await tx
        .update(legalRegistrations)
        .set(patch)
        .where(eq(legalRegistrations.id, id))
        .returning();

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "legal_registration.update",
        entityType: "legal_registration",
        entityId: id,
        before: existing,
        after: next,
        ...meta,
      });
      return next;
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ registration: result });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    const { id } = await params;
    const meta = clientMetaFromHeaders(req.headers);

    // Soft-surrender: status=surrendered. Hard-delete would lose the
    // historical record of "we used to hold this license" which
    // inspectors might ask about.
    const result = await withTenant(session.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(legalRegistrations)
        .where(eq(legalRegistrations.id, id));
      if (!existing) return null;
      const [next] = await tx
        .update(legalRegistrations)
        .set({ status: "surrendered", updatedAt: new Date() } as any)
        .where(eq(legalRegistrations.id, id))
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "legal_registration.surrender",
        entityType: "legal_registration",
        entityId: id,
        before: existing,
        after: next,
        ...meta,
      });
      return next;
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ registration: result });
  } catch (err: any) {
    return handleApiError(err);
  }
}
