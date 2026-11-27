import { sql, type SQL } from "drizzle-orm";
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
 * plus anyone named as a COLLABORATOR on it (migration 0269), who works it with them.
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
 *
 * On top of that, people who "share tasks" with each other (users.task_team_ids) see one
 * another's tasks in the All view. The Assigned-to-me / Assigned-by-me views filter to the
 * person afterwards, so those stay personal.
 */

export function requireTaskView(session: SessionUser) {
  requireAny(session.roles, ["task.view.all", "task.view.assigned"], session.permissions);
}

/** `alias` is a trusted constant of our own queries, never user input. */
export function isTaskCollaboratorSql(alias: string, userId: string): SQL {
  return sql`jsonb_exists(COALESCE(${sql.raw(alias)}.collaborator_ids, '[]'::jsonb), ${userId})`;
}

/** "Assigned to me": I am the assignee, or I am on it as a collaborator. */
export function taskMineSql(alias: string, userId: string): SQL {
  return sql`(${sql.raw(alias)}.assignee_id = ${userId}::uuid OR ${isTaskCollaboratorSql(alias, userId)})`;
}

/** Who shares tasks with this person - whichever of the two had the setting made. */
export async function taskTeamIds(tx: Tx, tenantId: string, userId: string): Promise<string[]> {
  const r = await tx.execute(sql`
    SELECT u.id FROM users u
     WHERE u.tenant_id = ${tenantId}::uuid AND u.id <> ${userId}::uuid
       AND (jsonb_exists(COALESCE(u.task_team_ids, '[]'::jsonb), ${userId})
            OR EXISTS (SELECT 1 FROM users me
                        WHERE me.id = ${userId}::uuid AND me.tenant_id = ${tenantId}::uuid
                          AND jsonb_exists(COALESCE(me.task_team_ids, '[]'::jsonb), u.id::text)))
  `);
  return (r.rows as Array<{ id: string }>).map((x) => String(x.id));
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
  const wall = dataScopeSqlViaOwnerBranch(scope, [`${alias}.assignee_id`, `${alias}.created_by_id`]);
  const team = await taskTeamIds(tx, session.tenantId, session.userId);
  const teamIds = team.length ? sql.join(team.map((t) => sql`${t}::uuid`), sql`, `) : null;
  const shared = teamIds
    ? sql` OR ${sql.raw(alias)}.assignee_id IN (${teamIds}) OR ${sql.raw(alias)}.created_by_id IN (${teamIds})`
    : sql``;
  // A named sign-off approver (marketing content) always sees the task they
  // have to approve, whichever desk they sit on.
  return sql`(${wall} OR ${sql.raw(alias)}.meta->>'approverId' = ${session.userId} OR ${isTaskCollaboratorSql(alias, session.userId)}${shared})`;
}
