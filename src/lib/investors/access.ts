/**
 * Client (investor) row-level access scope.
 *
 * RLS isolates by TENANT only — it does NOT slice a tenant's clients by who may
 * see them. That slice is the application's job, and it has to be applied in
 * EVERY query that returns a list of clients: the list page, the Excel export,
 * and the JSON API (which is also what the mobile app reads).
 *
 * The rule itself lives in ONE place — `lib/auth/data-scope.ts`. This module is
 * just the client-shaped adapter on top of it:
 *
 *   owner / back_office / ops        → the whole firm's book
 *   a branch head / branch grant     → every client whose RM sits in that
 *                                      branch (NOT the client's own stored
 *                                      branch column, which drifts)
 *   everyone else                    → clients assigned to them
 *
 * The capability gate is separate and still applies first: a role with no
 * client capability (marketing …) is blocked regardless of the wall.
 *
 * HISTORY — `tenants.restrict_user_data_scope` used to make this wall optional
 * per firm, defaulting to OFF, which meant that for most firms it did nothing
 * at all. The wall is now unconditional, so that switch is no longer consulted
 * here. `isDataScopeRestricted` is kept because other modules still read the
 * flag, but it no longer decides client visibility.
 *
 * Deliberately mirrors `lib/leads/access.ts`, which does the same job for the
 * pipeline.
 */

import { and, eq, sql, type SQL } from "drizzle-orm";
import { investors } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import {
  resolveDataScope,
  dataScopeSqlViaOwnerBranch,
  isInScopeViaOwnerBranch,
} from "@/lib/auth/data-scope";

/** Throws 403 when the caller has no client visibility at all. */
export function requireInvestorView(session: SessionUser) {
  requireAny(
    session.roles,
    ["investor.view.all", "investor.view.assigned"],
    session.permissions
  );
}

export function canViewAllInvestors(session: SessionUser) {
  return can(session.roles, "investor.view.all", session.permissions);
}

/**
 * The legacy per-tenant "restrict users to their own data" flag.
 *
 * No longer gates client visibility — the wall in lib/auth/data-scope.ts is
 * unconditional. Kept because it is still read elsewhere and because removing a
 * column mid-flight is a separate change.
 */
export async function isDataScopeRestricted(tx: any, tenantId: string): Promise<boolean> {
  try {
    const r = await tx.execute(sql`
      SELECT restrict_user_data_scope AS on FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1
    `);
    return (r.rows[0] as { on?: boolean } | undefined)?.on === true;
  } catch {
    return false;
  }
}

/**
 * The columns the wall filters clients on. Owner is BOTH the relationship RM
 * (rm_id) and the separate day-to-day servicing RM (service_rm_id, migration
 * 0209) — either one makes the client "yours". Missing this was a real
 * regression: since the wall shipped, a servicing RM who is not also the
 * relationship RM was invisible everywhere — list, export, every single-client
 * route — because only rm_id was checked.
 */
const INVESTOR_COLS = (alias: string) => ({
  branch: `${alias}.branch_id`,
  owner: [`${alias}.rm_id`, `${alias}.service_rm_id`],
});

/**
 * Drizzle condition restricting a client query to what this session may see.
 *
 * Always returns a condition now (never `undefined`) — an unrestricted session
 * gets a `TRUE` fragment, so callers can drop it into an `and(...)` without a
 * null check. Callers that still branch on falsiness keep working.
 */
export async function investorScopeCondition(tx: any, session: SessionUser) {
  requireInvestorView(session);
  return investorScopeSql(tx, session);
}

/**
 * The client BOOKS this user is allowed to see (users.allowed_client_tags).
 *
 * A firm's back office is not one desk — one person runs the Motilal Oswal
 * book, another Mutual Fund — but back_office is firm-wide in the data wall,
 * so each of them saw every client. This narrows by the tag the client already
 * carries.
 *
 * Read from the DATABASE rather than the session token, like every other scope
 * input, so taking a book away bites on the next request instead of the next
 * login. Fails OPEN to "no restriction" on a pre-migration database, which is
 * the behaviour every existing firm already has.
 */
async function allowedClientTags(tx: any, session: SessionUser): Promise<string[]> {
  try {
    const r = await tx.execute(sql`
      SELECT allowed_client_tags FROM users
      WHERE id = ${session.userId}::uuid AND tenant_id = ${session.tenantId}::uuid
      LIMIT 1
    `);
    const raw = (r.rows[0] as { allowed_client_tags?: unknown } | undefined)?.allowed_client_tags;
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string" && !!v.trim()) : [];
  } catch {
    return [];
  }
}

/**
 * The tag restriction as SQL. TRUE when unrestricted, so it can be ANDed
 * unconditionally.
 *
 * Case-insensitive: a tag typed by hand ("motilal oswal") has to match the one
 * pressed as a chip ("Motilal Oswal"), or the restriction silently hides
 * clients it was never meant to.
 */
function clientTagSql(tags: string[], alias: string): SQL {
  if (tags.length === 0) return sql`TRUE`;
  return sql`EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(${sql.raw(alias)}.tags, '[]'::jsonb)) AS t(tag)
    WHERE lower(t.tag) IN (${sql.join(
      tags.map((t) => sql`${t.trim().toLowerCase()}`),
      sql`, `
    )})
  )`;
}

/** Same rule as raw SQL, for queries built with sql`` fragments. */
export async function investorScopeSql(tx: any, session: SessionUser, alias = "investors") {
  requireInvestorView(session);
  const cols = INVESTOR_COLS(alias);
  const wall = dataScopeSqlViaOwnerBranch(await resolveDataScope(tx, session), cols.owner);
  // ANDed with the wall, never instead of it — a book restriction can only
  // ever take clients away.
  const books = clientTagSql(await allowedClientTags(tx, session), alias);
  return sql`(${wall} AND ${books})`;
}

/**
 * Throws 403 unless this session may open THIS client's record.
 *
 * The single-row counterpart to `investorScopeCondition`, for routes that load
 * one client by id instead of listing many.
 *
 * Why it exists: the statement exports (PDF + Excel) checked only the
 * capability, which says the caller may view SOME clients and nothing about
 * which — so an RM could pull any client's holdings, amounts and PAN by
 * changing the id in the URL while the list was properly walled.
 *
 * Call INSIDE the tenant transaction, after loading the row.
 */
export async function assertCanViewClient(
  tx: any,
  session: SessionUser,
  inv: {
    id?: string | null;
    rmId?: string | null;
    serviceRmId?: string | null;
    branchId?: string | null;
    tags?: unknown;
  }
): Promise<void> {
  requireInvestorView(session);

  // Book restriction first — it applies whatever the wall says, including to
  // back office, who otherwise see the whole firm. Checked here as well as in
  // the list so the detail page cannot disagree with it: a client filtered off
  // someone's list must not open by id.
  //
  // Callers select whatever columns they needed for their own job and mostly
  // do not carry `tags`, so this looks them up by id rather than treating a
  // missing field as "no tags" — which would 403 every restricted user on
  // every client, including the ones they do handle.
  const books = await allowedClientTags(tx, session);
  if (books.length > 0) {
    let tags: unknown = inv.tags;
    if (tags === undefined && inv.id) {
      const r = await tx.execute(sql`
        SELECT tags FROM investors
        WHERE id = ${inv.id}::uuid AND tenant_id = ${session.tenantId}::uuid
        LIMIT 1
      `);
      tags = (r.rows[0] as { tags?: unknown } | undefined)?.tags ?? [];
    }
    // No id and no tags to judge by: the list query has already applied the
    // restriction, so fall through rather than blocking on a guess.
    if (tags !== undefined) {
      const want = new Set(books.map((b) => b.trim().toLowerCase()));
      const has = Array.isArray(tags)
        ? (tags as unknown[]).some((t) => typeof t === "string" && want.has(t.trim().toLowerCase()))
        : false;
      if (!has) {
        throw Object.assign(new Error("forbidden: this client is outside the books you handle"), {
          status: 403,
        });
      }
    }
  }
  // Same rule as the list: visible if you own it, or if whoever owns it sits in
  // your branch. Checked against the OWNER's branch, not the client's stored
  // branch column, so the detail page can't disagree with the list.
  const scope = await resolveDataScope(tx, session);
  if (await isInScopeViaOwnerBranch(tx, scope, [inv.rmId, inv.serviceRmId])) return;
  throw Object.assign(
    new Error("forbidden: this client belongs to another branch or team member"),
    { status: 403 }
  );
}

/** Kept for callers that build their own `and(...)` chains. */
export { and, eq };
