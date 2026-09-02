/**
 * GET /api/reports/data-hygiene
 *
 * Quick data-quality scan across the tenant's investor master. Returns
 * counts of clients missing each critical field — drives the "Data gaps"
 * tile on the Owner Cockpit and powers the deep-link to the filtered
 * Clients list where the user can bulk-fix.
 *
 * Cheap query: one SELECT with COUNT(*) FILTER (...) — single index
 * scan on investors(tenant_id, status). Tested fine to 100K clients.
 *
 * Each gap row has:
 *   - key   — machine identifier
 *   - label — human label
 *   - count — number of investors missing this field
 *   - href  — link to the Clients list pre-filtered to the bad rows
 *   - severity — "high" if compliance-relevant (PAN, KYC), else "medium"
 */

import { handleApiError } from "@/lib/api/error-handler";
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["reports.business", "reports.manage"], session.permissions);
    const rows = await withTenant(session.tenantId, async (tx) => {
      // One round-trip — Postgres aggregates with FILTER are very cheap
      // on an indexed table even at 5M clients.
      const r = await tx.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE pan IS NULL OR pan = '')             AS pan_missing,
          COUNT(*) FILTER (WHERE phone IS NULL OR phone = '')         AS phone_missing,
          COUNT(*) FILTER (WHERE email IS NULL OR email = '')         AS email_missing,
          COUNT(*) FILTER (WHERE dob IS NULL)                         AS dob_missing,
          COUNT(*) FILTER (WHERE nominee_name IS NULL
                              OR nominee_name = '')                   AS nominee_missing,
          COUNT(*) FILTER (WHERE bank_account_masked IS NULL
                              OR bank_account_masked = '')            AS bank_missing,
          COUNT(*) FILTER (WHERE risk_profile IS NULL
                              OR risk_profile_signed_at IS NULL)      AS risk_missing,
          COUNT(*) FILTER (WHERE kyc_status != 'verified')             AS kyc_unverified,
          COUNT(*) FILTER (WHERE rm_id IS NULL)                       AS rm_missing,
          COUNT(*) FILTER (WHERE pan_aadhaar_link_status = 'not_linked' OR pan_aadhaar_link_status IS NULL) AS pan_aadhaar_unlinked,
          COUNT(*)                                                    AS total
        FROM investors
        WHERE status IN ('active', 'dormant') AND deleted_at IS NULL
      `);
      return r.rows[0] as any;
    });

    const total = Number(rows?.total ?? 0);
    const cap = (n: any) => Number(n ?? 0);
    const gaps = [
      {
        key: "pan",
        label: "Missing PAN",
        count: cap(rows.pan_missing),
        href: "/dashboard/investors?gaps=pan",
        severity: "high",
      },
      {
        key: "pan_aadhaar",
        label: "PAN-Aadhaar unlinked",
        count: cap(rows.pan_aadhaar_unlinked),
        href: "/dashboard/investors?gaps=pan_aadhaar",
        severity: "high",
      },
      {
        key: "phone",
        label: "Missing phone",
        count: cap(rows.phone_missing),
        href: "/dashboard/investors?gaps=phone",
        severity: "medium",
      },
      {
        key: "email",
        label: "Missing email",
        count: cap(rows.email_missing),
        href: "/dashboard/investors?gaps=email",
        severity: "medium",
      },
      {
        key: "dob",
        label: "Missing DOB",
        count: cap(rows.dob_missing),
        href: "/dashboard/investors?gaps=dob",
        severity: "high",
      },
      {
        key: "nominee",
        label: "No nominee",
        count: cap(rows.nominee_missing),
        href: "/dashboard/investors?gaps=nominee",
        severity: "high",
      },
      {
        key: "bank",
        label: "No bank on file",
        count: cap(rows.bank_missing),
        href: "/dashboard/investors?gaps=bank",
        severity: "medium",
      },
      {
        key: "risk_profile",
        label: "No risk profile",
        count: cap(rows.risk_missing),
        href: "/dashboard/investors?gaps=risk_profile",
        severity: "high",
      },
      {
        key: "kyc",
        label: "KYC not verified",
        count: cap(rows.kyc_unverified),
        href: "/dashboard/investors?kyc=pending,expired,not_started",
        severity: "high",
      },
      {
        key: "rm",
        label: "Unassigned (no RM)",
        count: cap(rows.rm_missing),
        href: "/dashboard/investors?gaps=rm",
        severity: "medium",
      },
    ].filter((g) => g.count > 0);

    return NextResponse.json({ total, gaps });
  } catch (err: any) {
    return handleApiError(err);
  }
}
