import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET    /api/amc-empanelments/[id]  — read one
 * PATCH  /api/amc-empanelments/[id]  — partial update
 * DELETE /api/amc-empanelments/[id]  — soft-terminate (status=terminated)
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { amcEmpanelments, EMPANELMENT_CATEGORY_VALUES } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const STATUSES = [
  "empanelled",
  "under_review",
  "suspended",
  "terminated",
] as const;

const PatchBody = z.object({
  amcName: z.string().min(1).max(200).optional(),
  category: z.enum(EMPANELMENT_CATEGORY_VALUES as [string, ...string[]]).nullable().optional(),
  distributorCode: z.string().max(80).nullable().optional(),
  empanelmentDate: z.string().nullable().optional(),
  status: z.enum(STATUSES).optional(),
  rmName: z.string().max(120).nullable().optional(),
  rmEmail: z.string().email().nullable().optional().or(z.literal("")),
  rmPhone: z.string().max(40).nullable().optional(),
  opsName: z.string().max(120).nullable().optional(),
  opsEmail: z.string().email().nullable().optional().or(z.literal("")),
  opsPhone: z.string().max(40).nullable().optional(),
  escalationName: z.string().max(120).nullable().optional(),
  escalationEmail: z.string().email().nullable().optional().or(z.literal("")),
  escalationPhone: z.string().max(40).nullable().optional(),
  billingName: z.string().max(120).nullable().optional(),
  billingEmail: z.string().email().nullable().optional().or(z.literal("")),
  billingPhone: z.string().max(40).nullable().optional(),
  additionalContacts: z
    .array(
      z.object({
        role: z.string().min(1).max(60),
        name: z.string().min(1).max(120),
        email: z.string().email().optional().or(z.literal("")),
        phone: z.string().max(40).optional(),
        notes: z.string().max(500).optional(),
      })
    )
    .max(20)
    .optional(),
  portalUrl: z.string().url().nullable().optional().or(z.literal("")),
  trailRateOverridePct: z.number().min(0).max(10).nullable().optional(),
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
  // Network FP 3.1 — investment-committee due diligence
  investmentPhilosophy: z.string().max(4000).nullable().optional(),
  fundHouseStrengths: z.string().max(4000).nullable().optional(),
  redFlags: z.string().max(4000).nullable().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["compliance.edit", "amc_empanelment.view"], session.permissions);
    const { id } = await params;
    const row = await withTenant(session.tenantId, async (tx) => {
      const [r] = await tx
        .select()
        .from(amcEmpanelments)
        .where(eq(amcEmpanelments.id, id))
        .limit(1);
      return r;
    });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ empanelment: row });
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
    requireAny(session.roles, ["compliance.edit", "amc_empanelment.view"], session.permissions);
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
        .from(amcEmpanelments)
        .where(eq(amcEmpanelments.id, id));
      if (!existing) return null;

      const patch: any = { updatedAt: new Date() };
      for (const k of Object.keys(body) as Array<keyof typeof body>) {
        if (body[k] === undefined) continue;
        if (k === "trailRateOverridePct") {
          patch.trailRateOverridePct =
            body.trailRateOverridePct != null
              ? String(body.trailRateOverridePct)
              : null;
        } else if (k === "status" && body.status === "terminated") {
          patch.status = "terminated";
          if (!existing.terminatedAt) {
            patch.terminatedAt = new Date().toISOString().slice(0, 10);
          }
        } else {
          patch[k] = body[k] === "" ? null : body[k];
        }
      }

      const [next] = await tx
        .update(amcEmpanelments)
        .set(patch)
        .where(eq(amcEmpanelments.id, id))
        .returning();

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "amc_empanelment.update",
        entityType: "amc_empanelment",
        entityId: id,
        before: existing,
        after: next,
        ...meta,
      });
      return next;
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ empanelment: result });
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
    requireAny(session.roles, ["compliance.edit", "amc_empanelment.view"], session.permissions);
    const { id } = await params;
    const meta = clientMetaFromHeaders(req.headers);
    const result = await withTenant(session.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(amcEmpanelments)
        .where(eq(amcEmpanelments.id, id));
      if (!existing) return null;
      const today = new Date().toISOString().slice(0, 10);
      const [next] = await tx
        .update(amcEmpanelments)
        .set({ status: "terminated", terminatedAt: today, updatedAt: new Date() } as any)
        .where(eq(amcEmpanelments.id, id))
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "amc_empanelment.terminate",
        entityType: "amc_empanelment",
        entityId: id,
        before: existing,
        after: next,
        ...meta,
      });
      return next;
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ empanelment: result });
  } catch (err: any) {
    return handleApiError(err);
  }
}
