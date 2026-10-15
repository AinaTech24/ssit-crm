/**
 * The research view of the firm's book: meetings and portfolio reviews, RM by
 * RM.
 *
 * Research is asked "which RMs are actually meeting clients, and whose
 * portfolios have gone unreviewed" — questions about activity across the team
 * rather than any one client. Those answers lived in different modules, none of
 * which a research user could open.
 *
 * Deliberately NOT a book-size panel: no AUM, SIP or client-count tiles. That
 * is a sales view and research does not run a book.
 *
 * Read-only by construction: it counts, it does not link into anything that
 * edits. A user without firm-wide client access counts only their own slice.
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { PieChart, ArrowRight } from "lucide-react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { investorScopeSql } from "@/lib/investors/access";
import { can } from "@/lib/auth/rbac";
import { resolveMeetingScope, meetingScopeSql } from "@/lib/auth/data-scope";
import { ResearchRmFilter } from "./ResearchRmFilter";

/** A review this far past due is the one research is being asked about. */
const REVIEW_OVERDUE_DAYS = 100;

type RmRow = {
  rm_id: string | null;
  rm_name: string | null;
  clients: number;
  reviews_due: number;
  meetings_held_90d: number;
  meetings_upcoming: number;
  reviews_done_90d: number;
};

export async function AdminRmReviewSection({
  session,
  rmId,
}: {
  session: SessionUser;
  /** ?rm= — narrows the table to one relationship manager. */
  rmId?: string;
}) {
  let byRm: RmRow[] = [];
  // Roster for the filter. Loaded WITHOUT the rm filter applied, or selecting
  // someone would leave a dropdown containing only them and no way back.
  let rmOptions: { id: string; name: string }[] = [];
  const validRm = rmId && /^[0-9a-f-]{36}$/i.test(rmId) ? rmId : undefined;

  try {
    const data = await withTenant(session.tenantId, async (tx) => {
      // Someone holding investor.view.all is entitled to the whole book, and
      // these are aggregate counts over exactly that. Anyone without the
      // capability still counts only their own — the wall enforces that.
      const seesAll = can(session.roles, "investor.view.all", session.permissions);
      const clientScope = seesAll ? sql`TRUE` : await investorScopeSql(tx, session, "investors");
      const ms = await resolveMeetingScope(tx, session);
      const meetingScope = seesAll ? sql`TRUE` : meetingScopeSql(ms, "m.rm_id");

      // Clients and meetings are aggregated SEPARATELY and joined on the person.
      // Joining meetings onto a per-client row multiplies one figure by the
      // other; and starting from clients dropped any RM who had meetings but
      // no book — which is exactly the "meetings are not showing" report.
      const res = await tx.execute(sql`
        WITH per_client AS (
          SELECT investors.rm_id AS uid,
                 COUNT(*)::int AS clients,
                 COUNT(*) FILTER (
                   WHERE investors.next_review_at IS NOT NULL
                     AND investors.next_review_at <= now() - (${REVIEW_OVERDUE_DAYS} || ' days')::interval
                 )::int AS reviews_due,
                 COUNT(*) FILTER (
                   WHERE investors.last_review_at IS NOT NULL
                     AND investors.last_review_at >= now() - interval '90 days'
                 )::int AS reviews_done_90d
            FROM investors
           WHERE investors.deleted_at IS NULL
             AND investors.status = 'active'
             AND investors.rm_id IS NOT NULL
             AND ${clientScope}
           GROUP BY investors.rm_id
        ),
        per_meeting AS (
          SELECT COALESCE(m.created_by_id, m.rm_id) AS uid,
                 COUNT(*) FILTER (
                   WHERE m.status = 'completed'
                     AND m.meeting_date >= now() - interval '90 days'
                     AND m.meeting_date <= now()
                 )::int AS held_90d,
                 COUNT(*) FILTER (
                   WHERE m.status IN ('scheduled', 'confirmed', 'rescheduled')
                     AND m.meeting_date >= now()
                 )::int AS upcoming
            FROM review_meetings m
           WHERE m.tenant_id = ${session.tenantId}::uuid
             AND COALESCE(m.created_by_id, m.rm_id) IS NOT NULL
             AND ${meetingScope}
           GROUP BY COALESCE(m.created_by_id, m.rm_id)
        ),
        roster AS (
          SELECT u.id, u.name,
                 COALESCE(c.clients, 0) AS clients,
                 COALESCE(c.reviews_due, 0) AS reviews_due,
                 COALESCE(c.reviews_done_90d, 0) AS reviews_done_90d,
                 COALESCE(pm.held_90d, 0) AS meetings_held_90d,
                 COALESCE(pm.upcoming, 0) AS meetings_upcoming
            FROM users u
            LEFT JOIN per_client c ON c.uid = u.id
            LEFT JOIN per_meeting pm ON pm.uid = u.id
           WHERE u.tenant_id = ${session.tenantId}::uuid
             AND (c.uid IS NOT NULL OR COALESCE(pm.held_90d, 0) + COALESCE(pm.upcoming, 0) > 0)
        )
        SELECT id AS rm_id, name AS rm_name, clients, reviews_due, reviews_done_90d,
               meetings_held_90d, meetings_upcoming,
               (${validRm ? sql`id = ${validRm}::uuid` : sql`TRUE`}) AS in_filter
          FROM roster
         ORDER BY meetings_held_90d DESC, clients DESC, name ASC
         LIMIT 100
      `);

      const all = res.rows as unknown as (RmRow & { in_filter: boolean })[];
      return {
        byRm: all.filter((r) => r.in_filter).slice(0, 50),
        rmOptions: all
          .filter((r) => r.rm_id)
          .map((r) => ({ id: String(r.rm_id), name: r.rm_name ?? "—" }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    });
    byRm = data.byRm;
    rmOptions = data.rmOptions;
  } catch (err) {
    // A dashboard panel must never take the whole page down — but say why, or
    // an empty panel is indistinguishable from "no data".
    console.error("[research-coverage] failed", err instanceof Error ? err.message : err);
    return null;
  }

  return (
    <div className="border rounded-lg bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-lg bg-violet-50 grid place-items-center">
            <PieChart className="size-3.5 text-violet-600" />
          </div>
          <div>
            <div className="font-medium text-sm">Meetings &amp; portfolio reviews by RM</div>
            <div className="text-[11px] text-muted-foreground">
              Meetings held, reviews done and reviews overdue, per relationship manager
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ResearchRmFilter options={rmOptions} selected={validRm} />
          <Link
            href="/dashboard/review-meetings"
            className="text-xs text-violet-700 hover:underline font-medium inline-flex items-center gap-1"
          >
            All meetings <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs table-modern">
          <thead>
            <tr>
              <th className="text-left py-1.5 px-3">RM</th>
              <th className="text-right py-1.5 px-3">Meetings held (90d)</th>
              <th className="text-right py-1.5 px-3">Upcoming</th>
              <th className="text-right py-1.5 px-3">Clients</th>
              <th className="text-right py-1.5 px-3">Reviews done (90d)</th>
              <th className="text-right py-1.5 px-3">Reviews {REVIEW_OVERDUE_DAYS}d+ overdue</th>
            </tr>
          </thead>
          <tbody>
            {byRm.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 px-3 text-center text-muted-foreground">
                  No meetings or reviews to show yet.
                </td>
              </tr>
            ) : (
              byRm.map((r) => (
                <tr key={r.rm_id ?? "unassigned"}>
                  <td className="py-2 px-3 font-medium">{r.rm_name ?? "Unassigned"}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.meetings_held_90d}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.meetings_upcoming}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.clients}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.reviews_done_90d}</td>
                  <td
                    className={`py-2 px-3 text-right tabular-nums ${
                      Number(r.reviews_due) > 0 ? "text-rose-600 font-semibold" : ""
                    }`}
                  >
                    {r.reviews_due}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
