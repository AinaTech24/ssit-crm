import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { eq, and, inArray } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { users, legalRegistrations } from "@/db/schema";
import { ProductOfferingForm } from "@/components/product-offerings/ProductOfferingForm";

export const dynamic = "force-dynamic";

export default async function NewProductOfferingPage() {
  const session = await requireSession();
  requireCap(session.roles, "compliance.edit", session.permissions);

  // Catalogs the form picker needs: active users + active registrations.
  const { team, registrations } = await withTenant(session.tenantId, async (tx) => {
    const team = await tx
      .select({ id: users.id, name: users.name, roles: users.roles })
      .from(users)
      .where(
        and(
          eq(users.tenantId, session.tenantId),
          inArray(users.status, ["active", "offboarding"])
        )
      )
      .orderBy(users.name);
    const registrations = await tx
      .select({
        id: legalRegistrations.id,
        registrationFor: legalRegistrations.registrationFor,
        authority: legalRegistrations.authority,
      })
      .from(legalRegistrations)
      .where(
        and(
          eq(legalRegistrations.tenantId, session.tenantId),
          inArray(legalRegistrations.status, ["active", "pending_renewal"])
        )
      )
      .orderBy(legalRegistrations.registrationFor);
    return { team, registrations };
  });

  return (
    <div className="space-y-5 max-w-3xl w-full px-4 sm:px-0">
      <div>
        <Link
          href="/dashboard/product-offerings"
          className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
        >
          <ChevronLeft className="size-3" /> Products &amp; services
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Add an offering</h1>
      </div>
      <ProductOfferingForm
        mode="create"
        teamCatalog={team.map((t) => ({
          id: t.id,
          name: t.name,
          roles: (t.roles ?? []) as string[],
        }))}
        registrationCatalog={registrations}
      />
    </div>
  );
}
