import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET  /api/product-offerings    — list (?status, ?category, ?q)
 * POST /api/product-offerings    — create
 *
 * Owner / compliance only.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, and, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
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

const PostBody = z.object({
  name: z.string().min(1).max(160),
  category: z.enum(CATEGORIES).default("other"),
  providers: z.array(z.string().max(120)).max(30).default([]),
  regulator: z.enum(REGULATORS).default("Other"),
  linkedRegistrationIds: z.array(z.string().uuid()).max(20).default([]),
  requiredExams: z.array(z.string().max(80)).max(20).default([]),
  teamMemberIds: z.array(z.string().uuid()).max(50).default([]),
  status: z.enum(STATUSES).default("active"),
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
    .default([]),
  remarks: z.string().max(4000).nullable().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    // Read access is open to any team member (sales needs the catalog to know
    // what's pitchable); creates/edits stay gated to compliance.edit (POST).
    await assertActiveLicense(session.tenantId, session.roles);

    const sp = req.nextUrl.searchParams;
    const status = sp.get("status");
    const category = sp.get("category");
    const q = (sp.get("q") ?? "").trim();

    const rows = await withTenant(session.tenantId, async (tx) => {
      const where = [eq(productOfferings.tenantId, session.tenantId)];
      if (status) where.push(eq(productOfferings.status, status as any));
      if (category) where.push(eq(productOfferings.category, category as any));
      if (q) {
        where.push(
          or(
            ilike(productOfferings.name, `%${q}%`),
            ilike(productOfferings.remarks, `%${q}%`)
          )!
        );
      }
      return tx
        .select()
        .from(productOfferings)
        .where(and(...where))
        .orderBy(productOfferings.name);
    });
    return NextResponse.json({ offerings: rows });
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
        .insert(productOfferings)
        .values({
          tenantId: session.tenantId,
          name: data.name,
          category: data.category,
          providers: data.providers,
          regulator: data.regulator,
          linkedRegistrationIds: data.linkedRegistrationIds,
          requiredExams: data.requiredExams,
          teamMemberIds: data.teamMemberIds,
          status: data.status,
          launchedAt: data.launchedAt || null,
          discontinuedAt: data.discontinuedAt || null,
          documents: data.documents,
          remarks: data.remarks || null,
          createdBy: session.userId,
        } as any)
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "product_offering.create",
        entityType: "product_offering",
        entityId: r.id,
        before: null,
        after: r,
        ...meta,
      });
      return r;
    });
    return NextResponse.json({ offering: row });
  } catch (err: any) {
    return handleApiError(err);
  }
}
