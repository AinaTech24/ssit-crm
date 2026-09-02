/**
 * Staff exit automation.
 *
 * When an employee is offboarded, we do five things in the same
 * transaction the status flip happens in:
 *
 *   1. Reassign their open tasks to their reporting manager
 *      (fallback: tenant owner).
 *   2. Reassign their upcoming review meetings to the same target.
 *   3. Flag investors where they were the RM — owner reassigns by hand
 *      (auto-reassign would dump 100s of clients on a random manager).
 *      We create a single task: "Reassign investors of <name>".
 *   4. Revoke any unused share_tokens they created — a public link they
 *      generated shouldn't outlive their access.
 *   5. Stamp users.sessionsInvalidAfter = now() so getSession() bounces
 *      their still-valid JWT on the next request (enforced by the
 *      revocation check in src/lib/auth/revocation.ts), and clear the
 *      in-process revocation cache so it takes effect immediately.
 *
 * Idempotent — safe to call again on an already-offboarded user; it
 * just won't find anything to do.
 *
 * Returns a summary the API route can include in the response so the
 * UI can show "We reassigned 14 tasks + 3 meetings, revoked 2 public
 * links, and created a task for you to redistribute 87 clients."
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { clearSessionRevocationCache } from "@/lib/auth/revocation";

export type OffboardSummary = {
  reassignedTasks: number;
  reassignedMeetings: number;
  reassignTarget: { userId: string; name: string } | null;
  investorsNeedingReassign: number;
  revokedShareTokens: number;
};

export async function offboardUser(params: {
  tx: Tx;
  tenantId: string;
  userId: string;
  actorUserId: string;
}): Promise<OffboardSummary> {
  const { tx, tenantId, userId, actorUserId } = params;

  // 1. Find the reassignment target — reporting manager first, then any
  //    active owner. We don't fall back to actorUserId because that could
  //    be a back-office staffer who shouldn't own clients.
  const targetRow = (
    await tx.execute(sql`
      WITH leaver AS (
        SELECT reporting_manager_id, name FROM users
        WHERE id = ${userId}::uuid AND tenant_id = ${tenantId}::uuid
      )
      SELECT u.id, u.name
      FROM users u, leaver l
      WHERE u.tenant_id = ${tenantId}::uuid
        AND u.status = 'active'
        AND (
          u.id = l.reporting_manager_id
          OR 'owner' = ANY(u.roles)
        )
      ORDER BY (u.id = l.reporting_manager_id) DESC, u.created_at ASC
      LIMIT 1
    `)
  ).rows[0] as { id: string; name: string } | undefined;

  const reassignTarget = targetRow
    ? { userId: targetRow.id, name: targetRow.name }
    : null;

  // 2. Reassign open tasks. We append a note so the new owner sees this
  //    came from an exit, and stamp the audit trail.
  let reassignedTasks = 0;
  if (reassignTarget) {
    const r = await tx.execute(sql`
      UPDATE tasks
      SET assignee_id = ${reassignTarget.userId}::uuid,
          updated_at = now()
      WHERE tenant_id = ${tenantId}::uuid
        AND assignee_id = ${userId}::uuid
        AND status IN ('open', 'in_progress', 'blocked')
      RETURNING id
    `);
    reassignedTasks = r.rows.length;
  }

  // 3. Reassign upcoming meetings.
  let reassignedMeetings = 0;
  if (reassignTarget) {
    const r = await tx.execute(sql`
      UPDATE review_meetings
      SET rm_id = ${reassignTarget.userId}::uuid,
          updated_at = now()
      WHERE tenant_id = ${tenantId}::uuid
        AND rm_id = ${userId}::uuid
        AND status IN ('scheduled', 'confirmed')
        AND meeting_date >= now()
      RETURNING id
    `);
    reassignedMeetings = r.rows.length;
  }

  // 4. Investors: count, don't auto-reassign. Create a high-priority
  //    task on the target so the owner remembers.
  const invCountRow = (
    await tx.execute(sql`
      SELECT COUNT(*)::int AS c
      FROM investors
      WHERE tenant_id = ${tenantId}::uuid
        AND rm_id = ${userId}::uuid
        AND status = 'active'
    `)
  ).rows[0] as { c: number };
  const investorsNeedingReassign = invCountRow?.c ?? 0;

  if (investorsNeedingReassign > 0 && reassignTarget) {
    await tx.execute(sql`
      INSERT INTO tasks (
        id, tenant_id, title, description, status, priority,
        assignee_id, due_at, kind, created_by, created_at, updated_at
      )
      VALUES (
        gen_random_uuid(), ${tenantId}::uuid,
        ${`Reassign ${investorsNeedingReassign} clients of departing employee`},
        ${`The employee was offboarded. Their ${investorsNeedingReassign} active clients still have them as RM — please redistribute among the team within 7 days.`},
        'open', 'high',
        ${reassignTarget.userId}::uuid,
        now() + interval '7 days',
        'admin',
        ${actorUserId}::uuid,
        now(), now()
      )
    `);
  }

  // 5. Revoke unused share tokens they created.
  const revokedRows = await tx.execute(sql`
    UPDATE share_tokens
    SET revoked_at = now(),
        updated_at = now()
    WHERE tenant_id = ${tenantId}::uuid
      AND created_by = ${userId}::uuid
      AND used_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > now()
    RETURNING id
  `);
  const revokedShareTokens = revokedRows.rows.length;

  // 6. Kill the leaver's live sessions. Their JWT stays cryptographically
  //    valid until its 8h TTL, but stamping sessions_invalid_after = now()
  //    makes getSession() reject it on the very next request (the token's
  //    `iat` now predates the epoch). We clear the in-process revocation
  //    cache too so it takes effect immediately rather than after the 30s TTL.
  await tx.execute(sql`
    UPDATE users
    SET sessions_invalid_after = now(),
        updated_at = now()
    WHERE id = ${userId}::uuid
      AND tenant_id = ${tenantId}::uuid
  `);
  clearSessionRevocationCache(userId);

  // 7. Audit. The employees PATCH route already audits the status flip
  //    itself; this audit captures the cascade so investigators can see
  //    "what else got moved when X left".
  await recordAudit(tx, {
    tenantId,
    actorUserId,
    action: "employee.offboard_cascade",
    entityType: "user",
    entityId: userId,
    before: null,
    after: {
      reassignedTasks,
      reassignedMeetings,
      reassignTarget: reassignTarget?.userId ?? null,
      investorsNeedingReassign,
      revokedShareTokens,
    },
  });

  return {
    reassignedTasks,
    reassignedMeetings,
    reassignTarget,
    investorsNeedingReassign,
    revokedShareTokens,
  };
}
