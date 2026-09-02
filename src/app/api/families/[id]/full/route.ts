import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/families/[id]/full — bundled family detail for the mobile app.
 *
 * Mirrors the web family detail page's data load in one round-trip:
 *   family row · members (investors) · family RM · primary client (with the
 *   same NULL→self/head fallback) · aggregated family goals · combined AUM/SIP ·
 *   nominee coverage · next-generation prospects.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import { families, investors, users } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["family.view", "investor.view.all", "investor.view.assigned"], session.permissions);
    const canViewAll = can(session.roles, "investor.view.all", session.permissions);

    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        const fam = (await tx.select().from(families).where(and(eq(families.id, id), eq(families.tenantId, session.tenantId))).limit(1))[0];
        if (!fam) return null;
        // Non-managers only see households they own.
        if (!canViewAll && fam.rmId !== session.userId) return { forbidden: true as const };

        const members = await tx
          .select({
            id: investors.id, name: investors.name, pan: investors.pan,
            familyRole: investors.familyRole, segmentTag: investors.segmentTag,
            aum: investors.aum, activeSipAmount: investors.activeSipAmount,
            nomineeName: investors.nomineeName, isMinor: investors.isMinor,
            dob: investors.dob, kycStatus: investors.kycStatus, status: investors.status,
          })
          .from(investors)
          .where(and(eq(investors.familyId, id), isNull(investors.deletedAt)));

        const rm = fam.rmId
          ? (await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, fam.rmId)).limit(1))[0] ?? null
          : null;

        // Primary client — explicit, else first self/head member, else first member.
        let primary: any = fam.primaryInvestorId ? members.find((m) => m.id === fam.primaryInvestorId) ?? null : null;
        if (!primary) primary = members.find((m) => m.familyRole === "self" || m.familyRole === "head") ?? members[0] ?? null;

        const memberIds = members.map((m) => m.id);
        const familyGoals = memberIds.length === 0 ? [] : (await tx.execute(sql`
          SELECT g.id, g.name, g.category, g.target_amount, g.current_value,
                 g.target_date, g.progress_pct, g.monthly_contribution, i.name AS member_name
          FROM goals g JOIN investors i ON i.id = g.investor_id
          WHERE g.investor_id IN (${sql.join(memberIds.map((mid) => sql`${mid}::uuid`), sql`, `)})
          ORDER BY g.target_date ASC NULLS LAST
          LIMIT 20
        `)).rows;

        return { family: fam, members, rm, primary, familyGoals };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    if ("forbidden" in data) return NextResponse.json({ error: "you can only view your own families" }, { status: 403 });

    const { family, members, rm, primary, familyGoals } = data;
    const totalAum = members.reduce((s, m) => s + Number(m.aum ?? 0), 0);
    const totalSip = members.reduce((s, m) => s + Number(m.activeSipAmount ?? 0), 0);
    const membersWithNominee = members.filter((m) => m.nomineeName).length;
    const nomineePct = members.length > 0 ? Math.round((membersWithNominee / members.length) * 100) : 0;

    // Next-gen prospects: minors + members aged 18–30 with no AUM yet.
    const today = Date.now();
    const nextGen = members.filter((m) => {
      if (!m.dob) return false;
      const age = (today - new Date(m.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      const inactive = Number(m.aum ?? 0) === 0;
      return (m.isMinor || (age >= 18 && age <= 30)) && inactive;
    });

    return NextResponse.json({
      family,
      members,
      rm,
      primary,
      familyGoals,
      totals: { totalAum, totalSip, memberCount: members.length, membersWithNominee, nomineePct },
      nextGen,
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
