/**
 * Who a meeting "belongs to" when we count it per person.
 *
 * A meeting has up to three kinds of participant: the person who booked it
 * (`created_by_id`), the legacy owner (`rm_id`, NULL on everything booked since
 * migration 0203) and everyone invited alongside (`collaborator_ids`). Counting
 * per person on rm_id alone - which several dashboards did - missed new meetings
 * entirely, and counting on created_by_id alone left a collaborator with a
 * meeting on their diary that never added to their number.
 *
 * Rule (owner's call): every participant is credited with the meeting - the host
 * and each collaborator - for upcoming, held and target counts alike. Status is a
 * property of the meeting, not of a person, so when the host marks it completed it
 * is completed for every collaborator too.
 */

import { sql, type SQL } from "drizzle-orm";

/** `alias` is a trusted constant (a table alias in our own query), never user input. */
const ALIAS_RE = /^[a-z_][a-z0-9_]*$/i;
function safeAlias(alias: string): string {
  if (!ALIAS_RE.test(alias)) throw new Error("bad meeting alias");
  return alias;
}

/** Predicate: user `uid` is the booker, the legacy owner or a collaborator of the meeting. */
export function isMeetingParticipantSql(alias: string, uid: string | SQL): SQL {
  const a = safeAlias(alias);
  const u = typeof uid === "string" ? sql`${uid}` : uid;
  return sql`(${sql.raw(a)}.created_by_id = ${u}::uuid
    OR ${sql.raw(a)}.rm_id = ${u}::uuid
    OR jsonb_exists(COALESCE(${sql.raw(a)}.collaborator_ids, '[]'::jsonb), (${u})::text))`;
}

/**
 * `CROSS JOIN LATERAL` fragment that fans one meeting row out to one row per
 * participant (column `mp.uid`), de-duplicated so someone who booked a meeting AND
 * is listed as a collaborator is counted once. Use it to GROUP BY mp.uid.
 */
export function meetingParticipantsLateral(alias: string): SQL {
  const a = safeAlias(alias);
  return sql`CROSS JOIN LATERAL (
    SELECT DISTINCT p::uuid AS uid FROM (
      SELECT ${sql.raw(a)}.created_by_id::text AS p
      UNION ALL SELECT ${sql.raw(a)}.rm_id::text
      UNION ALL SELECT jsonb_array_elements_text(COALESCE(${sql.raw(a)}.collaborator_ids, '[]'::jsonb))
    ) q
    WHERE p ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  ) mp`;
}
