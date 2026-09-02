import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/investors/[id]/doc-completeness?clientType=individual|huf|nri|minor|company|trust
 *
 * Returns the KYC document-completeness for a client: required checklist vs.
 * what's actually been uploaded. clientType defaults to the client's category
 * (minor → minor) else 'individual'; an explicit query param overrides.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { complianceDocuments, investors } from "@/db/schema";
import { computeCompleteness } from "@/lib/onboarding/doc-completeness";
import { CLIENT_TYPE_LABELS, type ClientType } from "@/lib/onboarding/doc-checklists";

export const dynamic = "force-dynamic";

const VALID = new Set(Object.keys(CLIENT_TYPE_LABELS));

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "document.view", session.permissions);
    const override = (new URL(req.url).searchParams.get("clientType") ?? "").toLowerCase();

    const out = await withTenant(session.tenantId, async (tx) => {
      const [inv] = await tx
        .select({ id: investors.id, category: investors.investorCategory })
        .from(investors)
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
        .limit(1);
      if (!inv) return null;

      const docs = await tx
        .select({ id: complianceDocuments.id, name: complianceDocuments.name, description: complianceDocuments.description, tags: complianceDocuments.tags })
        .from(complianceDocuments)
        .where(
          and(
            eq(complianceDocuments.tenantId, session.tenantId),
            eq(complianceDocuments.relatedEntityType, "investor"),
            eq(complianceDocuments.relatedEntityId, id)
          )
        )
        .orderBy(desc(complianceDocuments.createdAt));

      // Map the investor's stored category onto a checklist client-type.
      const fromCategory = ((): ClientType => {
        const c = inv.category ?? "";
        if (c === "corporate" || c === "company") return "company";
        if (VALID.has(c)) return c as ClientType;
        return "individual";
      })();
      const clientType: ClientType = VALID.has(override) ? (override as ClientType) : fromCategory;

      return computeCompleteness(
        docs.map((d) => ({ id: d.id, name: d.name, description: d.description, tags: (d.tags as string[]) ?? [] })),
        clientType
      );
    });

    if (!out) return NextResponse.json({ error: "client not found" }, { status: 404 });
    return NextResponse.json(out);
  } catch (err: any) {
    return handleApiError(err);
  }
}
