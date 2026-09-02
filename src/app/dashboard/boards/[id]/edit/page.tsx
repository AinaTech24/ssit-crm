import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { getBoard, canEdit, canView, type Actor } from "@/lib/dashboards/service";
import { DashboardBuilder } from "@/components/dashboards/custom/DashboardBuilder";
import type { PlacedWidget } from "@/lib/dashboards/widgets";

export const dynamic = "force-dynamic";

export default async function BoardEditPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const actor: Actor = { userId: session.userId, roles: session.roles ?? [] };
  const showMembers = can(session.roles, "dashboard.view.owner", session.permissions);

  const data = await withTenant(session.tenantId, async (tx) => {
    const board = await getBoard(tx, session.tenantId, id);
    if (!board || board.deletedAt || !canView(board, actor)) return { notFound: true as const };
    if (!canEdit(board, actor)) return { forbidden: true as const, board };
    let members: { id: string; name: string }[] = [];
    if (showMembers) {
      const r = await tx.execute(sql`SELECT id, name FROM users WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' ORDER BY name`);
      members = (r.rows as any[]).map((m) => ({ id: String(m.id), name: m.name ?? "—" }));
    }
    return { board, members };
  });

  if ("notFound" in data && data.notFound) notFound();
  if ("forbidden" in data && data.forbidden) redirect(`/dashboard/boards/${id}`);
  const board = (data as any).board;
  const members = (data as any).members as { id: string; name: string }[];

  return (
    <div className="space-y-3">
      <Link href={`/dashboard/boards/${id}`} className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Done editing
      </Link>
      <DashboardBuilder
        boardId={board.id}
        initialName={board.name}
        initialLayout={(board.layout as PlacedWidget[]) ?? []}
        initialRm={(board.filters as any)?.rm ?? ""}
        members={members}
      />
    </div>
  );
}
