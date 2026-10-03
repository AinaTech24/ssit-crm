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
  /**
   * Every record owned by someone on these DESKS (sub-branches). Firms run
   * their real structure at desk level — "Surat Branch", "Vadodara Branch",
   * "Wealth Branch" are all desks under one registered office — so for a
   * branch head with a desk, the desk IS their branch.
   */
  | { kind: "desks"; deskIds: string[] }
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
 * An admin's explicit answer for one person, overriding roles and grants.
 *
 * 'all' (migration 0229) is the WIDENING answer. Until it existed the only
 * routes to the whole firm were holding owner / back_office / ops, or ticking
 * every branch by hand and remembering the next new one — so "let this person
 * see the clients" meant granting a role that also hands over edit rights.
 */
export type ScopeOverride = "all" | "branch" | "own" | null;

/**
 * The per-user scope columns, read together (one query instead of several).
 *
 * `dataScopeOverride` (migration 0223) is the firm's explicit answer for one
 * person, and it beats everything except owner. It exists because the two
 * widenings below it are both role-driven and therefore all-or-nothing:
 * back_office / ops mean the WHOLE FIRM, and branch_head means a whole branch.
 * A branch head who also holds an operational role got the firm, and the only
 * fixes available were to strip the role they need for their job or leave them
 * seeing everything.
 */
export async function loadScopeRow(
  tx: any,
  tenantId: string,
  userId: string
): Promise<{ allowedBranches: string[]; override: ScopeOverride; deskId: string | null }> {
  try {
    const r = await tx.execute(sql`
      SELECT allowed_branches, restrict_to_own_records, data_scope_override, desk_id FROM users
      WHERE id = ${userId}::uuid AND tenant_id = ${tenantId}::uuid
      LIMIT 1
    `);
    const row = r.rows[0] as
      | {
          allowed_branches?: unknown;
          restrict_to_own_records?: unknown;
          data_scope_override?: unknown;
          desk_id?: unknown;
        }
      | undefined;
    const raw = row?.allowed_branches;
    const rawOverride = row?.data_scope_override;
    return {
      allowedBranches: Array.isArray(raw)
        ? raw.filter((v): v is string => typeof v === "string" && UUID_RE.test(v))
        : [],
      override:
        rawOverride === "all" || rawOverride === "branch" || rawOverride === "own"
          ? rawOverride
          : // 0222's boolean, for a row the 0223 backfill hasn't touched.
            row?.restrict_to_own_records === true
            ? "own"
            : null,
      deskId: typeof row?.desk_id === "string" && UUID_RE.test(row.desk_id) ? row.desk_id : null,
    };
  } catch {
    // A missing column (pre-0216 / pre-0222 database) must not take the page
    // down, and it must FAIL CLOSED — no grant, so the caller falls back to
    // own-records.
    return { allowedBranches: [], override: null, deskId: null };
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
export type MeetingScope = { scope: DataScope; delegatedIds: string[]; userId: string };

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
  return { scope, delegatedIds, userId: session.userId };
}

/**
 * The meetings wall as SQL.
 *
 * A meeting has THREE kinds of participant, and all three must see it:
 *
 *   created_by_id    who booked it
 *   collaborator_ids who it was booked for / with (migration 0203)
 *   rm_id            LEGACY. Superseded by created_by_id and left NULL on
 *                    everything booked since; see lib/calendar/items.ts, which
 *                    hit this first. Still matched so old rows stay visible.
 *
 * Walling on rm_id alone — which this did — meant an RM who scheduled a meeting
 * for a colleague could not see it afterwards, and neither could the colleague:
 * rm_id was NULL on the row, so it matched nobody and the module looked empty.
 *
 * On top of that, the branch/desk predicate derives from whoever owns the
 * meeting, so a branch head still gets their whole branch's diary.
 */
export function meetingScopeSql(ms: MeetingScope, ownerCol: string): SQL {
  const alias = ownerCol.includes(".") ? `${ownerCol.split(".")[0]}.` : "";
  const createdCol = `${alias}created_by_id`;
  const collabCol = `${alias}collaborator_ids`;

  const base = dataScopeSqlViaOwnerBranch(ms.scope, [createdCol, ownerCol]);
  const mine: SQL[] = [
    sql`${sql.raw(createdCol)} = ${ms.userId}::uuid`,
    sql`${sql.raw(ownerCol)} = ${ms.userId}::uuid`,
    sql`jsonb_exists(COALESCE(${sql.raw(collabCol)}, '[]'::jsonb), ${ms.userId})`,
  ];
  // A delegate runs someone else's diary: their bookings and their invitations.
  if (ms.delegatedIds.length) {
    const ids = sql.join(ms.delegatedIds.map((u) => sql`${u}::uuid`), sql`, `);
    mine.push(sql`${sql.raw(createdCol)} IN (${ids})`);
    mine.push(sql`${sql.raw(ownerCol)} IN (${ids})`);
  }
  return sql`(${base} OR ${sql.join(mine, sql` OR `)})`;
}

/** Single-row counterpart, for routes that load one meeting by id. */
export function isMeetingInScope(
  ms: MeetingScope,
  row: {
    branchId?: string | null;
    ownerId?: string | null;
    createdById?: string | null;
    collaboratorIds?: unknown;
  }
): boolean {
  // Booked it, or named on it — visible whoever it was assigned to.
  if (row.createdById && row.createdById === ms.userId) return true;
  if (Array.isArray(row.collaboratorIds) && row.collaboratorIds.includes(ms.userId)) return true;
  if (row.ownerId && ms.delegatedIds.includes(row.ownerId)) return true;
  if (row.createdById && ms.delegatedIds.includes(row.createdById)) return true;
  return isInScope(ms.scope, { branchId: row.branchId, ownerId: row.ownerId ?? row.createdById });
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

  const { allowedBranches, override, deskId } = await loadScopeRow(
    tx,
    session.tenantId,
    session.userId
  );

  // The firm's explicit answer for this person. Deliberately ABOVE the role
  // checks: the whole point is to hold an otherwise-widening role (back office
  // for operational work, branch_head for approvals) without the book that
  // normally comes with it.
  // The widening answer. Checked with the narrowing ones, above every role and
  // grant, so an admin's explicit decision for one person is the deciding one
  // whichever direction it points.
  if (override === "all") {
    return {
      scope: { kind: "all" },
      reason: "Sees every record in the firm, whoever owns it — set on their employee record.",
    };
  }
  if (override === "own") {
    return {
      scope: { kind: "own", userId: session.userId },
      reason: "Limited to their own records — set on their employee record.",
    };
  }
  if (override === "branch") {
    // A desk IS the branch for firms that run their structure at desk level
    // ("Surat Branch", "Vadodara Branch" are desks under one registered
    // office). Scoping to the top-level branch there puts the whole firm in
    // one bucket and every desk head sees everyone.
    if (deskId && allowedBranches.length === 0) {
      return {
        scope: { kind: "desks", deskIds: [deskId] },
        reason: "Limited to their desk — every record owned by someone on the same desk (sub-branch), set on their employee record.",
      };
    }
    const branchIds = new Set(allowedBranches);
    if (session.branchId) branchIds.add(session.branchId);
    if (branchIds.size === 0) {
      // Set to "their branch" but they have none — fail CLOSED rather than
      // silently falling back to a firm-wide role.
      return {
        scope: { kind: "own", userId: session.userId },
        reason: "Set to their branch only, but they are not assigned to a branch — showing their own records until one is set.",
      };
    }
    return {
      scope: { kind: "branches", branchIds: [...branchIds] },
      reason: `Limited to their branch — every record owned by someone in ${branchIds.size === 1 ? "their branch" : `${branchIds.size} branches`}, set on their employee record.`,
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
  const ownBranch = managesOwnBranch(session);
  // Same rule for the implicit branch_head widening: if this firm runs desks,
  // a branch head's world is their desk, not every desk in the office.
  // A grant of the HOME branch (the registered office every desk sits under)
  // does not widen a desk head: that branch is the whole firm, so ticking it
  // turned a sub-branch head into someone who saw every other sub-branch. Only
  // a grant of ANOTHER branch moves them off their desk.
  const grantsBeyondHome = allowedBranches.filter((b) => b !== session.branchId);
  if (ownBranch && deskId && grantsBeyondHome.length === 0) {
    return {
      scope: { kind: "desks", deskIds: [deskId] },
      reason: "Sees every record owned by someone on their desk (sub-branch), because they hold Branch Head.",
    };
  }
  const branchIds = new Set(allowedBranches);
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
  // A desk scope has no column of its own on these tables — it is always
  // derived from who owns the record, so hand it to the owner-based builder.
  if (scope.kind === "desks") return dataScopeSqlViaOwnerBranch(scope, cols.owner);
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
export function dataScopeSqlViaOwnerBranch(
  scope: DataScope,
  ownerCol: string | string[]
): SQL {
  if (scope.kind === "all") return sql`TRUE`;
  const cols = Array.isArray(ownerCol) ? ownerCol : [ownerCol];
  if (scope.kind === "branches" || scope.kind === "desks") {
    // "Every record owned by someone in my branch/desk." A record can have more
    // than one legitimate owner (a client's relationship RM and its separate
    // servicing RM), and ANY of them being in scope is enough.
    const memberOf =
      scope.kind === "desks"
        ? sql`su.desk_id IN (${sql.join(scope.deskIds.map((d) => sql`${d}::uuid`), sql`, `)})`
        : sql`su.branch_id IN (${sql.join(scope.branchIds.map((b) => sql`${b}::uuid`), sql`, `)})`;
    return sql`EXISTS (
      SELECT 1 FROM users su
      WHERE su.id IN (${sql.join(cols.map((c) => sql`${sql.raw(c)}`), sql`, `)})
        AND ${memberOf}
    )`;
  }
  return sql`(${sql.join(
    cols.map((c) => sql`${sql.raw(c)} = ${scope.userId}::uuid`),
    sql` OR `
  )})`;
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
  // Desk membership lives on the OWNER's user row, so it cannot be decided
  // from the record alone. Callers that can await use assertInScope /
  // isInScopeViaOwnerBranch; this sync path fails closed rather than guessing.
  if (scope.kind === "desks") return false;
  if (scope.kind === "branches") {
    return !!row.branchId && scope.branchIds.includes(row.branchId);
  }
  const owners = Array.isArray(row.ownerId) ? row.ownerId : [row.ownerId];
  return owners.some((o) => o === scope.userId);
}

/**
 * Single-row counterpart to `dataScopeSqlViaOwnerBranch`: is this record
 * visible because the person who OWNS it sits in one of my branches?
 *
 * Must agree with the list predicate or a client shows in the list and 403s on
 * the detail page (or worse, the reverse). Looks the owners up rather than
 * trusting a branch column on the record itself.
 */
export async function isInScopeViaOwnerBranch(
  tx: any,
  scope: DataScope,
  ownerIds: (string | null | undefined)[]
): Promise<boolean> {
  if (scope.kind === "all") return true;
  const owners = ownerIds.filter((o): o is string => !!o);
  if (!owners.length) return false;
  if (scope.kind === "own") return owners.includes(scope.userId);
  const memberOf =
    scope.kind === "desks"
      ? sql`su.desk_id IN (${sql.join(scope.deskIds.map((d) => sql`${d}::uuid`), sql`, `)})`
      : sql`su.branch_id IN (${sql.join(scope.branchIds.map((b) => sql`${b}::uuid`), sql`, `)})`;
  const r = await tx.execute(sql`
    SELECT 1 FROM users su
    WHERE su.id IN (${sql.join(owners.map((o) => sql`${o}::uuid`), sql`, `)})
      AND ${memberOf}
    LIMIT 1
  `);
  return r.rows.length > 0;
}

/** Throw 403 unless the row is visible to this session. */
export async function assertInScope(
  tx: any,
  session: SessionUser,
  row: { branchId?: string | null; ownerId?: string | null | (string | null | undefined)[] },
  what = "record"
): Promise<void> {
  const scope = await resolveDataScope(tx, session);
  const owners = Array.isArray(row.ownerId) ? row.ownerId : [row.ownerId];
  const hasOwner = owners.some(Boolean);
  // For a BRANCH scope, "in my branch" means the record's OWNER is in my
  // branch — the same rule the list queries use (dataScopeSqlViaOwnerBranch).
  // Checking the record's own branch column instead is what let a detail page
  // disagree with the list it was opened from: a record whose stored branch
  // drifted (or was stamped from whoever imported it) opened fine while being
  // absent from the list, or the reverse. Records with no owner at all keep
  // the old column check — that's all there is to go on.
  if ((scope.kind === "branches" || scope.kind === "desks") && hasOwner) {
    if (await isInScopeViaOwnerBranch(tx, scope, owners)) return;
  } else if (isInScope(scope, row)) {
    return;
  }
  throw Object.assign(
    new Error(`forbidden: this ${what} belongs to another branch or team member`),
    { status: 403 }
  );
}

/**
 * Condition over the `users` table: "people this session is allowed to see".
 *
 * For the roster dropdowns (RM / assignee / owner filters). Those listed every
 * active user in the firm to anyone who could open the page — so a sub-branch
 * head picking an RM saw every other sub-branch's staff, and the filter
 * offered people whose records the wall would never show them anyway.
 *
 * Mirrors the record wall: everyone for the firm admin / back office, the desk
 * or branch for a head, and only yourself otherwise. `alias` is the users
 * table alias when the query has one ("u" → `u.desk_id`).
 */
export async function usersInScopeSql(tx: any, session: SessionUser, alias = ""): Promise<SQL> {
  const scope = await resolveDataScope(tx, session);
  const p = alias ? `${alias}.` : "";
  const col = (c: string) => sql.raw(`${p}${c}`);
  if (scope.kind === "all") return sql`TRUE`;
  if (scope.kind === "desks") {
    return sql`${col("desk_id")} IN (${sql.join(scope.deskIds.map((d) => sql`${d}::uuid`), sql`, `)})`;
  }
  if (scope.kind === "branches") {
    return sql`${col("branch_id")} IN (${sql.join(scope.branchIds.map((b) => sql`${b}::uuid`), sql`, `)})`;
  }
  return sql`${col("id")} = ${scope.userId}::uuid`;
}
