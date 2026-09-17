/**
 * THE DATA WALL — one place that decides which records a session may see.
 *
 * The firm's rule, in full:
 *
 *   1. A branch's data is not visible to another branch.
 *   2. Inside a branch, one person's data is not visible to another person —
 *      for EVERY role, not just RM. A sub broker, an RIA and a compliance
 *      officer are all walled to their own records by default.
 *   3. Back office (back_office / ops) and the firm admin (owner) see
 *      everything, every branch, every owner.
 *   4. A BRANCH HEAD sees every user's records in their OWN branch, and nothing
 *      from any other branch. This is automatic — running that branch is the
 *      job, so it does not wait on someone remembering to tick a box.
 *   5. Anyone can additionally be granted specific branches on their employee
 *      record (users.allowed_branches, migration 0216). A grant lifts BOTH
 *      walls for those branches: every record in them, whoever owns it. Grants
 *      ADD to (4), so a branch head covering a second branch gets both.
 *
 * Note what (4) does NOT do: it never widens anyone beyond a single branch, and
 * it is the only place a role name still widens a view. Everything else is an
 * explicit grant a human made on that person's record, which is auditable and
 * changes without inventing a new role.
 *
 * NOTE this supersedes `tenants.restrict_user_data_scope`. That switch made the
 * client wall optional per firm, defaulting to OFF — so for most firms it did
 * nothing at all. The wall here is unconditional; the switch is no longer
 * consulted for record visibility.
 *
 * SERVER-ONLY: every function takes the tenant transaction and runs inside it.
 */

import { sql, type SQL } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Roles that see every branch and every owner's records before any grant.
 *
 * back_office and ops are BOTH here because they are the same desk — the role
 * matrix labels both "Back Office Executive". Adding a role here hands it the
 * whole firm, so it is deliberately short.
 */
export const ALL_BRANCH_ROLES = ["owner", "back_office", "ops"];

export function seesAllBranches(session: SessionUser): boolean {
  return session.roles.some((r) => ALL_BRANCH_ROLES.includes(r));
}

/**
 * Roles that automatically see their OWN branch in full — every user's records
 * in it, no grant required.
 *
 * Only branch_head. Running a branch means seeing what the branch is doing; a
 * branch head who could see only their own handful of records could not do the
 * job, and making that wait on an admin ticking a box means it is wrong by
 * default for every branch head created from here on.
 */
export const OWN_BRANCH_ROLES = ["branch_head"];

/** Does this session manage its own branch (and actually have one)? */
export function managesOwnBranch(session: SessionUser): boolean {
  return !!session.branchId && session.roles.some((r) => OWN_BRANCH_ROLES.includes(r));
}

/** What a session is allowed to see, resolved once and reused per query. */
export type DataScope =
  /** Everything — owner / back office. */
  | { kind: "all" }
  /** Every record in these branches, whoever owns it. */
  | { kind: "branches"; branchIds: string[] }
  /** Only records this user owns. The default for everyone else. */
  | { kind: "own"; userId: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The branch grant on this user's employee record.
 *
 * Read from the DB rather than the session JWT on purpose: a grant taken away
 * must bite on the NEXT REQUEST, not whenever the user happens to re-login. A
 * stale token is exactly how a revoked permission keeps working for a week.
 *
 * Values are re-validated as uuids here — the column is free-form jsonb, and a
 * bad value would otherwise reach a `::uuid` cast and 500 the page.
 */
export async function loadAllowedBranches(
  tx: any,
  tenantId: string,
  userId: string
): Promise<string[]> {
  const row = await loadScopeRow(tx, tenantId, userId);
  return row.allowedBranches;
}

/**
 * The two per-user scope columns, read together (one query instead of two).
 *
 * `restrictToOwnRecords` (migration 0222) is an explicit "this person sees only
 * their own records, full stop" switch that BEATS every widening below it
 * except owner. It exists because branch_head widens to a whole branch
 * implicitly — you hold the role, you get the branch — so a person who is an RM
 * with a book of their own AND a branch head for, say, leave approvals silently
 * saw the entire branch's clients, with nothing on screen explaining why. The
 * firm needed a way to say "no, just their own" without stripping the role.
 */
export async function loadScopeRow(
  tx: any,
  tenantId: string,
  userId: string
): Promise<{ allowedBranches: string[]; restrictToOwnRecords: boolean }> {
  try {
    const r = await tx.execute(sql`
      SELECT allowed_branches, restrict_to_own_records FROM users
      WHERE id = ${userId}::uuid AND tenant_id = ${tenantId}::uuid
      LIMIT 1
    `);
    const row = r.rows[0] as
      | { allowed_branches?: unknown; restrict_to_own_records?: unknown }
      | undefined;
    const raw = row?.allowed_branches;
    return {
      allowedBranches: Array.isArray(raw)
        ? raw.filter((v): v is string => typeof v === "string" && UUID_RE.test(v))
        : [],
      restrictToOwnRecords: row?.restrict_to_own_records === true,
    };
  } catch {
    // A missing column (pre-0216 / pre-0222 database) must not take the page
    // down, and it must FAIL CLOSED — no grant, so the caller falls back to
    // own-records.
    return { allowedBranches: [], restrictToOwnRecords: false };
  }
}

/**
 * The colleagues whose CALENDAR this user handles (users.delegates_for,
 * migration 0220) — an EA/front-desk who runs one partner's diary.
 *
 * Read from the DB rather than the session JWT for the same reason as
 * loadAllowedBranches: a delegation that is taken away must bite on the NEXT
 * REQUEST, not whenever the user next logs in.
 *
 * Deliberately narrow — this widens MEETINGS only. It is not a data-scope
 * `kind`, because a delegate is not a branch head: they get one named person's
 * diary, not that person's clients, leads, tasks or book.
 */
export async function loadDelegatedUserIds(
  tx: any,
  tenantId: string,
  userId: string
): Promise<string[]> {
  try {
    const r = await tx.execute(sql`
      SELECT delegates_for FROM users
      WHERE id = ${userId}::uuid AND tenant_id = ${tenantId}::uuid
      LIMIT 1
    `);
    const raw = (r.rows[0] as { delegates_for?: unknown } | undefined)?.delegates_for;
    if (!Array.isArray(raw)) return [];
    // Re-validated as uuids here — the column is free-form jsonb and a bad
    // value would otherwise reach a `::uuid` cast and 500 the page.
    return raw.filter((v): v is string => typeof v === "string" && UUID_RE.test(v) && v !== userId);
  } catch {
    // Missing column (pre-0220 database) must FAIL CLOSED — no delegation.
    return [];
  }
}

/** The meetings wall, resolved once and reused across a page's queries. */
export type MeetingScope = { scope: DataScope; delegatedIds: string[] };

/**
 * Resolve the meetings wall: the normal data wall, plus whoever's diary this
 * user has been delegated. Call once per request, build predicates from it with
 * `meetingScopeSql` / check single rows with `isMeetingInScope`.
 */
export async function resolveMeetingScope(tx: any, session: SessionUser): Promise<MeetingScope> {
  const [scope, delegatedIds] = await Promise.all([
    resolveDataScope(tx, session),
    loadDelegatedUserIds(tx, session.tenantId, session.userId),
  ]);
  return { scope, delegatedIds };
}

/**
 * The meetings wall as SQL. The branch/own predicate OR'd with the delegated
 * diaries — a delegate sees their own meetings AND the ones they run for
 * someone else, and nothing further.
 */
export function meetingScopeSql(ms: MeetingScope, ownerCol: string): SQL {
  const base = dataScopeSqlViaOwnerBranch(ms.scope, ownerCol);
  if (!ms.delegatedIds.length) return base;
  return sql`(${base} OR ${sql.raw(ownerCol)} IN (${sql.join(
    ms.delegatedIds.map((u) => sql`${u}::uuid`),
    sql`, `
  )}))`;
}

/** Single-row counterpart, for routes that load one meeting by id. */
export function isMeetingInScope(
  ms: MeetingScope,
  row: { branchId?: string | null; ownerId?: string | null }
): boolean {
  if (row.ownerId && ms.delegatedIds.includes(row.ownerId)) return true;
  return isInScope(ms.scope, row);
}

/** Resolve the wall for this session. Call inside the tenant transaction. */
export async function resolveDataScope(tx: any, session: SessionUser): Promise<DataScope> {
  return (await explainDataScope(tx, session)).scope;
}

/** Why a session sees what it sees — the scope plus the reason, for the UI. */
export type DataScopeExplained = {
  scope: DataScope;
  /** One line an admin can read on the employee record. */
  reason: string;
};

/**
 * The wall, plus the reason for it.
 *
 * `resolveDataScope` is the hot path and just takes `.scope`; the reason exists
 * so the employee record can SHOW an admin why someone sees a whole branch.
 * That was the actual failure mode here: an RM who also held branch_head saw
 * every client in the branch, the sidebar badge still said "Relationship
 * Manager" (that label picks the first matching role, and rm comes first), and
 * nothing anywhere said "…and the branch, because of Branch Head".
 */
export async function explainDataScope(
  tx: any,
  session: SessionUser
): Promise<DataScopeExplained> {
  if (session.roles.includes("owner")) {
    return { scope: { kind: "all" }, reason: "Owner — sees every record in the firm." };
  }

  const { allowedBranches, restrictToOwnRecords } = await loadScopeRow(
    tx,
    session.tenantId,
    session.userId
  );

  // The explicit override, ticked on the employee record. Deliberately ABOVE
  // the role check: the whole point is to hold an otherwise-widening role
  // (branch_head for leave approvals, back office for ops work) without the
  // client book that normally comes with it.
  if (restrictToOwnRecords) {
    return {
      scope: { kind: "own", userId: session.userId },
      reason: "Limited to their own records — “Only their own records” is ticked on their employee record.",
    };
  }

  if (seesAllBranches(session)) {
    const role = session.roles.find((r) => ALL_BRANCH_ROLES.includes(r));
    return {
      scope: { kind: "all" },
      reason: `Sees every record in the firm, because they hold ${role === "back_office" ? "Back Office" : role === "ops" ? "Operations" : role}.`,
    };
  }

  // A branch head's own branch is implicit; explicit grants ADD to it, so one
  // covering a second branch sees both. Deduped because the two overlap the
  // moment an admin also ticks the branch they already run.
  const branchIds = new Set(allowedBranches);
  const ownBranch = managesOwnBranch(session);
  if (ownBranch) branchIds.add(session.branchId!);

  if (branchIds.size > 0) {
    const bits: string[] = [];
    if (ownBranch) bits.push("they hold Branch Head, which always includes their own branch");
    if (allowedBranches.length) {
      bits.push(`they are granted ${allowedBranches.length} branch${allowedBranches.length === 1 ? "" : "es"} on this record`);
    }
    return {
      scope: { kind: "branches", branchIds: [...branchIds] },
      reason: `Sees EVERY record in ${branchIds.size} branch${branchIds.size === 1 ? "" : "es"} — whoever owns it — because ${bits.join(" and ")}.`,
    };
  }

  return {
    scope: { kind: "own", userId: session.userId },
    reason: "Sees only the records assigned to them.",
  };
}

/** The columns a table exposes to the wall. Raw identifiers, never user input. */
export type ScopeColumns = {
  /** e.g. "investors.branch_id" */
  branch: string;
  /**
   * e.g. "investors.rm_id" — the person the record belongs to. A record can
   * have more than one legitimate owner (a client's relationship RM and its
   * separate day-to-day SERVICING rm, migration 0209): pass an array and any
   * one of them counts as "yours". OR'd, never AND'd.
   */
  owner: string | string[];
};

/**
 * The wall as a SQL predicate. Returns `TRUE` for an unrestricted session so it
 * can be ANDed unconditionally.
 */
export function dataScopeSql(scope: DataScope, cols: ScopeColumns): SQL {
  if (scope.kind === "all") return sql`TRUE`;
  if (scope.kind === "branches") {
    return sql`${sql.raw(cols.branch)} IN (${sql.join(
      scope.branchIds.map((b) => sql`${b}::uuid`),
      sql`, `
    )})`;
  }
  const ownerCols = Array.isArray(cols.owner) ? cols.owner : [cols.owner];
  return sql`(${sql.join(
    ownerCols.map((c) => sql`${sql.raw(c)} = ${scope.userId}::uuid`),
    sql` OR `
  )})`;
}

/**
 * Variant of dataScopeSql for a table with NO branch_id of its own — branch is
 * derived from the OWNING USER's own branch_id (e.g. review_meetings has
 * rm_id but no branch column; a meeting's branch is whoever ran it). For a
 * branch-scoped session this becomes a correlated EXISTS against users;
 * everything else behaves exactly like dataScopeSql.
 */
export function dataScopeSqlViaOwnerBranch(scope: DataScope, ownerCol: string): SQL {
  if (scope.kind === "all") return sql`TRUE`;
  if (scope.kind === "branches") {
    return sql`EXISTS (
      SELECT 1 FROM users su
      WHERE su.id = ${sql.raw(ownerCol)}
        AND su.branch_id IN (${sql.join(
          scope.branchIds.map((b) => sql`${b}::uuid`),
          sql`, `
        )})
    )`;
  }
  return sql`${sql.raw(ownerCol)} = ${scope.userId}::uuid`;
}

/** Resolve + build in one step, for callers that need nothing else. */
export async function dataScopeSqlFor(
  tx: any,
  session: SessionUser,
  cols: ScopeColumns
): Promise<SQL> {
  return dataScopeSql(await resolveDataScope(tx, session), cols);
}

/**
 * The single-row counterpart, for routes that load one record by id.
 *
 * Exists because a list query being walled proves nothing about the detail
 * page: changing the id in the URL is the obvious way round a filtered list,
 * and every export/PDF route that loads one record by id is the same hole.
 */
export function isInScope(
  scope: DataScope,
  row: { branchId?: string | null; ownerId?: string | null | (string | null | undefined)[] }
): boolean {
  if (scope.kind === "all") return true;
  if (scope.kind === "branches") {
    return !!row.branchId && scope.branchIds.includes(row.branchId);
  }
  const owners = Array.isArray(row.ownerId) ? row.ownerId : [row.ownerId];
  return owners.some((o) => o === scope.userId);
}

/** Throw 403 unless the row is visible to this session. */
export async function assertInScope(
  tx: any,
  session: SessionUser,
  row: { branchId?: string | null; ownerId?: string | null | (string | null | undefined)[] },
  what = "record"
): Promise<void> {
  const scope = await resolveDataScope(tx, session);
  if (isInScope(scope, row)) return;
  throw Object.assign(
    new Error(`forbidden: this ${what} belongs to another branch or team member`),
    { status: 403 }
  );
}
