import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { tenants } from "@/db/schema";
import { LegalRegistrationForm } from "@/components/legal-registrations/LegalRegistrationForm";

export const dynamic = "force-dynamic";

export default async function NewLegalRegistrationPage() {
  const session = await requireSession();
  requireCap(session.roles, "compliance.edit", session.permissions);

  // Seed "Registered in name of" with the tenant display name so the
  // common case is one click.
  const tenant = await withTenant(session.tenantId, async (tx) => {
    return (
      await tx
        .select({ displayName: tenants.displayName, legalName: tenants.legalName })
        .from(tenants)
        .where(eq(tenants.id, session.tenantId))
        .limit(1)
    )[0];
  });

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <Link
          href="/dashboard/legal-registrations"
          className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
        >
          <ChevronLeft className="size-3" /> Legal registrations
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Add a registration</h1>
      </div>
      <LegalRegistrationForm
        mode="create"
        defaultRegisteredInNameOf={tenant?.displayName ?? tenant?.legalName ?? ""}
      />
    </div>
  );
}
