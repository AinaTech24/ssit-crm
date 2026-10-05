import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { amcEmpanelments } from "@/db/schema";
import { AmcEmpanelmentForm } from "@/components/amc-empanelments/AmcEmpanelmentForm";
import { AmcRecords } from "@/components/amc-empanelments/AmcRecords";
import { RecordProvenance } from "@/components/common/RecordProvenance";

export const dynamic = "force-dynamic";

export default async function AmcEmpanelmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  requireAny(session.roles, ["compliance.edit", "amc_empanelment.view"], session.permissions);
  const { id } = await params;

  const row = await withTenant(session.tenantId, async (tx) => {
    const [r] = await tx
      .select()
      .from(amcEmpanelments)
      .where(eq(amcEmpanelments.id, id))
      .limit(1);
    return r;
  });
  if (!row) notFound();

  // AMC catalog for the picker — though the picker is disabled on edit
  // (you can't change the AMC code; that would orphan transactions).
  const amcs = await withTenant(session.tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT code, name FROM amc_master ORDER BY name ASC LIMIT 200
    `);
    return r.rows as Array<{ code: string; name: string }>;
  });

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <Link
          href="/dashboard/amc-empanelments"
          className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
        >
          <ChevronLeft className="size-3" /> AMC empanelments
        </Link>
        <h1 className="text-2xl font-semibold mt-1">{row.amcName}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {row.amcCode}
          {row.distributorCode && ` · Distributor: ${row.distributorCode}`} ·{" "}
          {row.status}
        </p>
        <RecordProvenance
          entityType="amc_empanelment"
          entityId={row.id}
          createdAt={row.createdAt}
          updatedAt={row.updatedAt}
          className="mt-1"
        />
      </div>
      <AmcEmpanelmentForm
        mode="edit"
        amcCatalog={amcs}
        initial={{
          id: row.id,
          amcCode: row.amcCode,
          amcName: row.amcName,
          distributorCode: row.distributorCode,
          empanelmentDate: row.empanelmentDate ? String(row.empanelmentDate) : null,
          status: row.status,
          rmName: row.rmName,
          rmEmail: row.rmEmail,
          rmPhone: row.rmPhone,
          opsName: row.opsName,
          opsEmail: row.opsEmail,
          opsPhone: row.opsPhone,
          escalationName: row.escalationName,
          escalationEmail: row.escalationEmail,
          escalationPhone: row.escalationPhone,
          additionalContacts: (row.additionalContacts ?? []) as any[],
          portalUrl: row.portalUrl,
          trailRateOverridePct:
            row.trailRateOverridePct != null
              ? Number(row.trailRateOverridePct)
              : null,
          documents: (row.documents ?? []) as any[],
          remarks: row.remarks,
          investmentPhilosophy: (row as any).investmentPhilosophy ?? null,
          fundHouseStrengths: (row as any).fundHouseStrengths ?? null,
          redFlags: (row as any).redFlags ?? null,
        }}
      />

      {/* The relationship itself — meetings held and notes kept. The form above
          is the panel STATUS; this is what has actually happened with the AMC. */}
      <AmcRecords amcId={row.id} amcName={row.amcName} />
    </div>
  );
}
