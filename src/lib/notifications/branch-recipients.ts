/**
 * Who should hear about something that happened in ONE branch.
 *
 * Several senders used to notify "every active user with role X" across the whole
 * firm, so a Baroda client's rejected SIP, or a Baroda employee's leave request,
 * pinged branch heads and RMs in every other branch. This is the one place that
 * answers it branch-wise, with the same rule the data wall uses
 * (lib/auth/data-scope.ts):
 *
 *   - the firm admin and the back-office / ops desk work across every branch, so
 *     they are told about everything (when they hold one of the requested roles);
 *   - everyone else is told only when they sit in the same branch (or desk, for a
 *     firm that runs its structure at desk level) as the record.
 *
 * When the record's branch cannot be worked out (a firm-level event such as a
 * market move, or a record with no owner) nothing is narrowed: the audience is
 * what the sender asked for, exactly as before.
 */

import { sql } from "drizzle-orm";
import { ALL_BRANCH_ROLES } from "@/lib/auth/data-scope";
import type { SessionUser } from "@/lib/auth/jwt";
import { resolveQueueOwners } from "@/lib/scope/view-filter";

export type Unit = { branchId: string | null; deskId: string | null };

const pick = (rec: Record<string, any>, ...keys: string[]): string | null => {
  for (const k of keys) {
    const v = rec?.[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
};

/** A unit with neither a branch nor a desk narrows nothing. */
export function hasUnit(u: Unit | null | undefined): u is Unit {
  return !!u && (!!u.branchId || !!u.deskId);
}

/** The branch / desk a user sits in. */
export async function unitOfUser(tx: any, tenantId: string, userId: string | null | undefined): Promise<Unit | null> {
  if (!userId) return null;
  const r = await tx.execute(sql`
    SELECT branch_id, desk_id FROM users
     WHERE id = ${userId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
  `);
  const u = r.rows[0] as { branch_id: string | null; desk_id: string | null } | undefined;
  return u ? { branchId: u.branch_id ?? null, deskId: u.desk_id ?? null } : null;
}

/**
 * The branch a record belongs to: its own branch_id when it has one, otherwise the
 * branch of the person who owns it (client RM, lead owner, task assignee…).
 */
export async function unitOfRecord(
  tx: any,
  tenantId: string,
  record: Record<string, any> | null | undefined
): Promise<Unit | null> {
  if (!record) return null;
  const branchId = pick(record, "branch_id", "branchId");
  const owner = pick(
    record,
    "rm_id", "rmId",
    "owner_id", "ownerId", "owner_user_id", "ownerUserId",
    "assigned_to_user_id", "assignedToUserId",
    "assignee_id", "assigneeId"
  );
  const byOwner = await unitOfUser(tx, tenantId, owner);
  if (branchId) return { branchId, deskId: byOwner?.deskId ?? null };
  return byOwner;
}

/** The branch of a record named only by type + id (what a workflow run carries). */
export async function unitOfSubject(
  tx: any,
  tenantId: string,
  subjectType: string | null | undefined,
  subjectId: string | null | undefined
): Promise<Unit | null> {
  if (!subjectType || !subjectId) return null;
  const table: Record<string, string> = {
    investor: "investors",
    lead: "leads",
    task: "tasks",
    service_request: "service_requests",
  };
  const t = table[subjectType];
  if (!t) return null;
  try {
    const r = await tx.execute(sql`
      SELECT * FROM ${sql.raw(t)}
       WHERE id = ${subjectId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
    `);
    return unitOfRecord(tx, tenantId, r.rows[0] as Record<string, any> | undefined);
  } catch {
    return null; // a lookup failure must never lose the notification
  }
}

/**
 * Active users holding any of `roles`, narrowed to `unit` for everyone except the
 * firm-wide roles. With no usable unit the narrowing is skipped.
 */
export async function usersWithRolesInUnit(
  tx: any,
  tenantId: string,
  roles: string[],
  unit: Unit | null | undefined
): Promise<string[]> {
  const wanted = roles.filter(Boolean);
  if (!wanted.length) return [];
  const roleList = sql`ARRAY[${sql.join(wanted.map((r) => sql`${r}`), sql`, `)}]::text[]`;
  const firmWide = sql`ARRAY[${sql.join(ALL_BRANCH_ROLES.map((r) => sql`${r}`), sql`, `)}]::text[]`;

  const inUnit: ReturnType<typeof sql>[] = [];
  if (hasUnit(unit)) {
    if (unit.deskId) inUnit.push(sql`desk_id = ${unit.deskId}::uuid`);
    if (unit.branchId) inUnit.push(sql`branch_id = ${unit.branchId}::uuid`);
  }
  const narrow = inUnit.length ? sql` AND (roles && ${firmWide} OR ${sql.join(inUnit, sql` OR `)})` : sql``;

  const r = await tx.execute(sql`
    SELECT id FROM users
     WHERE tenant_id = ${tenantId}::uuid
       AND status = 'active'
       AND deleted_at IS NULL
       AND roles && ${roleList}
       ${narrow}
  `);
  return (r.rows as Array<{ id: string }>).map((x) => String(x.id));
}

/**
 * Whose records a scheduled digest for this user may count — the same wall the
 * Command Center page applies when they open it: null = the whole firm (owner,
 * back office, ops), otherwise the people in their own branch / desk (a branch
 * head) or just themselves (an RM). A background job has no session, so this builds
 * the little of one the wall needs from the user row.
 */
export async function scopeOwnersOfUser(
  tx: any,
  tenantId: string,
  u: { id: string; roles: string[]; branchId?: string | null }
): Promise<string[] | null> {
  const session = {
    userId: u.id,
    tenantId,
    roles: u.roles ?? [],
    branchId: u.branchId ?? undefined,
    email: "",
    name: "",
  } as SessionUser;
  return resolveQueueOwners(tx, session, {} as Parameters<typeof resolveQueueOwners>[2]);
}
