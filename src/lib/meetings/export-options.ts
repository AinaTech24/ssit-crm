/**
 * The people the "RM" choice may offer (meetings list filter and the Export dialog).
 *
 * Whole-firm viewers get everyone; a branch / sub-branch head gets their own
 * branch / desk; an own-records viewer gets only the colleagues whose diary they
 * run as a delegate. The server cuts the actual data by the same wall, so this only
 * decides what the dropdown offers.
 */

import { sql } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import type { MeetingScope } from "@/lib/auth/data-scope";

export async function loadMeetingRmOptions(
  tx: any,
  session: SessionUser,
  meetingScope: MeetingScope
): Promise<Array<{ id: string; name: string | null }>> {
  const delegatedSql = meetingScope.delegatedIds.length
    ? sql`id IN (${sql.join(meetingScope.delegatedIds.map((u) => sql`${u}::uuid`), sql`, `)})`
    : null;
  const rmFilterSql =
    meetingScope.scope.kind === "all"
      ? sql`TRUE`
      : meetingScope.scope.kind === "branches"
        ? (() => {
            const branches = sql`branch_id IN (${sql.join(
              meetingScope.scope.branchIds.map((b) => sql`${b}::uuid`),
              sql`, `
            )})`;
            return delegatedSql ? sql`(${branches} OR ${delegatedSql})` : branches;
          })()
        : meetingScope.scope.kind === "desks"
          ? (() => {
              const desk = sql`desk_id IN (${sql.join(
                meetingScope.scope.deskIds.map((d) => sql`${d}::uuid`),
                sql`, `
              )})`;
              return delegatedSql ? sql`(${desk} OR ${delegatedSql})` : desk;
            })()
          : delegatedSql;
  if (rmFilterSql === null) return [];
  const r = await tx.execute(sql`
    SELECT id, name FROM users
    WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
      AND ${rmFilterSql}
      AND (${session.roles.includes("owner") ? sql`TRUE` : sql`roles && ARRAY['rm','sub_broker','ra_sales','ria','insurance','branch_head','ra_research']::text[]`})
    ORDER BY name ASC
  `);
  return r.rows as Array<{ id: string; name: string | null }>;
}
