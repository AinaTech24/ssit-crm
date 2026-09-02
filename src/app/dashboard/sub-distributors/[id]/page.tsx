import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { subDistributors } from "@/db/schema";
import { SubDistributorForm } from "@/components/sub-distributors/SubDistributorForm";
import { RecordProvenance } from "@/components/common/RecordProvenance";

export const dynamic = "force-dynamic";

export default async function SubDistributorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  requireCap(session.roles, "compliance.edit", session.permissions);
  const { id } = await params;

  const row = await withTenant(session.tenantId, async (tx) => {
    const [r] = await tx
      .select()
      .from(subDistributors)
      .where(eq(subDistributors.id, id))
      .limit(1);
    return r;
  });

  if (!row) notFound();

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <Link
          href="/dashboard/sub-distributors"
          className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
        >
          <ChevronLeft className="size-3" /> Sub-distributors
        </Link>
        <h1 className="text-2xl font-semibold mt-1">{row.name}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {row.arnNumber ? `ARN ${row.arnNumber} · ` : ""}
          {row.code ? `${row.code} · ` : ""}
          {row.status}
        </p>
        <RecordProvenance
          entityType="sub_distributor"
          entityId={row.id}
          createdAt={row.createdAt}
          updatedAt={row.updatedAt}
          className="mt-1"
        />
      </div>
      <SubDistributorForm
        mode="edit"
        initial={{
          id: row.id,
          name: row.name,
          code: row.code,
          typeOfAssociation: row.typeOfAssociation,
          city: row.city,
          email: row.email,
          mobile: row.mobile,
          panNumber: row.panNumber,
          nismCertificateNo: row.nismCertificateNo,
          nismCategory: row.nismCategory,
          arnNumber: row.arnNumber,
          euin: row.euin,
          status: row.status,
          remarks: row.remarks,
          dscOnFile: !!row.dscOnFile,
          relationshipManagerId: row.relationshipManagerId,
          bankDetails: row.bankDetails,
          // Serialise dates so the client form gets strings
          onboardedAt: row.onboardedAt ? String(row.onboardedAt) : null,
          terminatedAt: row.terminatedAt ? String(row.terminatedAt) : null,
          nismExamDate: row.nismExamDate ? String(row.nismExamDate) : null,
          nismExpiryAt: row.nismExpiryAt ? String(row.nismExpiryAt) : null,
          arnRegistrationDate: row.arnRegistrationDate
            ? String(row.arnRegistrationDate)
            : null,
          arnExpiryAt: row.arnExpiryAt ? String(row.arnExpiryAt) : null,
          euinExpiryAt: row.euinExpiryAt ? String(row.euinExpiryAt) : null,
          commissionSplitPct:
            row.commissionSplitPct != null
              ? Number(row.commissionSplitPct)
              : null,
        }}
      />
    </div>
  );
}
