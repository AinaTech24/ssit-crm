import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/investors/export — download the (filtered) client book as an .xlsx.
 *
 * Applies the EXACT same filters as the list page via the shared
 * buildInvestorWhere helper, so the export always matches what's on screen
 * (segment / tier / status / kyc / quick-filter chips / data-gap deep-links /
 * search). Respects the tenant licence's field-gating — columns the firm
 * isn't licensed to see are omitted from the file.
 *
 * MFDs export the book constantly for RTA/AMC reconciliation, mailers and
 * offline review prep. Tenant isolation is enforced by RLS (withTenant).
 */

import { NextRequest } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { investors, users } from "@/db/schema";
import { loadTenantLicense } from "@/lib/auth/license";
import { isFieldAllowed } from "@/lib/auth/field-gate";
import { buildInvestorWhere } from "@/lib/investors/list-filters";
import { investorScopeCondition } from "@/lib/investors/access";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const MAX_ROWS = 5000;

function ymd(v: unknown): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(v as any);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    // Bulk PII export is sensitive — caller must have investor visibility.
    // Marketing & other roles with no investor capability are blocked here; the
    // row scope below then limits an RM to their own book. (The filter helper
    // does NOT scope by role — it only translates the URL filters.)
    requireAny(
      session.roles,
      ["investor.bulk_export", "investor.view.all", "investor.view.assigned"],
      session.permissions
    );
    const license = await loadTenantLicense(session.tenantId, session.roles);

    const show = {
      pan: isFieldAllowed(license, "investor", "pan"),
      phone: isFieldAllowed(license, "investor", "phone"),
      email: isFieldAllowed(license, "investor", "email"),
      aum: isFieldAllowed(license, "investor", "aum"),
      sip:
        isFieldAllowed(license, "investor", "active_sip_amount") ||
        isFieldAllowed(license, "investor", "sip"),
      inflow: isFieldAllowed(license, "investor", "lifetime_inflow"),
      kyc:
        isFieldAllowed(license, "investor", "kyc_status") ||
        isFieldAllowed(license, "investor", "kyc"),
      tier:
        isFieldAllowed(license, "investor", "service_tier") ||
        isFieldAllowed(license, "investor", "tier"),
      segment:
        isFieldAllowed(license, "investor", "segment_tag") ||
        isFieldAllowed(license, "investor", "segment"),
      status: isFieldAllowed(license, "investor", "status"),
      risk:
        isFieldAllowed(license, "investor", "risk_profile") ||
        isFieldAllowed(license, "investor", "risk"),
      nominee:
        isFieldAllowed(license, "investor", "nominee_name") ||
        isFieldAllowed(license, "investor", "nominee"),
    };

    // Convert the URL params into the plain object the filter helper expects.
    const sp: Record<string, string | undefined> = {};
    req.nextUrl.searchParams.forEach((v, k) => {
      sp[k] = v;
    });

    const rows = await withTenant(
      session.tenantId,
      async (tx) => {
        const scope = await investorScopeCondition(tx, session);
        const filters = buildInvestorWhere(sp, session.userId);
        const where = scope ? and(filters as any, scope) : filters;
        const r = await tx
          .select({ inv: investors, rmName: users.name })
          .from(investors)
          .leftJoin(users, eq(users.id, investors.rmId))
          .where(where as any)
          .orderBy(desc(investors.aum))
          .limit(MAX_ROWS);
        // DPDP: bulk PII reads must leave an access trail (which sensitive
        // fields, how many records, under what filter).
        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "investor.bulk_export",
          entityType: "investor",
          entityId: session.tenantId,
          piiAccessed: { pan: show.pan, phone: show.phone, email: show.email } as any,
          after: { count: r.length, filters: sp } as any,
          ...clientMetaFromHeaders(req.headers),
        });
        return r;
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    // Build gated, human-friendly rows for the sheet.
    const data = rows.map(({ inv, rmName }) => {
      const addr = (inv.address as any) ?? {};
      const row: Record<string, any> = { Name: inv.name };
      if (show.pan) row["PAN"] = inv.pan ?? "";
      // Name-as-per-PAN and DOB are identity PII in the same class as the PAN —
      // gate them on the same clearance so a PAN-restricted role can't pull them
      // out the side door.
      if (show.pan) row["Name as per PAN"] = (inv as any).nameAsPerPan ?? "";
      if (show.pan) row["DOB"] = ymd((inv as any).dob);
      row["Gender"] = (inv as any).gender ?? "";
      if (show.segment) row["Segment"] = inv.segmentTag ?? "";
      if (show.tier) row["Service tier"] = inv.serviceTier ?? "";
      row["Client grade"] = (inv as any).clientCategory ?? "";
      row["Investor type"] = (inv as any).investorCategory ?? "";
      if (show.status) row["Status"] = inv.status ?? "";
      // ── KYC / compliance ──
      if (show.kyc) row["KYC"] = inv.kycStatus ?? "";
      row["PAN–Aadhaar link"] = (inv as any).panAadhaarLinkStatus ?? "";
      row["Residency"] = (inv as any).residencyStatus ?? "";
      // CKYC number is a government KYC identifier — PII-class, gate on pan.
      if (show.pan) row["CKYC number"] = (inv as any).ckycNumber ?? "";
      if (show.pan) row["CKYC expiry"] = ymd((inv as any).ckycExpiryAt);
      row["FATCA status"] = (inv as any).fatcaStatus ?? "";
      row["FATCA expiry"] = ymd((inv as any).fatcaExpiryAt);
      if (show.risk) row["Risk profile"] = inv.riskProfile ?? "";
      row["Risk score"] = (inv as any).riskProfileScore ?? "";
      // ── Nominee ──
      if (show.nominee) row["Nominee"] = inv.nomineeName ?? "";
      if (show.nominee) row["Nominee relation"] = (inv as any).nomineeRelation ?? "";
      if (show.nominee) row["Nominee DOB"] = ymd((inv as any).nomineeDob);
      // ── Money ──
      if (show.aum) row["AUM (INR)"] = Number(inv.aum ?? 0);
      if (show.sip) row["Monthly SIP (INR)"] = Number(inv.activeSipAmount ?? 0);
      if (show.inflow) row["Lifetime inflow (INR)"] = Number(inv.lifetimeInflow ?? 0);
      if (show.inflow) row["Lifetime outflow (INR)"] = Number((inv as any).lifetimeOutflow ?? 0);
      row["Health score"] = (inv as any).healthScore ?? "";
      row["Health band"] = (inv as any).healthBand ?? "";
      row["RM"] = rmName ?? "";
      // ── Contact ──
      if (show.phone) row["Phone"] = inv.phone ?? "";
      if (show.phone) row["Alt mobile"] = (inv as any).alternatePhone ?? "";
      if (show.phone) row["WhatsApp"] = (inv as any).whatsappPhone ?? "";
      if (show.email) row["Email"] = inv.email ?? "";
      row["Language"] = (inv as any).languagePref ?? "";
      // ── Address ──
      row["Address"] = addr.line1 ?? "";
      row["City"] = addr.city ?? "";
      row["State"] = addr.state ?? "";
      row["Pincode"] = addr.pincode ?? "";
      // ── Profile / trading ──
      row["Occupation"] = (inv as any).occupation ?? "";
      row["Income range"] = (inv as any).incomeRange ?? "";
      row["Employer"] = (inv as any).employerName ?? "";
      row["BSE UCC"] = (inv as any).bseUccCode ?? "";
      row["NSE CAN"] = (inv as any).nseCanCode ?? "";
      row["Mandate status"] = (inv as any).mandateStatus ?? "";
      // ── Bank ── (financial PII — gate on the same clearance as PAN)
      if (show.pan) row["Bank name"] = (inv as any).bankName ?? "";
      if (show.pan) row["Bank A/c (masked)"] = (inv as any).bankAccountNumberMasked ?? "";
      if (show.pan) row["Bank IFSC"] = (inv as any).bankIfsc ?? "";
      // ── Dates ──
      row["Last review"] = ymd(inv.lastReviewAt);
      row["Next review"] = ymd(inv.nextReviewAt);
      row["Last transaction"] = ymd(inv.lastTransactionAt);
      row["Last contact"] = ymd((inv as any).lastContactAt);
      row["Client since"] = ymd(inv.onboardedAt);
      row["Tags"] = Array.isArray((inv as any).tags) ? (inv as any).tags.join(", ") : "";
      row["Notes"] = (inv as any).notes ?? "";
      return row;
    });

    // Always emit at least a header row so an empty filter still downloads a
    // valid file rather than a confusing blank.
    const ws = XLSX.utils.json_to_sheet(
      data.length ? data : [{ Name: "(no clients match the current filters)" }]
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Investors");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="investors-${stamp}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
