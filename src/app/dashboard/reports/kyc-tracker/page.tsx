/**
 * KYC Tracker — Network FP "2.4 Client Database / KYC Tracker" parity.
 *
 * One row per active investor with KYC status, PAN-Aadhaar link,
 * residency, validation date, and the user who last updated. Sortable
 * + filterable + CSV-exportable. The same operational view MFD
 * compliance opens during a SEBI inspection.
 */

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { and, eq, inArray, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { investors, users } from "@/db/schema";
import { KycTrackerClient } from "@/components/reports/KycTrackerClient";

export const dynamic = "force-dynamic";

export default async function KycTrackerPage() {
  const session = await requireSession();
  requireCap(session.roles, "compliance.edit", session.permissions);
  await assertActiveLicense(session.tenantId, session.roles);

  const rows = await withTenant(session.tenantId, async (tx) => {
    return tx
      .select({
        id: investors.id,
        name: investors.name,
        nameAsPerPan: investors.nameAsPerPan,
        pan: investors.pan,
        email: investors.email,
        phone: investors.phone,
        kycStatus: investors.kycStatus,
        panAadhaarLinkStatus: investors.panAadhaarLinkStatus,
        residencyStatus: investors.residencyStatus,
        investorCategory: investors.investorCategory,
        aadhaarLast4: investors.aadhaarLast4,
        kycValidatedAt: investors.kycValidatedAt,
        ckycNumber: investors.ckycNumber,
        ckycExpiryAt: investors.ckycExpiryAt,
        // AMFI DDQ 4.11c / 4.13 — UBO + In-Person Verification.
        uboStatus: investors.uboStatus,
        ipvStatus: investors.ipvStatus,
        ipvDate: investors.ipvDate,
        kycLastUpdatedBy: investors.kycLastUpdatedBy,
        rmId: investors.rmId,
        status: investors.status,
        notes: investors.notes,
        updatedAt: investors.updatedAt,
      })
      .from(investors)
      .where(
        and(
          eq(investors.tenantId, session.tenantId),
          eq(investors.status, "active")
        )
      )
      .orderBy(investors.name);
  });

  // Resolve user names for "Updated By" + RM
  const userIds = new Set<string>();
  for (const r of rows) {
    if (r.kycLastUpdatedBy) userIds.add(r.kycLastUpdatedBy);
    if (r.rmId) userIds.add(r.rmId);
  }
  const userMap = await withTenant(session.tenantId, async (tx) => {
    const m = new Map<string, string>();
    if (userIds.size > 0) {
      const us = await tx
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, [...userIds]));
      for (const u of us) m.set(u.id, u.name);
    }
    return m;
  });

  // Summary counts
  const summary = await withTenant(session.tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE kyc_status = 'verified')::int AS validated,
        COUNT(*) FILTER (WHERE kyc_status = 'registered')::int AS registered,
        COUNT(*) FILTER (WHERE kyc_status IN ('pending', 'hold', 're_kyc_required'))::int AS pending,
        COUNT(*) FILTER (WHERE kyc_status IN ('rejected', 'expired'))::int AS blocked,
        COUNT(*) FILTER (WHERE pan_aadhaar_link_status = 'linked')::int AS pan_aadhaar_linked,
        COUNT(*) FILTER (WHERE pan_aadhaar_link_status IS NULL OR pan_aadhaar_link_status = 'pending')::int AS pan_aadhaar_unknown,
        COUNT(*) FILTER (WHERE pan_aadhaar_link_status = 'not_linked')::int AS pan_aadhaar_not_linked,
        -- DDQ 4.11c / 4.13 — the questionnaire asks these explicitly.
        COUNT(*) FILTER (WHERE ubo_status IS NULL OR ubo_status = 'pending')::int AS ubo_pending,
        COUNT(*) FILTER (WHERE ipv_status IS NULL OR ipv_status = 'pending')::int AS ipv_pending
      FROM investors
      WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
    `);
    return r.rows[0] as Record<string, number>;
  });

  const serialised = rows.map((r) => ({
    ...r,
    kycValidatedAt: r.kycValidatedAt ? String(r.kycValidatedAt) : null,
    ckycExpiryAt: r.ckycExpiryAt ? String(r.ckycExpiryAt) : null,
    updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
    kycLastUpdatedByName: r.kycLastUpdatedBy
      ? userMap.get(r.kycLastUpdatedBy) ?? null
      : null,
    rmName: r.rmId ? userMap.get(r.rmId) ?? null : null,
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
        <h1 className="text-2xl font-semibold">KYC tracker</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Active client KYC status at a glance — validation state,
          PAN-Aadhaar link, residency, CKYC expiry. Click any name to
          update.
        </p>
      </div>

      <KycTrackerClient initialRows={serialised} summary={summary} />
    </div>
  );
}
