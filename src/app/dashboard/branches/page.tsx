/**
 * Branches & offices — CRUD over the tenant's branch offices.
 *
 * Linked from Settings → Firm profile → "Offices". Gated by `settings.users`
 * (same cap the firm-profile page uses). The HQ / registered office is created
 * automatically at signup and can't be deleted here.
 */

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { eq, asc, and, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { branches, users } from "@/db/schema";
import { BranchesManager } from "@/components/branches/BranchesManager";

export const dynamic = "force-dynamic";

export default async function BranchesPage() {
  const session = await requireSession();
  requireCap(session.roles, "settings.users", session.permissions);

  const data = await withTenant(session.tenantId, async (tx) => {
    const branchRows = await tx
      .select()
      .from(branches)
      .where(eq(branches.tenantId, session.tenantId))
      .orderBy(sql`(${branches.isHq} = 'true') desc`, asc(branches.name));

    const userRows = await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(
        and(eq(users.tenantId, session.tenantId), eq(users.status, "active"))
      )
      .orderBy(asc(users.name));

    return { branchRows, userRows };
  });

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5">
      <div>
        <Link
          href="/dashboard/settings/firm-profile"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Back to firm profile
        </Link>
        <h1 className="text-xl font-semibold mt-2">Branches &amp; offices</h1>
        <p className="text-sm text-muted-foreground">
          Your registered HQ plus any branch offices. Assign a branch head and
          keep the addresses current for SEBI / AMFI records.
        </p>
      </div>

      <BranchesManager branches={data.branchRows} users={data.userRows} />
    </div>
  );
}
