import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { ChevronLeft, Pencil, LayoutDashboard } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { getBoard, canView, canEdit, type Actor } from "@/lib/dashboards/service";
import { DashboardView } from "@/components/dashboards/custom/DashboardView";
import type { PlacedWidget } from "@/lib/dashboards/widgets";

export const dynamic = "force-dynamic";

export default async function BoardViewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const actor: Actor = { userId: session.userId, roles: session.roles ?? [] };
  const showMembers = can(session.roles, "dashboard.view.owner", session.permissions);

  const data = await withTenant(session.tenantId, async (tx) => {
    const board = await getBoard(tx, session.tenantId, id);
    if (!board || board.deletedAt || !canView(board, actor)) return null;
    let members: { id: string; name: string }[] = [];
    if (showMembers) {
      const r = await tx.execute(sql`SELECT id, name FROM users WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' ORDER BY name`);
      members = (r.rows as any[]).map((m) => ({ id: String(m.id), name: m.name ?? "—" }));
    }
    return { board, members, editable: canEdit(board, actor) };
  });

  if (!data) notFound();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <Link href="/dashboard/boards" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
            <ChevronLeft className="size-4" /> My Dashboards
          </Link>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 mt-1">
            <LayoutDashboard className="size-5 text-brand-cyan" /> {data.board.name}
          </h1>
        </div>
        {data.editable && (
          <Link href={`/dashboard/boards/${id}/edit`} className="btn-secondary text-sm inline-flex items-center gap-1.5">
            <Pencil className="size-4" /> Edit
          </Link>
        )}
      </div>

      <DashboardView
        layout={(data.board.layout as PlacedWidget[]) ?? []}
        members={data.members}
        initialRm={(data.board.filters as any)?.rm ?? ""}
      />
    </div>
  );
}
