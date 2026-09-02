import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/command-center
 *
 * JSON feed for the mobile Command Center — the prioritized "what needs me
 * today" worklist. Reuses buildCommandQueue() (the same logic the web RSC page
 * runs) so the numbers, ranking, severity escalation and snooze filtering match
 * exactly. Read-only over current DB state.
 *
 * Query params:
 *   ?user=<uuid>   — owner-only: scope the board to one user's book
 *   ?client=<uuid> — scope to a single client
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { investors, users } from "@/db/schema";
import { buildCommandQueue } from "@/lib/command-center/queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BAND_LABEL: Record<string, string> = { now: "Act now", today: "Today", soon: "This week" };

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const ownerView = can(session.roles, "dashboard.view.owner", session.permissions);
    const url = new URL(req.url);
    const userParam = ownerView ? url.searchParams.get("user") : null;
    const clientId = url.searchParams.get("client") || undefined;

    // Owner sees firm-wide unless they scope to one user; everyone else is scoped
    // to their own book (buildCommandQueue applies the owner-column predicate).
    const firmWide = ownerView && !userParam;
    const effectiveUserId = userParam || session.userId;

    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        const groups = await buildCommandQueue(tx as any, { userId: effectiveUserId, firmWide, clientId });
        let clientName: string | null = null;
        if (clientId) {
          const [c] = await tx.select({ name: investors.name }).from(investors).where(eq(investors.id, clientId)).limit(1);
          clientName = c?.name ?? null;
        }
        let roster: Array<{ value: string; label: string }> | undefined;
        if (ownerView) {
          const rows = await tx
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(and(eq(users.tenantId, session.tenantId), eq(users.status, "active")));
          roster = rows.map((r) => ({ value: r.id, label: r.name }));
        }
        return { groups, clientName, roster };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    const groups = data.groups;
    const band = (b: string) => groups.filter((g) => g.severity === b).reduce((n, g) => n + g.count, 0);
    const kpis = { now: band("now"), today: band("today"), soon: band("soon"), total: groups.reduce((n, g) => n + g.count, 0) };

    const outGroups = groups.map((g) => ({
      key: g.key,
      label: g.label,
      icon: g.icon,
      severity: g.severity,
      severityLabel: BAND_LABEL[g.severity] ?? g.severity,
      tone: g.tone,
      count: g.count,
      href: g.href ?? null,
      items: (g.items ?? []).map((it) => ({
        id: it.id,
        itemKey: it.itemKey ?? `${g.key}:${it.id}`,
        title: it.title,
        detail: it.detail ?? null,
        href: it.href,
        date: it.date ?? null,
        ageDays: it.ageDays ?? null,
        amount: it.amount ?? null,
        client: it.client ?? null,
        phone: it.phone ?? null,
        actionType: it.actionType ?? "generic",
        escalate: !!it.escalate,
      })),
    }));

    return NextResponse.json({
      scope: {
        firmWide,
        scopeLabel: firmWide ? "the firm" : "your book",
        userId: userParam || null,
        clientId: clientId || null,
        clientName: data.clientName,
      },
      kpis,
      groups: outGroups,
      filterOptions: {
        categories: groups.map((g) => ({ value: g.key, label: g.label })),
        users: data.roster,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
