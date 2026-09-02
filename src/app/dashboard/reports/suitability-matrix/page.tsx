/**
 * MF Suitability Matrix — Network FP "3.2" parity.
 *
 * The 9-cell grid (Risk × Horizon) the IC fills with recommended
 * categories. Used as the seed for proposal generation: when an RM
 * picks a client, the matching cell determines the starting allocation.
 *
 * Print-friendly so the IC can wall-mount the current matrix.
 */

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { suitabilityMatrixEntries } from "@/db/schema";
import { SuitabilityMatrixEditor } from "@/components/reports/SuitabilityMatrixEditor";

export const dynamic = "force-dynamic";

export default async function SuitabilityMatrixPage() {
  const session = await requireSession();
  requireCap(session.roles, "compliance.edit", session.permissions);
  await assertActiveLicense(session.tenantId, session.roles);

  const rows = await withTenant(session.tenantId, async (tx) => {
    return tx
      .select()
      .from(suitabilityMatrixEntries)
      .where(eq(suitabilityMatrixEntries.tenantId, session.tenantId));
  });

  const serialised = rows.map((r) => ({
    id: r.id,
    riskProfile: r.riskProfile,
    timeHorizon: r.timeHorizon,
    coarseCategories: (r.coarseCategories ?? []) as string[],
    allocationHints: (r.allocationHints ?? null) as Record<string, number> | null,
    notes: r.notes,
    updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
  }));

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          <Link
            href="/dashboard/reports"
            className="hover:underline inline-flex items-center gap-1"
          >
            <ChevronLeft className="size-3" /> Reports
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">MF suitability matrix</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Investment-committee 3×3 grid mapping client risk profile and
          time horizon to recommended scheme categories. Each cell's
          coarse categories feed proposal generation when matched to a
          client.
        </p>
      </div>

      <SuitabilityMatrixEditor initialEntries={serialised} />
    </div>
  );
}
