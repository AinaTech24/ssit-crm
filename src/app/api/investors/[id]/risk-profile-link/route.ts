/**
 * POST /api/investors/[id]/risk-profile-link
 *
 * Mints a public, single-use share-token link (/r/<token>) the RM can hand a
 * client so THEY fill the risk-profile questionnaire themselves — a third
 * route alongside the two already on the wizard (RM enters answers + OTP, or
 * RM uploads a signed paper form). The client lands on the link with no
 * login, is scored against the tenant's published template, and confirms via
 * email OTP on their own (verificationMethod "client_link" downstream).
 *
 * Reuses the same createShareToken() the "send risk profile link" WORKFLOW
 * action already used — this route is what was missing: a manual, ad-hoc way
 * for an RM to trigger the same link from the client's own page, not just
 * from an automated rule.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { investors } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { createShareToken } from "@/lib/share-tokens";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    requireCap(session.roles, "risk_profile.manage", session.permissions);

    const inv = await withTenant(session.tenantId, async (tx) => {
      const [row] = await tx
        .select({ id: investors.id, name: investors.name, phone: investors.phone, email: investors.email })
        .from(investors)
        .where(eq(investors.id, id))
        .limit(1);
      return row ?? null;
    });
    if (!inv) return NextResponse.json({ error: "investor not found" }, { status: 404 });

    const { url, expiresAt } = await createShareToken({
      tenantId: session.tenantId,
      kind: "risk_profile",
      subjectType: "investor",
      subjectId: id,
      createdBy: session.userId,
      expiresInDays: 14,
    });

    return NextResponse.json({
      url,
      expiresAt,
      investorName: inv.name,
      phone: inv.phone ?? null,
      email: inv.email ?? null,
    });
  } catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 500;
    return NextResponse.json({ error: err?.message ?? "failed" }, { status });
  }
}
