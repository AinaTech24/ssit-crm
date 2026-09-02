import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/investors/[id]/portfolio-link
 *   Mints a long-lived, login-free read-only portfolio link (share token,
 *   kind=portfolio_view) and returns the URL + a pre-filled wa.me message so
 *   the RM can share it on WhatsApp. Lightweight transparency without a portal.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { investors, tenants } from "@/db/schema";
import { createShareToken } from "@/lib/share-tokens";

export const dynamic = "force-dynamic";

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `91${digits}`;
  return digits;
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);

    const ctx = await withTenant(session.tenantId, async (tx) => {
      const [inv] = await tx
        .select({ id: investors.id, name: investors.name, phone: investors.phone })
        .from(investors)
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
        .limit(1);
      if (!inv) return null;
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
      return { inv, tenant: t as any };
    });
    if (!ctx) return NextResponse.json({ error: "not found" }, { status: 404 });

    const { url } = await createShareToken({
      tenantId: session.tenantId,
      kind: "portfolio_view",
      subjectType: "investor",
      subjectId: id,
      expiresInDays: 365,
      createdBy: session.userId,
    });
    // Share the portfolio STATEMENT PDF (same document as "Download statement"),
    // served login-free against this token — not the lightweight web view.
    const pdfUrl = `${url}/pdf`;

    let waUrl: string | null = null;
    const phone = normalizePhone(ctx.inv.phone);
    if (phone) {
      const text = [
        `Hi ${ctx.inv.name ?? ""},`,
        "",
        "Here is your latest portfolio statement (no login needed):",
        pdfUrl,
        "",
        `— ${ctx.tenant?.displayName ?? ""}`,
        `ARN ${ctx.tenant?.arn ?? "—"}`,
      ].join("\n");
      waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    }

    return NextResponse.json({ ok: true, url: pdfUrl, waUrl });
  } catch (err: any) {
    return handleApiError(err);
  }
}
