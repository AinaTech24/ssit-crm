import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET  /api/legal-registrations    — list (?status, ?authority, ?q)
 * POST /api/legal-registrations    — create
 *
 * Owner / compliance only — this is regulator-facing data.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, and, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
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

const DocumentSchema = z.object({
  label: z.string().min(1).max(120),
  url: z.string().url(),
  uploadedAt: z.string().optional(),
  uploadedBy: z.string().optional(),
});

const PostBody = z.object({
  registeredInNameOf: z.string().min(1).max(200),
  authority: z.enum(AUTHORITIES).default("Other"),
  authorityOther: z.string().max(80).nullable().optional(),
  registrationFor: z.string().min(1).max(300),
  registrationNumber: z.string().max(80).nullable().optional(),
  registrationDate: z.string().nullable().optional(),
  expiryAt: z.string().nullable().optional(),
  renewalFrequency: z.enum(FREQUENCIES).default("annual"),
  renewalDetails: z.string().max(2000).nullable().optional(),
  status: z.enum(STATUSES).default("active"),
  documents: z.array(DocumentSchema).max(20).default([]),
  remarks: z.string().max(4000).nullable().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const sp = req.nextUrl.searchParams;
    const status = sp.get("status");
    const authority = sp.get("authority");
    const q = (sp.get("q") ?? "").trim();

    const rows = await withTenant(session.tenantId, async (tx) => {
      const where = [eq(legalRegistrations.tenantId, session.tenantId)];
      if (status) where.push(eq(legalRegistrations.status, status as any));
      if (authority) where.push(eq(legalRegistrations.authority, authority as any));
      if (q) {
        where.push(
          or(
            ilike(legalRegistrations.registeredInNameOf, `%${q}%`),
            ilike(legalRegistrations.registrationFor, `%${q}%`),
            ilike(legalRegistrations.registrationNumber, `%${q}%`),
            ilike(legalRegistrations.authorityOther, `%${q}%`)
          )!
        );
      }
      return tx
        .select()
        .from(legalRegistrations)
        .where(and(...where))
        .orderBy(legalRegistrations.expiryAt);
    });
    return NextResponse.json({ registrations: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
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
    const row = await withTenant(session.tenantId, async (tx) => {
      const [r] = await tx
        .insert(legalRegistrations)
        .values({
          tenantId: session.tenantId,
          registeredInNameOf: data.registeredInNameOf,
          authority: data.authority,
          authorityOther: data.authorityOther || null,
          registrationFor: data.registrationFor,
          registrationNumber: data.registrationNumber || null,
          registrationDate: data.registrationDate || null,
          expiryAt: data.expiryAt || null,
          renewalFrequency: data.renewalFrequency,
          renewalDetails: data.renewalDetails || null,
          status: data.status,
          documents: data.documents,
          remarks: data.remarks || null,
          createdBy: session.userId,
        } as any)
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "legal_registration.create",
        entityType: "legal_registration",
        entityId: r.id,
        before: null,
        after: r,
        ...meta,
      });
      return r;
    });
    return NextResponse.json({ registration: row });
  } catch (err: any) {
    return handleApiError(err);
  }
}
