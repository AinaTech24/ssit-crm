import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { ChevronLeft, GitBranch } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { users } from "@/db/schema";
import AssignmentRulesManager from "./AssignmentRulesManager";

export const dynamic = "force-dynamic";

export default async function AssignmentRulesPage() {
  const session = await requireSession();
  // Owners + branch heads configure auto-assignment (settings.users capability).
  if (!can(session.roles, "settings.users", session.permissions)) {
    redirect("/dashboard");
  }

  const team = await withTenant(session.tenantId, async (tx) => {
    const rows = await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.tenantId, session.tenantId), ne(users.status, "suspended")));
    return rows.map((r) => ({ id: r.id, name: r.name }));
  });

  return (
    <div className="space-y-5 max-w-4xl">
      <Link href="/dashboard/settings" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to settings
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <GitBranch className="size-5" /> Auto-assignment rules
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Automatically route new leads &amp; clients to your team — round-robin or to whoever has the lightest load.
          Lower-priority rules run first.
        </p>
      </div>

      <AssignmentRulesManager team={team} />
    </div>
  );
}
