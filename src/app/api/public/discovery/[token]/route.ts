import { handleApiError } from "@/lib/api/error-handler";
/**
 * Public Financial Discovery ("Financial Health Check") endpoints — no auth.
 *   GET  /api/public/discovery/[token]  — form data + firm branding for rendering
 *   POST /api/public/discovery/[token]  — client submits their sections
 *
 * The client fills only their own sections (identity, income, expenses, assets,
 * liabilities, insurance, goals). The advisor assessment is never sent to or
 * accepted from the client. Single-use: claimed on submit.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { financialDiscoveries, tenants } from "@/db/schema";
import { resolveShareToken, claimShareToken, finalizeShareToken, releaseShareToken } from "@/lib/share-tokens";
import { computeDiscovery, type DiscoveryData } from "@/lib/discovery/calc";
import { enforce } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Client-editable sections — the advisor assessment is intentionally excluded. */
const CLIENT_SECTIONS = ["identification", "income", "expenses", "surplusInputs", "assets", "liabilities", "lifeInsurance", "healthInsurance", "goals"] as const;

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const limited = enforce(req, `discovery.get.${token.slice(0, 12)}`, { limit: 60, windowSec: 60 });
    if (limited) return limited;

    const tk = await resolveShareToken(token);
    if (tk.kind !== "financial_discovery") return NextResponse.json({ error: "Invalid link" }, { status: 400 });
    const discoveryId = (tk.payload as any)?.discoveryId as string | undefined;
    if (!discoveryId) return NextResponse.json({ error: "Invalid link" }, { status: 400 });

    const out = await withTenant(tk.tenantId, async (tx) => {
      const disc = (await tx.select().from(financialDiscoveries).where(eq(financialDiscoveries.id, discoveryId)).limit(1))[0];
      const tenant = (await tx.select({ name: tenants.displayName, logo: tenants.logoUrl }).from(tenants).where(eq(tenants.id, tk.tenantId)).limit(1))[0];
      return { disc, tenant };
    });
    if (!out.disc) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Strip the advisor assessment before sending to the client.
    const data = { ...(out.disc.data as any) };
    delete data.assessment;
    delete data.recommendations;

    return NextResponse.json({
      firmName: out.tenant?.name ?? "Your advisor",
      firmLogo: out.tenant?.logo ?? null,
      reviewType: out.disc.reviewType,
      data,
      alreadySubmitted: out.disc.status === "submitted" || out.disc.status === "reviewed",
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "This link is not available" }, { status: 400 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const limited = enforce(req, `discovery.post.${token.slice(0, 12)}`, { limit: 10, windowSec: 60 });
    if (limited) return limited;

    const tk = await resolveShareToken(token);
    if (tk.kind !== "financial_discovery") return NextResponse.json({ error: "Invalid link" }, { status: 400 });
    const discoveryId = (tk.payload as any)?.discoveryId as string | undefined;
    if (!discoveryId) return NextResponse.json({ error: "Invalid link" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const incoming = (body?.data ?? {}) as Record<string, any>;

    // Atomically claim the single-use token before writing.
    if (!(await claimShareToken(tk.id))) {
      return NextResponse.json({ error: "This link has already been submitted." }, { status: 409 });
    }

    try {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
      await withTenant(tk.tenantId, async (tx) => {
        const disc = (await tx.select().from(financialDiscoveries).where(eq(financialDiscoveries.id, discoveryId)).limit(1))[0];
        const merged: DiscoveryData = { ...(disc?.data as any) };
        for (const k of CLIENT_SECTIONS) if (incoming[k] !== undefined) (merged as any)[k] = incoming[k];
        const computed = computeDiscovery(merged);
        await tx
          .update(financialDiscoveries)
          .set({
            data: merged as any,
            computed: computed as any,
            healthScore: computed.healthScore,
            title: (merged.identification as any)?.fullName ?? disc?.title,
            status: "submitted",
            submittedAt: new Date(),
            updatedAt: new Date(),
          } as any)
          .where(eq(financialDiscoveries.id, discoveryId));
      });
      await finalizeShareToken({ id: tk.id, result: { submitted: true }, ipAddress: ip ?? undefined, userAgent: req.headers.get("user-agent") ?? undefined });
    } catch (e) {
      await releaseShareToken(tk.id); // let them retry
      throw e;
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
