import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { listBoards, canEdit, type Actor } from "@/lib/dashboards/service";
import { BOARD_TEMPLATES } from "@/lib/dashboards/templates";
import { BoardsManager, type BoardLite } from "@/components/dashboards/custom/BoardsManager";

export const dynamic = "force-dynamic";

export default async function BoardsPage() {
  const session = await requireSession();
  const actor: Actor = { userId: session.userId, roles: session.roles ?? [] };

  const { mine, shared, deleted, ownerNames } = await withTenant(session.tenantId, async (tx) => {
    const lists = await listBoards(tx, session.tenantId, actor);
    // Resolve creator names for shared boards.
    const ids = Array.from(new Set(lists.shared.map((b) => b.userId).filter(Boolean))) as string[];
    let ownerNames: Record<string, string> = {};
    if (ids.length) {
      const r = await tx.execute(sql`SELECT id, name FROM users WHERE id = ANY(${sql`ARRAY[${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}]`})`);
      ownerNames = Object.fromEntries((r.rows as any[]).map((u) => [String(u.id), u.name ?? "—"]));
    }
    return { ...lists, ownerNames };
  });

  const toLite = (b: any, sharedView = false): BoardLite => ({
    id: b.id,
    name: b.name,
    description: b.description ?? null,
    scope: b.scope,
    isDefault: b.isDefault,
    locked: b.locked,
    widgetCount: Array.isArray(b.layout) ? b.layout.length : 0,
    ownerName: sharedView ? ownerNames[String(b.userId)] ?? null : null,
    canEdit: canEdit(b, actor),
  });

  const templates = BOARD_TEMPLATES.map((t) => ({
    key: t.key,
    name: t.name,
    description: t.description,
    widgetCount: t.widgets.length,
  }));

  return (
    <BoardsManager
      mine={mine.map((b) => toLite(b))}
      shared={shared.map((b) => toLite(b, true))}
      deleted={deleted.map((b) => toLite(b))}
      templates={templates}
    />
  );
}
