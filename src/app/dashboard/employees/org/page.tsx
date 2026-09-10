import Link from "next/link";
import { and, eq, ne } from "drizzle-orm";
import { ChevronLeft, Network } from "lucide-react";
import { withTenant } from "@/db/client";
import { users } from "@/db/schema";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { can, ROLE_LABELS } from "@/lib/auth/rbac";
import { Avatar } from "@/components/ui/Avatar";

export const dynamic = "force-dynamic";

type Node = {
  id: string;
  name: string;
  department: string | null;
  roles: string[];
  avatarUrl: string | null;
  managerId: string | null;
  children: Node[];
};

export default async function OrgChartPage() {
  const session = await requireSession();
  // Team management is firm-admin only — same gate as the Employees list.
  if (!can(session.roles, "settings.users", session.permissions)) redirect("/dashboard");

  const rows = await withTenant(session.tenantId, async (tx) =>
    tx
      .select({
        id: users.id,
        name: users.name,
        department: users.department,
        roles: users.roles,
        avatarUrl: users.avatarUrl,
        managerId: users.reportingManagerId,
      })
      .from(users)
      .where(and(eq(users.tenantId, session.tenantId), ne(users.status, "offboarded")))
      .orderBy(users.name)
  );

  // Build the tree. Roots = no manager, or a manager that isn't in the set
  // (defensive against a dangling/cross-tenant pointer).
  const byId = new Map<string, Node>();
  for (const r of rows) byId.set(r.id, { ...r, roles: (r.roles as string[]) ?? [], children: [] });
  const roots: Node[] = [];
  for (const n of byId.values()) {
    if (n.managerId && byId.has(n.managerId) && n.managerId !== n.id) {
      byId.get(n.managerId)!.children.push(n);
    } else {
      roots.push(n);
    }
  }
  // Sort children by name for stable rendering.
  const sortRec = (n: Node) => { n.children.sort((a, b) => a.name.localeCompare(b.name)); n.children.forEach(sortRec); };
  roots.sort((a, b) => a.name.localeCompare(b.name));
  roots.forEach(sortRec);

  return (
    <div className="space-y-6 max-w-5xl">
      <Link href="/dashboard/employees" className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1">
        <ChevronLeft className="size-3" /> Back to employees
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Network className="size-6 text-brand-cyan" /> Org chart
        </h1>
        <p className="text-muted-foreground text-sm">Reporting hierarchy built from each employee&apos;s reporting manager.</p>
      </div>

      {roots.length === 0 ? (
        <div className="card-surface p-12 text-center text-sm text-muted-foreground">No employees yet.</div>
      ) : (
        <div className="space-y-4">
          {roots.map((n) => (
            <OrgNode key={n.id} node={n} depth={0} />
          ))}
        </div>
      )}
    </div>
  );
}

function OrgNode({ node, depth }: { node: Node; depth: number }) {
  return (
    <div className={depth > 0 ? "ml-6 border-l border-border pl-4" : ""}>
      <Link
        href={`/dashboard/employees/${node.id}`}
        className="inline-flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2 hover:border-brand-cyan/50 hover:bg-secondary/30 transition-colors"
      >
        <Avatar src={node.avatarUrl && /^https?:\/\//.test(node.avatarUrl) ? node.avatarUrl : null} name={node.name} size={32} />
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{node.name}</div>
          <div className="text-[11px] text-muted-foreground truncate">
            {node.roles.slice(0, 2).map((r) => ROLE_LABELS[r] ?? r).join(", ")}
            {node.department ? ` · ${node.department.replace(/_/g, " ")}` : ""}
            {node.children.length > 0 ? ` · ${node.children.length} report${node.children.length > 1 ? "s" : ""}` : ""}
          </div>
        </div>
      </Link>
      {node.children.length > 0 && (
        <div className="mt-2 space-y-2">
          {node.children.map((c) => (
            <OrgNode key={c.id} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
