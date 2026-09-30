import { sql } from "drizzle-orm";
import { CalendarDays } from "lucide-react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { LeaderboardCard, type LeaderboardRow } from "./LeaderboardCard";

/**
 * Meetings per person: what is still ahead of them, and what they actually
 * completed this month.
 *
 * Upcoming alone flatters a diary full of bookings nobody ran, so the second
 * column is completed-this-month — the one that says the meetings are
 * happening. Counted against whoever OWNS the meeting (rm_id), falling back to
 * whoever created it, because rm_id is left null on everything booked since
 * created_by_id arrived.
 */
export async function MeetingLeaderboard({ session }: { session: SessionUser }) {
  const rows = await withTenant(
    session.tenantId,
    async (tx) => {
      const res = await tx.execute(sql`
        SELECT u.id, u.name,
               COUNT(m.id) FILTER (
                 WHERE m.status IN ('scheduled', 'confirmed')
                   AND m.meeting_date >= now()
               )::int AS upcoming_count,
               COUNT(m.id) FILTER (
                 WHERE m.status = 'completed'
                   AND m.meeting_date >= date_trunc('month', current_date)
               )::int AS done_count
          FROM users u
          LEFT JOIN review_meetings m
            ON COALESCE(m.rm_id, m.created_by_id) = u.id
           AND m.tenant_id = ${session.tenantId}::uuid
         WHERE u.tenant_id = ${session.tenantId}::uuid
           AND u.status = 'active'
         GROUP BY u.id, u.name
         HAVING COUNT(m.id) > 0
         ORDER BY upcoming_count DESC, done_count DESC
         LIMIT 8
      `);
      return res.rows as unknown as {
        id: string;
        name: string | null;
        upcoming_count: number;
        done_count: number;
      }[];
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const data: LeaderboardRow[] = rows.map((r) => ({
    id: String(r.id),
    name: (r.name ?? "—").split(" ")[0],
    primary: Number(r.upcoming_count ?? 0),
    secondary: Number(r.done_count ?? 0),
    href: `/dashboard/review-meetings?rm=${r.id}`,
  }));

  return (
    <LeaderboardCard
      title="Meetings by RM"
      icon={CalendarDays}
      tone="blue"
      rows={data}
      primaryLabel="Upcoming"
      secondaryLabel="Done (MTD)"
      allHref="/dashboard/review-meetings"
      allLabel="All meetings →"
      emptyTitle="No meetings booked"
      emptyHint="Scheduled and completed client meetings will rank by RM here."
      emptyCta={{ href: "/dashboard/review-meetings", label: "Book a meeting" }}
    />
  );
}
