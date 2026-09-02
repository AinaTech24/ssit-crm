import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { ChevronLeft, Building2 } from "lucide-react";
import { withTenant } from "@/db/client";
import { tenants, subscriptions, packages, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { loadTenantLicense } from "@/lib/auth/license";
import { OrganisationProfileForm } from "@/components/settings/OrganisationProfileForm";

export const dynamic = "force-dynamic";

export default async function OrganisationProfilePage() {
  const session = await requireSession();

  // Tenant identity + license + package + owner. License is loaded via its own
  // RLS-safe helper; the rest run inside a tenant context so RLS scopes them.
  const license = await loadTenantLicense(session.tenantId, session.roles);
  const { tenant, sub, ownerRow, pkg } = await withTenant(session.tenantId, async (tx) => {
    const [t, s, owner] = await Promise.all([
      tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1).then((r) => r[0]),
      tx.select().from(subscriptions).where(eq(subscriptions.tenantId, session.tenantId)).limit(1).then((r) => r[0]),
      tx
        .execute(sql`
          SELECT id, name, email FROM users
          WHERE tenant_id = ${session.tenantId} AND 'owner' = ANY(roles)
          ORDER BY activated_at ASC NULLS LAST LIMIT 1
        `)
        .then((r) => (r.rows[0] as { id: string; name: string; email: string } | undefined) ?? null),
    ]);
    const p = s
      ? await tx.select().from(packages).where(eq(packages.id, s.packageId)).limit(1).then((r) => r[0])
      : null;
    return { tenant: t, sub: s, ownerRow: owner, pkg: p };
  });

  return (
    <div className="space-y-4 max-w-4xl">
      <Link
        href="/dashboard/settings"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to settings
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Building2 className="size-5" /> Organisation profile
        </h1>
        <p className="text-muted-foreground text-sm">
          Identity, branding, AUM range. ARN, EUIN, package, and license are managed by SSIT.
        </p>
      </div>

      <OrganisationProfileForm
        tenant={JSON.parse(JSON.stringify(tenant))}
        owner={ownerRow}
        subscription={sub ? JSON.parse(JSON.stringify(sub)) : null}
        pkg={pkg ? JSON.parse(JSON.stringify(pkg)) : null}
        license={JSON.parse(JSON.stringify(license))}
      />
    </div>
  );
}
