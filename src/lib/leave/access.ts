/**
 * Who sees and who decides a leave application.
 *
 * Leave reasons are HR-sensitive — medical, bereavement, personal — so this is
 * a visibility rule, not just a button-enabling one. It lives here because
 * three places need the SAME answer and had been giving three different ones:
 * the list API scoped itself, the list PAGE scoped nothing at all (it showed
 * every employee's leave and reason to anyone who opened it), and the decide
 * route had its own inline check.
 *
 * The firm's rule:
 *
 *   Admin (owner), Gifting/HR and Assistant administer leave for the whole
 *   firm — including a BRANCH HEAD's own request, which is the point: a head
 *   cannot approve themselves, so their request has to land with someone above
 *   the branch.
 *
 *   A BRANCH HEAD handles their own sub-branch: they see and decide the
 *   requests of the people on their desk (RMs, back office, and so on). They do
 *   NOT decide another branch head's request, even on the same desk — those go
 *   to the three roles above, by the same logic that stops self-approval.
 *
 *   Everyone else sees their own requests, plus those of anyone who reports to
 *   them (delegated approval, unchanged).
 */

import { sql, type SQL } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";

export type LeaveScope =
  /** Whole firm — owner / gifting_hr / assistant. */
  | { kind: "all" }
  /** A branch head: their desk, plus their own request. */
  | { kind: "desk"; deskId: string; userId: string }
  /** Own requests plus direct reports. */
  | { kind: "own"; userId: string };

/** Administers leave for the whole firm. */
export function administersLeave(session: SessionUser): boolean {
  return can(session.roles, "leave.manage.all", session.permissions);
}

/** Runs a sub-branch's leave. Scoped — see the note above. */
export function runsBranchLeave(session: SessionUser): boolean {
  return can(session.roles, "leave.manage.branch", session.permissions);
}

/**
 * Resolve the wall for this session. Reads desk_id from the DATABASE rather
 * than the session token, so moving someone to another sub-branch takes effect
 * on their next request instead of their next login.
 */
export async function resolveLeaveScope(tx: any, session: SessionUser): Promise<LeaveScope> {
  if (administersLeave(session)) return { kind: "all" };
  if (runsBranchLeave(session)) {
    const r = await tx.execute(sql`
      SELECT desk_id FROM users
      WHERE id = ${session.userId}::uuid AND tenant_id = ${session.tenantId}::uuid
      LIMIT 1
    `);
    const deskId = (r.rows[0] as { desk_id?: string | null } | undefined)?.desk_id;
    // A branch head with no sub-branch set has no desk to run. Fail CLOSED to
    // their own records rather than silently widening to the firm.
    if (deskId) return { kind: "desk", deskId, userId: session.userId };
  }
  return { kind: "own", userId: session.userId };
}

/**
 * The scope as a SQL predicate over a leave_applications alias. AND this into
 * any query that lists applications.
 */
export function leaveScopeSql(scope: LeaveScope, tenantId: string, alias = "la"): SQL {
  if (scope.kind === "all") return sql`TRUE`;
  const employee = sql.raw(`${alias}.employee_user_id`);
  if (scope.kind === "desk") {
    return sql`(
      ${employee} = ${scope.userId}::uuid
      OR ${employee} IN (
        SELECT id FROM users
        WHERE tenant_id = ${tenantId}::uuid AND desk_id = ${scope.deskId}::uuid
      )
    )`;
  }
  return sql`(
    ${employee} = ${scope.userId}::uuid
    OR ${employee} IN (
      SELECT id FROM users
      WHERE tenant_id = ${tenantId}::uuid AND reporting_manager_id = ${scope.userId}::uuid
    )
  )`;
}

/** What the decide rules need to know about the person who applied. */
export type LeaveApplicant = {
  userId: string;
  deskId: string | null;
  roles: string[];
  reportingManagerId: string | null;
};

export async function loadLeaveApplicant(
  tx: any,
  tenantId: string,
  userId: string
): Promise<LeaveApplicant | null> {
  const r = await tx.execute(sql`
    SELECT id, desk_id, roles, reporting_manager_id FROM users
    WHERE id = ${userId}::uuid AND tenant_id = ${tenantId}::uuid
    LIMIT 1
  `);
  const row = r.rows[0] as
    | { id: string; desk_id: string | null; roles: unknown; reporting_manager_id: string | null }
    | undefined;
  if (!row) return null;
  return {
    userId: row.id,
    deskId: row.desk_id,
    roles: Array.isArray(row.roles) ? (row.roles as string[]) : [],
    reportingManagerId: row.reporting_manager_id,
  };
}

/**
 * May this session approve or reject this application?
 *
 * `scope` is the caller's resolved wall; `applicant` is who filed it. Returns
 * a reason string when it cannot, so the API and the UI can say the same thing.
 */
export function decideLeaveCheck(
  session: SessionUser,
  scope: LeaveScope,
  applicant: LeaveApplicant
): { ok: true } | { ok: false; reason: string } {
  const isOwner = session.roles.includes("owner");

  // Segregation of duties. A solo owner is legitimately both maker and checker
  // (mirrors the templates maker-checker), so owners are exempt.
  if (applicant.userId === session.userId && !isOwner) {
    return {
      ok: false,
      reason: "You can't approve your own leave — an admin, assistant or gifting/HR must decide it.",
    };
  }

  if (scope.kind === "all") return { ok: true };

  if (scope.kind === "desk") {
    if (applicant.roles.includes("branch_head")) {
      return {
        ok: false,
        reason: "A branch head's leave is decided by an admin, assistant or gifting/HR.",
      };
    }
    if (applicant.deskId && applicant.deskId === scope.deskId) return { ok: true };
    return { ok: false, reason: "This request belongs to another sub-branch." };
  }

  // Delegated approval: the applicant's own reporting manager.
  if (applicant.reportingManagerId && applicant.reportingManagerId === session.userId) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: "Only an admin, assistant, gifting/HR, the branch head or the employee's reporting manager can decide leave.",
  };
}

/** Cancelling is the applicant's own right, or anyone who could have decided it. */
export function cancelLeaveCheck(
  session: SessionUser,
  scope: LeaveScope,
  applicant: LeaveApplicant
): { ok: true } | { ok: false; reason: string } {
  if (applicant.userId === session.userId) return { ok: true };
  const decide = decideLeaveCheck(session, scope, applicant);
  if (decide.ok) return { ok: true };
  return { ok: false, reason: "You can only cancel your own leave." };
}
