import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET  /api/amc-empanelments    — list (?status, ?q)
 * POST /api/amc-empanelments    — create (one row per AMC per tenant)
 *
 * Owner / compliance only.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, and, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { amcEmpanelments, EMPANELMENT_CATEGORY_VALUES } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const STATUSES = [
  "empanelled",
  "under_review",
  "suspended",
  "terminated",
] as const;

const AdditionalContactSchema = z.object({
  role: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(40).optional(),
  notes: z.string().max(500).optional(),
});

const DocumentSchema = z.object({
  label: z.string().min(1).max(120),
  url: z.string().url(),
  uploadedAt: z.string().optional(),
  uploadedBy: z.string().optional(),
});

const PostBody = z.object({
  amcCode: z.string().min(1).max(60),
  category: z.enum(EMPANELMENT_CATEGORY_VALUES as [string, ...string[]]).nullable().optional(),
  amcName: z.string().min(1).max(200),
  distributorCode: z.string().max(80).nullable().optional(),
  empanelmentDate: z.string().nullable().optional(),
  status: z.enum(STATUSES).default("empanelled"),
  rmName: z.string().max(120).nullable().optional(),
  rmEmail: z.string().email().nullable().optional().or(z.literal("")),
  rmPhone: z.string().max(40).nullable().optional(),
  opsName: z.string().max(120).nullable().optional(),
  opsEmail: z.string().email().nullable().optional().or(z.literal("")),
  opsPhone: z.string().max(40).nullable().optional(),
  escalationName: z.string().max(120).nullable().optional(),
  escalationEmail: z.string().email().nullable().optional().or(z.literal("")),
  escalationPhone: z.string().max(40).nullable().optional(),
  additionalContacts: z.array(AdditionalContactSchema).max(20).default([]),
  portalUrl: z.string().url().nullable().optional().or(z.literal("")),
  trailRateOverridePct: z.number().min(0).max(10).nullable().optional(),
  documents: z.array(DocumentSchema).max(20).default([]),
  remarks: z.string().max(4000).nullable().optional(),
  // Network FP 3.1 — investment-committee due diligence
  investmentPhilosophy: z.string().max(4000).nullable().optional(),
  fundHouseStrengths: z.string().max(4000).nullable().optional(),
  redFlags: z.string().max(4000).nullable().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["compliance.edit", "amc_empanelment.view"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const sp = req.nextUrl.searchParams;
    const status = sp.get("status");
    const q = (sp.get("q") ?? "").trim();

    const rows = await withTenant(session.tenantId, async (tx) => {
      const where = [eq(amcEmpanelments.tenantId, session.tenantId)];
      if (status) where.push(eq(amcEmpanelments.status, status as any));
      if (q) {
        where.push(
          or(
            ilike(amcEmpanelments.amcName, `%${q}%`),
            ilike(amcEmpanelments.amcCode, `%${q}%`),
            ilike(amcEmpanelments.distributorCode, `%${q}%`),
            ilike(amcEmpanelments.rmName, `%${q}%`),
            ilike(amcEmpanelments.rmEmail, `%${q}%`)
          )!
        );
      }
      return tx
        .select()
        .from(amcEmpanelments)
        .where(and(...where))
        .orderBy(amcEmpanelments.amcName);
    });
    return NextResponse.json({ empanelments: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["compliance.edit", "amc_empanelment.view"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = PostBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const meta = clientMetaFromHeaders(req.headers);
    const data = parse.data;

    try {
      const row = await withTenant(session.tenantId, async (tx) => {
        const [r] = await tx
          .insert(amcEmpanelments)
          .values({
            tenantId: session.tenantId,
            amcCode: data.amcCode,
            amcName: data.amcName,
            distributorCode: data.distributorCode || null,
            empanelmentDate: data.empanelmentDate || null,
            status: data.status,
            rmName: data.rmName || null,
            rmEmail: data.rmEmail || null,
            rmPhone: data.rmPhone || null,
            opsName: data.opsName || null,
            opsEmail: data.opsEmail || null,
            opsPhone: data.opsPhone || null,
            escalationName: data.escalationName || null,
            escalationEmail: data.escalationEmail || null,
            escalationPhone: data.escalationPhone || null,
            additionalContacts: data.additionalContacts,
            portalUrl: data.portalUrl || null,
            trailRateOverridePct:
              data.trailRateOverridePct != null
                ? String(data.trailRateOverridePct)
                : null,
            documents: data.documents,
            remarks: data.remarks || null,
            investmentPhilosophy: data.investmentPhilosophy || null,
            fundHouseStrengths: data.fundHouseStrengths || null,
            redFlags: data.redFlags || null,
            createdBy: session.userId,
          } as any)
          .returning();

        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "amc_empanelment.create",
          entityType: "amc_empanelment",
          entityId: r.id,
          before: null,
          after: r,
          ...meta,
        });
        return r;
      });
      return NextResponse.json({ empanelment: row });
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      if (msg.includes("amc_empanelments_tenant_amc_unique")) {
        return NextResponse.json(
          {
            error:
              "An empanelment for this AMC already exists. Edit the existing row instead.",
          },
          { status: 409 }
        );
      }
      throw err;
    }
  } catch (err: any) {
    return handleApiError(err);
  }
}
