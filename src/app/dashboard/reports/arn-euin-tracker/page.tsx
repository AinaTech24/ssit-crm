/**
 * ARN / EUIN / NISM / DSC compliance tracker.
 *
 * Direct parity with the Network FP "1.1 ARN/EUIN Details & Tracker"
 * Excel template — but live, sortable, and colour-coded by expiry
 * window so the owner can act on it without scanning rows.
 *
 * Surface:
 *   - One row per active or offboarding user
 *   - Columns: code, name, distributing AMCs, NISM (cert + exam + expiry),
 *     ARN (personal + dates), EUIN (number + expiry), DSC (submitted + last + expiry)
 *   - Colour band on each expiry: green > 90d, amber 30-90d, rose < 30d,
 *     gray = no data
 *   - Top filter chips for "expiring in next N days"
 *   - Export to CSV via existing ReportExportButtons
 *
 * Why not reuse the generic /dashboard/reports/[key] runner? Two reasons:
 *   1. The traffic-light colouring needs per-column expiry math the
 *      generic table doesn't support.
 *   2. The grouping (NISM block, ARN block, DSC block) is visually
 *      tightly arranged for MFD comprehension, not a flat table.
 */

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { and, inArray, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { users, complianceDocuments } from "@/db/schema";
import { ArnEuinTrackerClient } from "@/components/reports/ArnEuinTrackerClient";

export const dynamic = "force-dynamic";

export default async function ArnEuinTrackerPage({
  searchParams,
}: {
  searchParams: Promise<{ within?: string }>;
}) {
  const session = await requireSession();
  // Owner / compliance only — this is sensitive licensing data.
  requireCap(session.roles, "compliance.edit", session.permissions);
  await assertActiveLicense(session.tenantId, session.roles);
  const sp = await searchParams;
  const within = sp.within ? Math.max(0, parseInt(sp.within, 10) || 0) : null;

  const data = await withTenant(session.tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        employeeCode: users.employeeCode,
        roles: users.roles,
        department: users.department,
        status: users.status,
        joiningDate: users.joiningDate,
        distributingAmcs: users.distributingAmcs,
        // NISM
        nismCertificateNo: users.nismCertificateNo,
        nismExamDate: users.nismExamDate,
        nismExpiryAt: users.nismExpiryAt,
        nismCategory: users.nismCategory,
        // ARN
        personalArn: users.personalArn,
        arnRegistrationDate: users.arnRegistrationDate,
        arnExpiryAt: users.arnExpiryAt,
        // EUIN
        euin: users.euin,
        euinExpiryAt: users.euinExpiryAt,
        // DSC
        dscSubmitted: users.dscSubmitted,
        dscLastSubmittedAt: users.dscLastSubmittedAt,
        dscExpiryAt: users.dscExpiryAt,
      })
      .from(users)
      .where(
        and(
          eq(users.tenantId, session.tenantId),
          inArray(users.status, ["active", "offboarding"])
        )
      );

    const userDocs = await tx
      .select({
        id: complianceDocuments.id,
        relatedEntityId: complianceDocuments.relatedEntityId,
        category: complianceDocuments.category,
        name: complianceDocuments.name,
      })
      .from(complianceDocuments)
      .where(
        and(
          eq(complianceDocuments.tenantId, session.tenantId),
          eq(complianceDocuments.relatedEntityType, "user")
        )
      );

    return { rows, userDocs };
  });

  // Serialise dates to strings to avoid client-component issues.
  const serialised = data.rows.map((r) => {
    const myDocs = data.userDocs.filter((d) => d.relatedEntityId === r.id);
    return {
      ...r,
      joiningDate: r.joiningDate ? String(r.joiningDate) : null,
      nismExamDate: r.nismExamDate ? String(r.nismExamDate) : null,
      nismExpiryAt: r.nismExpiryAt ? String(r.nismExpiryAt) : null,
      arnRegistrationDate: r.arnRegistrationDate
        ? String(r.arnRegistrationDate)
        : null,
      arnExpiryAt: r.arnExpiryAt ? String(r.arnExpiryAt) : null,
      euinExpiryAt: r.euinExpiryAt ? String(r.euinExpiryAt) : null,
      dscLastSubmittedAt: r.dscLastSubmittedAt
        ? String(r.dscLastSubmittedAt)
        : null,
      dscExpiryAt: r.dscExpiryAt ? String(r.dscExpiryAt) : null,
      distributingAmcs: (r.distributingAmcs ?? []) as string[],
      docs: myDocs,
    };
  });

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
        <h1 className="text-2xl font-semibold">ARN / EUIN / NISM / DSC tracker</h1>
        <p className="text-sm text-muted-foreground mt-1">
          One row per team member with all licensing fields. Tap any row to
          jump to the employee detail page to update. Use the chips below to
          filter by what's expiring soon.
        </p>
      </div>

      <ArnEuinTrackerClient initialRows={serialised} initialWithin={within} />
    </div>
  );
}
