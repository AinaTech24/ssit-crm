import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/insurance/import/commit — write parsed policy rows into the
 * insurance register (Zoho File Import parity). Each policy is linked to an
 * existing client by PAN; rows with no matching client error out. Policy type
 * + premium frequency are normalised to our enums; dedupe is by policy number.
 *
 * Body: { mapping: Record<sourceHeader, ourField>, rows: object[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const Body = z.object({ mapping: z.record(z.string(), z.string()), rows: z.array(z.record(z.string(), z.any())) });

const POLICY_TYPES = ["term", "ulip", "endowment", "money_back", "health", "critical_illness", "personal_accident", "motor", "travel", "home", "life_other", "general_other"];
const FREQS = ["single", "annual", "semi_annual", "quarterly", "monthly"];

function normType(v: string): string {
  const s = v.toLowerCase().trim();
  if (POLICY_TYPES.includes(s)) return s;
  if (/term/.test(s)) return "term";
  if (/ulip|unit.?linked/.test(s)) return "ulip";
  if (/endow/.test(s)) return "endowment";
  if (/money.?back/.test(s)) return "money_back";
  if (/health|mediclaim/.test(s)) return "health";
  if (/critical/.test(s)) return "critical_illness";
  if (/accident|personal.?acc|pa\b/.test(s)) return "personal_accident";
  if (/motor|car|vehicle|two.?wheeler/.test(s)) return "motor";
  if (/travel/.test(s)) return "travel";
  if (/home|property|fire/.test(s)) return "home";
  if (/life/.test(s)) return "life_other";
  return s ? "general_other" : "life_other";
}
function normFreq(v: string): string {
  const s = v.toLowerCase().trim();
  if (FREQS.includes(s)) return s;
  if (/single|one.?time|lump/.test(s)) return "single";
  if (/annual|yearly|year|annum/.test(s)) return "annual";
  if (/semi|half/.test(s)) return "semi_annual";
  if (/quarter/.test(s)) return "quarterly";
  if (/month/.test(s)) return "monthly";
  return "annual";
}
const STATUSES = ["proposed", "in_underwriting", "active", "lapsed", "matured", "surrendered", "cancelled"];
const numOrNull = (v: string) => { const n = Number(String(v).replace(/[,₹\s]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };
const intOrNull = (v: string) => { const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10); return Number.isFinite(n) ? n : null; };
function normStatus(v: string): string {
  const s = v.toLowerCase().trim().replace(/\s+/g, "_");
  return STATUSES.includes(s) ? s : "active";
}
/** Lenient date parse → YYYY-MM-DD (handles DD-MM-YYYY, DD/MM/YYYY, Excel serial, ISO). */
function dateOrNull(v: string): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^\d{4,6}$/.test(s)) {
    const serial = parseInt(s, 10);
    if (serial > 0 && serial < 100000) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }
  const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    let day = +m[1]; let mon = +m[2]; let year = +m[3];
    if (year < 100) year += year < 50 ? 2000 : 1900;
    if (mon > 12 && day <= 12) { const t = day; day = mon; mon = t; }
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
      const d = new Date(Date.UTC(year, mon - 1, day));
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    return null;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
const pick = (row: Record<string, any>, h: string | undefined) => (h && row[h] != null ? String(row[h]).trim() : "");

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "insurance.write", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const meta = clientMetaFromHeaders(req.headers);
    const { mapping, rows } = parse.data;

    const reverse: Record<string, string> = {};
    for (const [src, our] of Object.entries(mapping)) if (our) reverse[our] = src;
    if (!reverse.clientPan || !reverse.insurer || !reverse.planName) {
      return NextResponse.json({ error: "mapping must cover client PAN, insurer, and plan name" }, { status: 400 });
    }

    let inserted = 0, skipped = 0;
    const errors: Array<{ rowIndex: number; error: string }> = [];

    await withTenant(session.tenantId, async (tx) => {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const pan = pick(row, reverse.clientPan).toUpperCase();
        const insurer = pick(row, reverse.insurer);
        const planName = pick(row, reverse.planName);
        if (!pan || !insurer || !planName) { errors.push({ rowIndex: i, error: "missing PAN, insurer, or plan" }); continue; }

        const inv = (await tx.execute(sql`SELECT id FROM investors WHERE tenant_id = ${session.tenantId}::uuid AND pan = ${pan} LIMIT 1`)).rows[0] as any;
        if (!inv) { errors.push({ rowIndex: i, error: `no client with PAN ${pan}` }); continue; }

        const policyNumber = pick(row, reverse.policyNumber) || null;
        if (policyNumber) {
          const dup = (await tx.execute(sql`SELECT 1 FROM insurance_policies WHERE tenant_id = ${session.tenantId}::uuid AND policy_number = ${policyNumber} LIMIT 1`)).rows[0];
          if (dup) { skipped++; continue; }
        }

        // Category-specific + cross-category extras land in the details JSONB.
        const detailKeys = [
          "businessType", "proposerName", "proposerPan", "vehicleRegNo", "makeModel",
          "ncbPercent", "coverType", "roomRentCapInr", "coPayPercent", "preExistingWaitingMonths", "coverageNotes",
          // Policyholder & address
          "holderName", "customerId", "uin", "email", "mobile",
          "addressLine1", "city", "state", "postalCode", "country",
          // Agency
          "agencyCode", "agencyName", "agencyContact", "agencyEmail",
          "agentName", "agentEmail", "agentPhone",
          // Receipt / payment / tax
          "receiptNo", "receiptDate", "businessChannel", "paymentDetails",
          "taxInvoiceNo", "taxInvoiceDate", "gstin", "receiptPan", "financialYear", "eightyDAmount", "grossPremium",
          // Proposer extras
          "proposerStatus", "proposerCustomerId", "proposerPhone", "proposerEmail",
          "proposerAddressLine1", "proposerCity", "proposerState", "proposerPostalCode",
          "proposerCountry", "proposerRemarks",
          // Schedule + nominee extras
          "policyIssueDate", "nomineeDob", "nomineeEmail",
        ];
        // Date-ish detail fields are normalised to YYYY-MM-DD so the form's date
        // pickers render them.
        const DATE_DETAILS = new Set(["receiptDate", "taxInvoiceDate", "policyIssueDate", "nomineeDob"]);
        const details: Record<string, any> = {};
        for (const k of detailKeys) {
          const v = pick(row, reverse[k]);
          if (v) details[k] = DATE_DETAILS.has(k) ? (dateOrNull(v) ?? v) : v;
        }
        if (!details.country && (details.addressLine1 || details.city)) details.country = "India";

        // Build the nominees array (one nominee per flat row) so imported
        // policies render in the add-form's multi-nominee table.
        const nomName = pick(row, reverse.nomineeName);
        if (nomName) {
          details.nominees = [{
            name: nomName,
            relation: pick(row, reverse.nomineeRelation) || "",
            share: pick(row, reverse.nomineeShare) || "100",
            dob: dateOrNull(pick(row, reverse.nomineeDob)) ?? pick(row, reverse.nomineeDob) ?? "",
            email: pick(row, reverse.nomineeEmail) || "",
          }];
        }

        try {
          await tx.execute(sql`
            INSERT INTO insurance_policies (
              id, tenant_id, branch_id, investor_id, policy_number, insurer, plan_name, policy_type,
              sum_assured, annual_premium, commission_paisa, premium_frequency,
              premium_paying_term_years, policy_term_years, lives_covered,
              policy_start_date, maturity_date, next_premium_due_date,
              nominee_name, nominee_relation, nominee_share, remarks, details,
              status, sold_by_user_id, sold_at, created_at, updated_at
            ) VALUES (
              ${uuid()}, ${session.tenantId}, ${session.branchId ?? null}, ${inv.id}::uuid, ${policyNumber}, ${insurer}, ${planName},
              ${normType(pick(row, reverse.policyType))},
              ${numOrNull(pick(row, reverse.sumAssured))}, ${numOrNull(pick(row, reverse.annualPremium))}, ${numOrNull(pick(row, reverse.commission))},
              ${normFreq(pick(row, reverse.premiumFrequency))},
              ${intOrNull(pick(row, reverse.premiumPayingTermYears))}, ${intOrNull(pick(row, reverse.policyTermYears))}, ${intOrNull(pick(row, reverse.livesCovered)) ?? 1},
              ${dateOrNull(pick(row, reverse.policyStartDate))}, ${dateOrNull(pick(row, reverse.maturityDate))}, ${dateOrNull(pick(row, reverse.nextPremiumDueDate))},
              ${pick(row, reverse.nomineeName) || null}, ${pick(row, reverse.nomineeRelation) || null}, ${intOrNull(pick(row, reverse.nomineeShare)) ?? 100},
              ${pick(row, reverse.remarks) || null}, ${JSON.stringify(details)}::jsonb,
              ${normStatus(pick(row, reverse.status))}, ${session.userId}::uuid, now(), now(), now()
            )`);
          inserted++;
        } catch (err: any) {
          errors.push({ rowIndex: i, error: String(err?.message ?? "insert failed").slice(0, 160) });
        }
      }
      await recordAudit(tx, {
        tenantId: session.tenantId, actorUserId: session.userId, action: "insurance.bulk_import",
        entityType: "insurance_policy", entityId: null,
        meta: { inserted, skipped, errored: errors.length, totalRows: rows.length }, ...meta,
      });
    });

    return NextResponse.json({ inserted, skipped, errored: errors.length, errors: errors.slice(0, 50) });
  } catch (err: any) {
    return handleApiError(err);
  }
}
