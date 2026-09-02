import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/ai/client-brief/[id] — AI Relationship Copilot.
 *
 * Gathers the client's deterministic context (profile, portfolio mix, open
 * next-best-actions, data gaps, recent interactions) and asks Claude for a
 * tight pre-call brief. Advisory only — nothing persisted or auto-sent.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { buildNextBestActions } from "@/lib/nba/engine";
import { generateClientBrief } from "@/lib/ai/assistant";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();

    const ctx = await withTenant(
      session.tenantId,
      async (tx) => {
        const inv = (await tx.execute(sql`
          SELECT name, service_tier, risk_profile, segment_tag,
                 COALESCE(aum,0)::numeric AS aum, COALESCE(active_sip_amount,0)::numeric AS sip,
                 last_contact_at, onboarded_at, nominee_name, email, risk_profile_signed_at
          FROM investors WHERE id = ${id}::uuid LIMIT 1
        `)).rows[0] as any;
        if (!inv) return null;

        const acts = (await tx.execute(sql`
          SELECT kind, subject, occurred_at FROM activities
          WHERE tenant_id = ${session.tenantId}::uuid AND subject_type = 'investor' AND subject_id = ${id}::uuid
          ORDER BY occurred_at DESC LIMIT 5
        `)).rows as any[];

        const alloc = (await tx.execute(sql`
          SELECT s->>'category' AS cat, SUM(COALESCE((s->>'value')::numeric, 0)) AS val
          FROM folios f, jsonb_array_elements(COALESCE(f.schemes, '[]'::jsonb)) s
          WHERE f.tenant_id = ${session.tenantId}::uuid AND f.investor_id = ${id}::uuid
          GROUP BY s->>'category' ORDER BY val DESC LIMIT 4
        `)).rows as any[];

        const nbas = await buildNextBestActions(tx as any, { userId: session.userId, firmWide: true, forInvestorId: id });
        return { inv, acts, alloc, nbas };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    if (!ctx) return NextResponse.json({ error: "client not found" }, { status: 404 });
    const { inv, acts, alloc, nbas } = ctx;

    const days = (d: any) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null);
    const months = (d: any) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / (86400000 * 30)) : null);
    const totalAlloc = alloc.reduce((a: number, r: any) => a + Number(r.val || 0), 0);
    const allocationNote = totalAlloc > 0
      ? alloc.filter((r: any) => r.cat).map((r: any) => `${r.cat} ${Math.round((Number(r.val) / totalAlloc) * 100)}%`).join(", ")
      : undefined;
    const gaps: string[] = [];
    if (!inv.nominee_name) gaps.push("no nominee");
    if (!inv.email) gaps.push("no email");
    if (!inv.risk_profile_signed_at) gaps.push("risk profile unsigned");

    const brief = await generateClientBrief({
      name: inv.name,
      serviceTier: inv.service_tier,
      riskProfile: inv.risk_profile,
      segmentTag: inv.segment_tag,
      aumInr: Number(inv.aum),
      monthlySipInr: Number(inv.sip),
      lastContactDaysAgo: days(inv.last_contact_at),
      tenureMonths: months(inv.onboarded_at),
      openActions: nbas.map((a) => ({ label: a.title, reason: a.reason, impactInr: a.impactInr })),
      dataGaps: gaps,
      recentInteractions: acts.map((a) => ({ kind: a.kind, subject: a.subject, whenDaysAgo: days(a.occurred_at) ?? undefined })),
      allocationNote,
    });

    if ("error" in brief) return NextResponse.json({ error: brief.error }, { status: 502 });
    return NextResponse.json({ brief });
  } catch (err: any) {
    return handleApiError(err);
  }
}
