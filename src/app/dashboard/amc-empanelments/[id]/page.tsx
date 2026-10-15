import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny, can } from "@/lib/auth/rbac";
import { amcEmpanelments } from "@/db/schema";
import { AmcEmpanelmentForm } from "@/components/amc-empanelments/AmcEmpanelmentForm";
import { AmcRecords } from "@/components/amc-empanelments/AmcRecords";
import { RecordProvenance } from "@/components/common/RecordProvenance";

export const dynamic = "force-dynamic";

export default async function AmcEmpanelmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requireSession();
  requireAny(session.roles, ["compliance.edit", "amc_empanelment.view", "amc_meeting.view"], session.permissions);
  // Two parts: the AMC's details (contacts, status, documents) and the AMC's
  // meetings (what has actually happened). Each has its own audience.
  const canDetails =
    can(session.roles, "compliance.edit", session.permissions) ||
    can(session.roles, "amc_empanelment.view", session.permissions);
  const canMeetings = can(session.roles, "amc_meeting.view", session.permissions);
  const sp = await searchParams;
  const tab: "details" | "meetings" =
    sp.tab === "meetings" && canMeetings ? "meetings" : canDetails ? "details" : "meetings";
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
      SELECT code, name FROM amc_master WHERE COALESCE(is_active, true) = true ORDER BY name ASC LIMIT 200
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
      <div className="flex gap-1 border-b">
        {canDetails && (
          <Link
            href={`/dashboard/amc-empanelments/${row.id}`}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${tab === "details" ? "border-brand-cyan-deep text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            AMC details
          </Link>
        )}
        {canMeetings && (
          <Link
            href={`/dashboard/amc-empanelments/${row.id}?tab=meetings`}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${tab === "meetings" ? "border-brand-cyan-deep text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            AMC meetings
          </Link>
        )}
      </div>

      {tab === "details" && canDetails && (
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
          billingName: row.billingName,
          billingEmail: row.billingEmail,
          billingPhone: row.billingPhone,
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
      )}

      {/* The relationship itself — meetings held and notes kept. The form above
          is the panel STATUS; this is what has actually happened with the AMC. */}
      {tab === "meetings" && canMeetings && <AmcRecords amcId={row.id} amcName={row.amcName} />}
    </div>
  );
}
