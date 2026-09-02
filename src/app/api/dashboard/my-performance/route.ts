/**
 * GET /api/dashboard/my-performance?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * "How am I doing?" for the signed-in user — the half of a salesperson's day
 * that isn't a to-do list. Reuses loadScorecard(), the SAME engine behind the
 * web Team Scorecard, so the number on the phone always matches the number the
 * owner sees in the office.
 *
 * Every user can read THEIR OWN row (the /api/team/targets read is owner-gated,
 * which left an RM unable to see the target they're measured against). Managers
 * additionally get a compact leaderboard of the sales team.
 *
 * Defaults to the current month (1st → today).
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { loadScorecard, type MemberRow } from "@/lib/team/scorecard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (raw: string | null): string | null =>
  raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !isNaN(new Date(raw).getTime()) ? raw : null;

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const sp = req.nextUrl.searchParams;
    const now = new Date();
    const from = parseDay(sp.get("from")) ?? isoDay(new Date(now.getFullYear(), now.getMonth(), 1));
    const to = parseDay(sp.get("to")) ?? isoDay(now);
    const seesTeam = can(session.roles, "dashboard.view.owner", (session as any).permissions);

    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        // The scorecard is firm-wide by design; we pick out the caller's row.
        // Failing soft matters here — a brand-new user simply has no row yet.
        let me: MemberRow | null = null;
        let team: MemberRow[] = [];
        try {
          const card = await loadScorecard(tx as any, session.tenantId, from, to);
          const all = [...card.sales, ...card.ops];
          me = all.find((m) => m.userId === session.userId) ?? null;
          team = card.sales;
        } catch {
          me = null;
        }

        // Today's effort — the numbers an RM grows by doing, visible immediately
        // (the scorecard's period totals move too slowly to feel like feedback).
        let today = { calls: 0, meetings: 0, tasks: 0 };
        try {
          const r = (
            await tx.execute(sql`
              SELECT
                (SELECT count(*) FROM activities a
                   WHERE a.tenant_id = ${session.tenantId}::uuid
                     AND a.owner_user_id = ${session.userId}::uuid
                     AND a.kind IN ('call','visit')
                     AND a.occurred_at >= date_trunc('day', now()))::int AS calls,
                (SELECT count(*) FROM review_meetings m
                   WHERE m.tenant_id = ${session.tenantId}::uuid
                     AND m.rm_id = ${session.userId}::uuid
                     AND m.status = 'completed'
                     AND m.updated_at >= date_trunc('day', now()))::int AS meetings,
                (SELECT count(*) FROM tasks t
                   WHERE t.tenant_id = ${session.tenantId}::uuid
                     AND t.assignee_id = ${session.userId}::uuid
                     AND t.status = 'completed'
                     AND t.updated_at >= date_trunc('day', now()))::int AS tasks
            `)
          ).rows[0] as any;
          today = { calls: r?.calls ?? 0, meetings: r?.meetings ?? 0, tasks: r?.tasks ?? 0 };
        } catch {
          /* keep zeros */
        }

        return { me, team, today };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    // Leaderboard: managers see the team; an RM sees only their own standing
    // (rank + field size) — competitive, without exposing colleagues' numbers.
    const ranked = [...data.team].sort((a, b) => b.kraScore - a.kraScore);
    const myRank = ranked.findIndex((m) => m.userId === session.userId);

    return NextResponse.json({
      from,
      to,
      me: data.me,
      today: data.today,
      rank: myRank >= 0 ? myRank + 1 : null,
      outOf: ranked.length || null,
      leaderboard: seesTeam
        ? ranked.slice(0, 10).map((m) => ({ userId: m.userId, name: m.name, kraScore: m.kraScore, band: m.band }))
        : [],
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
