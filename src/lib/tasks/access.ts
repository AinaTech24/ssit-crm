import type { SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { resolveDataScope, dataScopeSqlViaOwnerBranch } from "@/lib/auth/data-scope";

/**
 * Task access.
 *
 * Same split as leads (lib/leads/access.ts): the CAPABILITY answers "may this
 * person see tasks beyond their own at all", the DATA WALL answers "which
 * ones". `task.view.all` used to answer both, and that was the bug — it is held
 * by branch_head, so every sub-branch head saw every task in the firm,
 * including other sub-branches'. Two desk heads could read each other's work.
 *
 * `tasks` has NO branch_id column, so there is nothing to derive a branch from
 * except the people on the task. Ownership is therefore the pair:
 *
 *   assignee_id     who has to do it
 *   created_by_id   who asked for it
 *
 * A task is in scope when EITHER of them is inside the wall, which gives the
 * behaviour a sub-branch needs without any extra rule: a head assigns work to
 * someone on their desk and both of them see it — the head because the
 * assignee is theirs, the assignee because it is their own task. A head on
 * another desk matches neither and sees nothing.
 *
 * Scope by scope:
 *   all      → everything (owner, back office, ops)
 *   desks    → every task whose assignee or creator sits on my sub-branch
 *   branches → the same, one level up
 *   own      → assigned to me, or created by me (unchanged for RMs)
 */

export function requireTaskView(session: SessionUser) {
  requireAny(session.roles, ["task.view.all", "task.view.assigned"], session.permissions);
}

/**
 * The wall as SQL, for both the API list and the dashboard page — they must
 * not drift, which is why this lives here rather than being written twice.
 *
 * Async because the wall reads the user's desk/branch from the database rather
 * than the session token, so moving someone between sub-branches takes effect
 * on their next request instead of their next login.
 */
export async function taskScopeSql(tx: Tx, session: SessionUser, alias = "tasks"): Promise<SQL> {
  const scope = await resolveDataScope(tx, session);
  return dataScopeSqlViaOwnerBranch(scope, [`${alias}.assignee_id`, `${alias}.created_by_id`]);
}
