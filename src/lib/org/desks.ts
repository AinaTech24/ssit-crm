/**
 * Desk service — manage the Branch → Desk → RM sub-branch layer. SERVER-ONLY.
 * All functions run inside a withTenant() tx (RLS scopes rows).
 */

import { asc, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { desks, users, branches } from "@/db/schema";

export type DeskWithBranch = {
  id: string;
  branchId: string;
  branchName: string;
  name: string;
  code: string | null;
  memberCount: number;
};

export type DeskMember = {
  id: string;
  name: string;
  branchId: string | null;
  deskId: string | null;
  roles: string[];
};

/** All desks (with branch name + member count) + the branch list + RM roster. */
export async function loadDeskBoard(tx: Tx): Promise<{
  branches: { id: string; name: string }[];
  desks: DeskWithBranch[];
  members: DeskMember[];
}> {
  const branchList = await tx
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .orderBy(asc(branches.name));

  const deskRows = await tx
    .select({
      id: desks.id,
      branchId: desks.branchId,
      branchName: branches.name,
      name: desks.name,
      code: desks.code,
    })
    .from(desks)
    .leftJoin(branches, eq(branches.id, desks.branchId))
    .orderBy(asc(branches.name), asc(desks.name));

  const memberRows = await tx
    .select({
      id: users.id,
      name: users.name,
      branchId: users.branchId,
      deskId: users.deskId,
      roles: users.roles,
    })
    .from(users)
    .orderBy(asc(users.name));

  const countByDesk = new Map<string, number>();
  for (const m of memberRows) {
    if (m.deskId) countByDesk.set(m.deskId, (countByDesk.get(m.deskId) ?? 0) + 1);
  }

  return {
    branches: branchList,
    desks: deskRows.map((d) => ({
      id: d.id,
      branchId: d.branchId,
      branchName: d.branchName ?? "",
      name: d.name,
      code: d.code,
      memberCount: countByDesk.get(d.id) ?? 0,
    })),
    members: memberRows.map((m) => ({
      id: m.id,
      name: m.name,
      branchId: m.branchId,
      deskId: m.deskId,
      roles: (m.roles as string[]) ?? [],
    })),
  };
}

export async function createDesk(
  tx: Tx,
  tenantId: string,
  input: { branchId: string; name: string; code?: string | null }
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(desks)
    .values({
      tenantId,
      branchId: input.branchId,
      name: input.name.trim(),
      code: input.code?.trim() || null,
    })
    .returning({ id: desks.id });
  return row;
}

export async function updateDesk(
  tx: Tx,
  id: string,
  input: { name?: string; code?: string | null }
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (input.name != null) patch.name = input.name.trim();
  if (input.code !== undefined) patch.code = input.code?.trim() || null;
  if (Object.keys(patch).length === 0) return;
  patch.updatedAt = new Date();
  await tx.update(desks).set(patch).where(eq(desks.id, id));
}

/** Delete a desk and unassign its members. */
export async function deleteDesk(tx: Tx, id: string): Promise<void> {
  await tx.update(users).set({ deskId: null }).where(eq(users.deskId, id));
  await tx.delete(desks).where(eq(desks.id, id));
}

/** Assign (or clear, deskId=null) a user's desk. The desk must be in the same
 *  branch as the user (enforced by caller / RLS scoping). */
export async function assignUserDesk(tx: Tx, userId: string, deskId: string | null): Promise<void> {
  await tx.update(users).set({ deskId }).where(eq(users.id, userId));
}
