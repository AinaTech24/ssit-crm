/**
 * GET /api/leads/[id]/full — the complete lead-detail payload for the mobile
 * detail screen. Replicates the web /dashboard/leads/[id] RSC fetch: the lead +
 * owner + related tasks + communications + latest risk profile + latest proposal
 * + computed stats (days as lead, messages, open tasks). Scope-checked.
 */

import { handleApiError } from "@/lib/api/error-handler";
import { NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertModuleEnabled } from "@/lib/auth/license";
import { loadViewableLead } from "@/lib/leads/access";
import { users, tasks, communications, riskProfileResponses, proposals } from "@/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id || !UUID_RE.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
    const session = await requireSession();
    await assertModuleEnabled(session.tenantId, "lead_management", session.roles);

    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        const lead = await loadViewableLead(tx, session, id);
        if (!lead) return null;

        const [owner, relatedTasks, relatedComms, latestRiskList, latestProposalList] = await Promise.all([
          lead.ownerId
            ? tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, lead.ownerId)).limit(1).then((r) => r[0] ?? null)
            : Promise.resolve(null),
          tx.select().from(tasks).where(and(eq(tasks.subjectType, "lead"), eq(tasks.subjectId, id), isNull(tasks.deletedAt))).orderBy(desc(tasks.createdAt)).limit(50),
          tx.select().from(communications).where(eq(communications.leadId, id)).orderBy(desc(communications.createdAt)).limit(50),
          tx.select().from(riskProfileResponses).where(eq(riskProfileResponses.investorId, id)).orderBy(desc(riskProfileResponses.signedAt)).limit(1),
          tx.select().from(proposals).where(eq(proposals.leadId, id)).orderBy(desc(proposals.createdAt)).limit(1),
        ]);

        const daysAsLead = lead.createdAt ? Math.max(0, Math.floor((Date.now() - new Date(lead.createdAt).getTime()) / 86_400_000)) : 0;
        const openTasks = relatedTasks.filter((t: any) => t.status !== "completed").length;

        return {
          lead: { ...lead, ownerName: owner?.name ?? null },
          owner,
          tasks: relatedTasks,
          communications: relatedComms,
          latestRisk: latestRiskList[0] ?? null,
          latestProposal: latestProposalList[0] ?? null,
          stats: { daysAsLead, messages: relatedComms.length, openTasks },
        };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}
