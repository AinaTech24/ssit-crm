/**
 * Dashboard ("My Dashboards") service — all board operations + access checks.
 * Everything runs inside withTenant (RLS); within a tenant, a board is owned by
 * its creator. The creator (or a firm owner) can edit/delete/share/lock it;
 * shared boards are visible to everyone in the firm.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { dashboards, type Dashboard, type DashboardWidgetInstance } from "@/db/schema/dashboards";

export interface Actor {
  userId: string;
  roles: string[];
}

export function canEdit(board: Dashboard, actor: Actor): boolean {
  if (board.userId === actor.userId) return true;
  if (actor.roles.includes("owner")) return true; // firm admin
  return false;
}

export function canView(board: Dashboard, actor: Actor): boolean {
  if (board.userId === actor.userId) return true;
  if (board.scope === "shared") return true;
  return actor.roles.includes("owner");
}

export async function listBoards(tx: Tx, tenantId: string, actor: Actor) {
  const all = await tx
    .select()
    .from(dashboards)
    .where(eq(dashboards.tenantId, tenantId))
    .orderBy(desc(dashboards.updatedAt));

  const live = all.filter((b) => !b.deletedAt);
  return {
    mine: live.filter((b) => b.userId === actor.userId),
    shared: live.filter((b) => b.scope === "shared" && b.userId !== actor.userId),
    deleted: all.filter((b) => b.deletedAt && b.userId === actor.userId),
  };
}

export async function getBoard(tx: Tx, tenantId: string, id: string): Promise<Dashboard | null> {
  const [b] = await tx.select().from(dashboards).where(and(eq(dashboards.id, id), eq(dashboards.tenantId, tenantId))).limit(1);
  return b ?? null;
}

export async function createBoard(
  tx: Tx,
  tenantId: string,
  actor: Actor,
  input: { name: string; description?: string; layout?: DashboardWidgetInstance[]; scope?: "private" | "shared" }
): Promise<Dashboard> {
  const [b] = await tx
    .insert(dashboards)
    .values({
      tenantId,
      userId: actor.userId,
      createdBy: actor.userId,
      name: input.name.trim() || "Untitled dashboard",
      description: input.description ?? null,
      scope: input.scope ?? "private",
      layout: (input.layout ?? []) as any,
    } as any)
    .returning();
  return b;
}

export async function updateBoard(
  tx: Tx,
  id: string,
  patch: Partial<Pick<Dashboard, "name" | "description" | "scope" | "locked" | "layout" | "filters">>
): Promise<void> {
  await tx.update(dashboards).set({ ...patch, updatedAt: new Date() } as any).where(eq(dashboards.id, id));
}

/** Soft delete → Recently Deleted (also clears default so the unique frees). */
export async function softDeleteBoard(tx: Tx, id: string): Promise<void> {
  await tx.update(dashboards).set({ deletedAt: new Date(), isDefault: false, updatedAt: new Date() }).where(eq(dashboards.id, id));
}

export async function restoreBoard(tx: Tx, id: string): Promise<void> {
  await tx.update(dashboards).set({ deletedAt: null, updatedAt: new Date() } as any).where(eq(dashboards.id, id));
}

export async function cloneBoard(tx: Tx, tenantId: string, actor: Actor, src: Dashboard, name?: string): Promise<Dashboard> {
  const [b] = await tx
    .insert(dashboards)
    .values({
      tenantId,
      userId: actor.userId,
      createdBy: actor.userId,
      name: (name?.trim() || `${src.name} (copy)`).slice(0, 120),
      description: src.description,
      scope: "private",
      isDefault: false,
      locked: false,
      layout: src.layout as any,
      filters: src.filters as any,
    } as any)
    .returning();
  return b;
}

/** Make this board the actor's default home — unset their other defaults first. */
export async function setDefaultBoard(tx: Tx, tenantId: string, actor: Actor, id: string): Promise<void> {
  await tx
    .update(dashboards)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(and(eq(dashboards.tenantId, tenantId), eq(dashboards.userId, actor.userId), eq(dashboards.isDefault, true)));
  await tx.update(dashboards).set({ isDefault: true, updatedAt: new Date() }).where(eq(dashboards.id, id));
}

/** The actor's default custom board (rendered on /dashboard), or null. */
export async function getDefaultBoard(tx: Tx, tenantId: string, userId: string): Promise<Dashboard | null> {
  const [b] = await tx
    .select()
    .from(dashboards)
    .where(and(eq(dashboards.tenantId, tenantId), eq(dashboards.userId, userId), eq(dashboards.isDefault, true), isNull(dashboards.deletedAt)))
    .limit(1);
  return b ?? null;
}

// Re-exports so route files import from one place.
export { dashboards };
export type { Dashboard, DashboardWidgetInstance };
