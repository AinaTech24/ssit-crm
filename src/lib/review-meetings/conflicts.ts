import { sql } from "drizzle-orm";

/**
 * A meeting that overlaps a proposed slot for the same RM. Returned to the UI so
 * the scheduler can show "RM already has X at that time — book anyway?".
 */
export type MeetingConflict = {
  id: string;
  subject: string | null;
  meeting_type: string;
  meeting_date: string;
  duration_minutes: string | null;
  name: string | null;
};

/**
 * Find still-live meetings for `rmId` whose time window overlaps
 * [start, start + durationMin). Two intervals overlap when
 *   a.start < b.end  AND  a.end > b.start.
 *
 * Cancelled / completed / no-show meetings are ignored (they aren't happening).
 * `excludeId` skips the meeting being rescheduled so it never conflicts with
 * itself. Capped at 5 — the UI only needs to show "there's a clash", not all.
 */
export async function findRmConflicts(
  tx: { execute: (q: any) => Promise<{ rows: any[] }> },
  tenantId: string,
  rmId: string,
  startISO: string,
  durationMin: number,
  excludeId?: string
): Promise<MeetingConflict[]> {
  const exclude = excludeId ? sql` AND m.id <> ${excludeId}::uuid` : sql``;
  const r = await tx.execute(sql`
    SELECT m.id, m.subject, m.meeting_type, m.meeting_date, m.duration_minutes,
           COALESCE(i.name, l.name) AS name
    FROM review_meetings m
    LEFT JOIN investors i ON i.id = m.investor_id
    LEFT JOIN leads l ON l.id = m.lead_id
    WHERE m.tenant_id = ${tenantId}::uuid
      AND m.rm_id = ${rmId}::uuid
      AND m.status NOT IN ('cancelled', 'completed', 'no_show')
      ${exclude}
      AND m.meeting_date < (${startISO}::timestamptz + make_interval(mins => ${durationMin}))
      AND (m.meeting_date + make_interval(mins => COALESCE(NULLIF(m.duration_minutes, ''), '30')::int)) > ${startISO}::timestamptz
    ORDER BY m.meeting_date
    LIMIT 5
  `);
  return r.rows as MeetingConflict[];
}
