import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET    /api/product-offerings/[id]
 * PATCH  /api/product-offerings/[id]
 * DELETE /api/product-offerings/[id]  — soft-discontinue
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { productOfferings } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const CATEGORIES = [
  "mutual_funds",
  "insurance_life",
  "insurance_general",
  "insurance_health",
  "pms",
  "aif",
  "bonds",
  "corporate_fd",
  "nps",
  "equity",
  "tax_planning",
  "estate_planning",
  "advisory",
  "loans",
  "real_estate",
  "international",
  "other",
] as const;
const STATUSES = ["active", "paused", "discontinued"] as const;
const REGULATORS = [
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

const PatchBody = z.object({
  name: z.string().min(1).max(160).optional(),
  category: z.enum(CATEGORIES).optional(),
  providers: z.array(z.string().max(120)).max(30).optional(),
  regulator: z.enum(REGULATORS).optional(),
  linkedRegistrationIds: z.array(z.string().uuid()).max(20).optional(),
  requiredExams: z.array(z.string().max(80)).max(20).optional(),
  teamMemberIds: z.array(z.string().uuid()).max(50).optional(),
  status: z.enum(STATUSES).optional(),
  launchedAt: z.string().nullable().optional(),
  discontinuedAt: z.string().nullable().optional(),
  documents: z
    .array(
      z.object({
        label: z.string().min(1).max(120),
        url: z.string().url(),
        uploadedAt: z.string().optional(),
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
        .from(productOfferings)
        .where(eq(productOfferings.id, id))
        .limit(1);
      return r;
    });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ offering: row });
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
        .from(productOfferings)
        .where(eq(productOfferings.id, id));
      if (!existing) return null;
      const patch: any = { updatedAt: new Date() };
      for (const k of Object.keys(body) as Array<keyof typeof body>) {
        if (body[k] === undefined) continue;
        if (k === "status" && body.status === "discontinued") {
          patch.status = "discontinued";
          if (!existing.discontinuedAt) {
            patch.discontinuedAt = new Date().toISOString().slice(0, 10);
          }
        } else {
          patch[k] = body[k] === "" ? null : body[k];
        }
      }
      const [next] = await tx
        .update(productOfferings)
        .set(patch)
        .where(eq(productOfferings.id, id))
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "product_offering.update",
        entityType: "product_offering",
        entityId: id,
        before: existing,
        after: next,
        ...meta,
      });
      return next;
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ offering: result });
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
    const result = await withTenant(session.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(productOfferings)
        .where(eq(productOfferings.id, id));
      if (!existing) return null;
      const today = new Date().toISOString().slice(0, 10);
      const [next] = await tx
        .update(productOfferings)
        .set({
          status: "discontinued",
          discontinuedAt: today,
          updatedAt: new Date(),
        } as any)
        .where(eq(productOfferings.id, id))
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "product_offering.discontinue",
        entityType: "product_offering",
        entityId: id,
        before: existing,
        after: next,
        ...meta,
      });
      return next;
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ offering: result });
  } catch (err: any) {
    return handleApiError(err);
  }
}
