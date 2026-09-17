import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/investors/import/commit
 * Body: {
 *   mapping: Record<sourceHeader, ourField>,
 *   rows: object[],
 *   mode: "add" | "update" | "both",
 *   matchBy: "none" | "clientId" | "email" | "phone" | "pan",
 *   dontUpdateEmpty: boolean
 * }
 *
 * Three processing modes (mirrors the Zoho-style import the UI offers):
 *
 *   add    — insert every row as a NEW client. If `matchBy` is not "none", a row
 *            whose match-key already exists (or already appeared earlier in the
 *            file) is SKIPPED instead of inserted. This is the "Skip duplicates
 *            based on Email/Phone/PAN" option.
 *   update — find an EXISTING client by `matchBy` and update only the mapped
 *            fields. Rows that don't match an existing client are skipped (never
 *            inserted). `dontUpdateEmpty` (default true) means blank cells leave
 *            the existing value untouched.
 *   both   — find existing by `matchBy`: update if found, otherwise insert as new.
 *
 * Returns counts: inserted / updated / skipped / quotaSkipped / errored,
 * with per-row errors.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny, can } from "@/lib/auth/rbac";
import { assertActiveLicense, loadTenantLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { healthFields } from "@/lib/investors/health";
import { parseUccCell } from "@/lib/investors/ucc";
import { loadCustomFieldDefs, sanitizeCustomFields } from "@/lib/custom-fields/values";
import { applyRiskCategory, normalizeRiskCategory } from "@/lib/risk-profile/apply";
import { investors } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  mapping: z.record(z.string(), z.string()),
  // Cap the payload: the whole import runs in one transaction inserting row by
  // row, so an unbounded array would hold a write lock + memory for minutes.
  // 10k/upload is comfortably above a normal MFD book migration; larger books
  // should be split (a background-job importer is the longer-term fix).
  rows: z.array(z.record(z.string(), z.any())).max(10000),
  mode: z.enum(["add", "update", "both"]).default("add"),
  matchBy: z.enum(["none", "clientId", "email", "phone", "pan"]).default("none"),
  dontUpdateEmpty: z.boolean().default(true),
});

/** The match key → the column on `investors` it resolves against, and the
 *  mapping field the source column is read from. */
const MATCH_FIELD: Record<"clientId" | "email" | "phone" | "pan", string> = {
  clientId: "clientId",
  email: "email",
  phone: "phone",
  pan: "pan",
};

/** Normalise a match value so trivial formatting differences still match. */
function normKey(matchBy: string, raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (matchBy === "pan") return s.toUpperCase();
  if (matchBy === "email") return s.toLowerCase();
  if (matchBy === "phone") return s.replace(/\D/g, "").slice(-10);
  return s.toLowerCase(); // clientId (uuid)
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // Same rule as the single-client create: an RM may import into their own
    // book. Updates to someone else's client are refused per row below.
    requireAny(session.roles, ["investor.edit.all", "investor.edit.assigned"], session.permissions);
    const editsAll = can(session.roles, "investor.edit.all", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);

    const { mapping, rows, mode, matchBy, dontUpdateEmpty } = parse.data;

    // Build the reverse map: ourField -> sourceHeader
    const reverse: Record<string, string> = {};
    for (const [src, our] of Object.entries(mapping)) {
      if (our) reverse[our] = src;
    }
    // Permissive import: a client row only needs ONE identifying field mapped.
    // PAN is frequently absent in a freshly-migrated book, so we no longer force
    // it — rows without a PAN get a clearly-marked placeholder (filled in later).
    if (!reverse.name && !reverse.pan && !reverse.email && !reverse.phone) {
      return NextResponse.json(
        { error: "map at least one identifying column: Name, PAN, Email or Mobile" },
        { status: 400 }
      );
    }

    // Update / Both REQUIRE a match key, and the column that key reads from must
    // be mapped (otherwise there's nothing to match existing clients on).
    const needsMatch = mode === "update" || mode === "both";
    if (needsMatch && matchBy === "none") {
      return NextResponse.json(
        { error: "choose how to find existing clients (Client ID, Email, PAN or Mobile)" },
        { status: 400 }
      );
    }
    if (matchBy !== "none") {
      const matchCol = reverse[MATCH_FIELD[matchBy]];
      if (!matchCol) {
        const label =
          matchBy === "clientId" ? "Client ID" : matchBy === "pan" ? "PAN" : matchBy === "phone" ? "Mobile" : "Email";
        return NextResponse.json(
          { error: `map a column to ${label} — that's the field used to match existing clients` },
          { status: 400 }
        );
      }
    }
    const matchCol = matchBy !== "none" ? reverse[MATCH_FIELD[matchBy]] : undefined;

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let quotaSkipped = 0;
    const errors: Array<{ rowIndex: number; error: string; pan?: string | null; name?: string }> = [];

    // Client-count caps came from the package catalogue, which no longer
    // exists — an import is never quota-skipped. `room` stays so the per-row
    // accounting below reads unchanged.
    const room = Infinity;

    await withTenant(session.tenantId, async (tx) => {
      // Firm custom-field definitions — any mapped cf_* column is sanitized + stored.
      const cfDefs = await loadCustomFieldDefs(tx, session.tenantId, "investor");

      // For update/both/skip we need to look existing clients up by the chosen
      // key. Load the lightweight identity columns (+ address & custom fields,
      // for the merge) once and index them in memory rather than querying per row.
      const keyToExisting = new Map<string, { id: string; rmId: string | null; address: any; customFields: any; riskProfile: string | null }>();
      if (matchBy !== "none") {
        const existing = await tx.execute(
          sql`SELECT id, rm_id, pan, email, phone, address, custom_fields, risk_profile FROM investors WHERE tenant_id = ${session.tenantId}::uuid`
        );
        for (const e of existing.rows as any[]) {
          const src =
            matchBy === "clientId" ? e.id : matchBy === "pan" ? e.pan : matchBy === "phone" ? e.phone : e.email;
          const k = normKey(matchBy, String(src ?? ""));
          if (k && !keyToExisting.has(k)) keyToExisting.set(k, { id: e.id, rmId: e.rm_id ?? null, address: e.address ?? {}, customFields: e.custom_fields ?? {}, riskProfile: e.risk_profile ?? null });
        }
      }

      /** Sanitized custom-field values for the current row (empty object if none). */
      const rowCustomFields = (row: Record<string, any>): Record<string, any> => {
        const raw: Record<string, any> = {};
        for (const d of cfDefs) raw[d.key] = pick(row, reverse[d.key]);
        return sanitizeCustomFields(cfDefs, raw);
      };

      // Assigned-RM resolution — a mapped "Assigned RM" cell may hold a user's
      // name, email, or id; resolve it to a real user in this tenant.
      const rmRows = (await tx.execute(
        sql`SELECT id, name, email FROM users WHERE tenant_id = ${session.tenantId}::uuid AND status <> 'offboarded'`
      )).rows as Array<{ id: string; name: string | null; email: string | null }>;
      const rmById = new Set(rmRows.map((u) => u.id));
      const rmByName = new Map<string, string>();
      const rmByEmail = new Map<string, string>();
      for (const u of rmRows) {
        if (u.name) rmByName.set(u.name.trim().toLowerCase(), u.id);
        if (u.email) rmByEmail.set(u.email.trim().toLowerCase(), u.id);
      }
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const resolveRm = (cell: string): string | null => {
        const s = (cell ?? "").trim();
        if (!s) return null;
        if (UUID_RE.test(s) && rmById.has(s)) return s;
        const lc = s.toLowerCase();
        return rmByEmail.get(lc) ?? rmByName.get(lc) ?? null;
      };

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const p = (f: string) => pick(row, reverse[f]) || null; // "" → null

        // The row's match key (if any).
        const keyRaw = matchCol ? pick(row, matchCol) : "";
        const key = keyRaw ? normKey(matchBy, keyRaw) : "";
        const existing = key ? keyToExisting.get(key) : undefined;

        // ---- Route the row to update / insert / skip per mode. ------------
        if (mode === "update") {
          if (!existing) {
            skipped++;
            continue;
          }
          if (!editsAll && existing.rmId !== session.userId) {
            errors.push({ rowIndex: i, error: "This client is assigned to another RM — you can only update your own clients." });
            continue;
          }
          try {
            await tx.transaction(async (sp) => {
              const set = buildUpdateSet(row, reverse, dontUpdateEmpty, existing.address, rowCustomFields(row), existing.customFields, reverse.rmId ? resolveRm(pick(row, reverse.rmId)) : undefined);
              if (Object.keys(set).length > 1) {
                // (>1 because updatedAt is always present)
                await sp
                  .update(investors)
                  .set(set as any)
                  .where(and(eq(investors.id, existing.id), eq(investors.tenantId, session.tenantId)));
              }
            });
            updated++;
          } catch (err: any) {
            errors.push({ rowIndex: i, error: String(err.message ?? "update failed") });
          }
          continue;
        }

        if (mode === "both" && existing) {
          if (!editsAll && existing.rmId !== session.userId) {
            errors.push({ rowIndex: i, error: "This client is assigned to another RM — you can only update your own clients." });
            continue;
          }
          try {
            await tx.transaction(async (sp) => {
              const set = buildUpdateSet(row, reverse, dontUpdateEmpty, existing.address, rowCustomFields(row), existing.customFields, reverse.rmId ? resolveRm(pick(row, reverse.rmId)) : undefined);
              if (Object.keys(set).length > 1) {
                await sp
                  .update(investors)
                  .set(set as any)
                  .where(and(eq(investors.id, existing.id), eq(investors.tenantId, session.tenantId)));
              }
              // Risk category → new risk_profile_responses record when it changed.
              const rowRisk = reverse.riskProfile ? normalizeRiskCategory(pick(row, reverse.riskProfile)) : null;
              if (rowRisk) {
                await applyRiskCategory({ tx: sp as any, tenantId: session.tenantId, investorId: existing.id, category: rowRisk, currentCategory: existing.riskProfile, createdById: session.userId });
              }
            });
            updated++;
          } catch (err: any) {
            errors.push({ rowIndex: i, error: String(err.message ?? "update failed") });
          }
          continue;
        }

        // ---- INSERT path (mode === "add", or "both" with no match). -------
        // In "add" mode with a skip key, drop rows whose key already exists
        // (in the DB or earlier in this same file).
        if (mode === "add" && matchBy !== "none" && key && existing) {
          skipped++;
          continue;
        }
        if (inserted >= room) {
          quotaSkipped++;
          continue;
        }

        // Permissive import — clients may arrive with partial data. We don't
        // reject rows for missing/invalid PAN any more; the only thing that
        // disqualifies a row is having NOTHING usable at all.
        const rawName = String(row[reverse.name] ?? "").trim();
        const rawPan = String(row[reverse.pan] ?? "").trim().toUpperCase();
        const emailEarly = p("email");
        const phoneEarly = p("phone");

        // `name` is NOT NULL. Prefer any field that actually reads like a name
        // (the mapped name, name-as-per-PAN, family head, or an email's local
        // part) over a phone/PAN — so a client is NEVER named by their mobile
        // number. Only if nothing name-like exists do we fall back to an
        // identifier.
        const nameAsPan = p("nameAsPerPan");
        const famHead = p("familyOwnerName");
        const looksName = (s: string | null) => !!s && /[A-Za-z]{2,}/.test(s) && !/^[0-9+()\s-]+$/.test(s);
        const name = humanizeName(
          [rawName, nameAsPan, famHead, emailEarly ? humanizeName(emailEarly) : ""].find((c) => looksName(c)) ||
            rawName || emailEarly || phoneEarly || rawPan || ""
        );
        if (!name) {
          errors.push({ rowIndex: i, error: "empty row — no name, PAN, email or mobile" });
          continue;
        }
        // PAN is OPTIONAL (DB column nullable, migration 0129). Keep the real
        // PAN when present; otherwise leave it BLANK (null) — never fabricate a
        // placeholder. Postgres treats NULLs as DISTINCT so the (tenant, pan)
        // unique index still allows many PAN-less clients; they just don't dedup.
        const pan = rawPan || null;

        const phone = p("phone");
        const whatsapp = p("whatsappPhone") ?? phone;
        const kycStatus = pick(row, reverse.kycStatus) || "pending";
        const nomineeName = p("nomineeName");
        const aadhaar = pick(row, reverse.aadhaarLast4).replace(/\D/g, "").slice(-4) || null;

        const h = healthFields({ status: "active", kycStatus: "pending" });

        // The mapped client profile fields.
        const core = {
          name,
          nameAsPerPan: p("nameAsPerPan"),
          email: p("email"),
          emailRelation: p("emailRelation"),
          phone,
          mobileRelation: p("mobileRelation"),
          whatsappPhone: whatsapp,
          dob: parseDate(pick(row, reverse.dob)),
          gender: coerceGender(pick(row, reverse.gender)) as any,
          birthPlace: p("birthPlace"),
          motherName: p("motherName"),
          maritalStatus: p("maritalStatus"),
          occupation: p("occupation"),
          employerName: p("employerName"),
          aadhaarLast4: aadhaar,
          address: {
            line1: pick(row, reverse.addressLine1),
            city: pick(row, reverse.city),
            state: pick(row, reverse.state),
            pincode: pick(row, reverse.pincode),
            country: pick(row, reverse.country) || "India",
          },
          investorCategory: enumize(p("investorCategory"), ["individual", "huf", "corporate", "company", "trust", "nri", "minor", "other"], "individual") as any,
          segmentTag: enumize(p("segmentTag"), ["HNI", "Affluent", "Retail", "NRI", "Corporate"], null) as any,
          clientCategory: enumize(p("clientCategory"), ["A", "B", "C", "D"], null) as any,
          householdType: p("householdType"),
          familyOwnerName: p("familyOwnerName"),
          referralClientName: p("referralClientName"),
          modeOfHolding: p("modeOfHolding"),
          bseUccCode: p("bseUccCode"),
          nseCanCode: p("nseCanCode"),
          uccCodes: parseUccCell(reverse["uccCodes"] ? pick(row, reverse["uccCodes"]) : ""),
          taxStatus: p("taxStatus"),
          residencyStatus: enumize(p("residencyStatus"), ["indian_resident", "nri", "oci", "pio", "foreign_national"], null) as any,
          kycStatus: enumize(kycStatus, ["pending", "registered", "verified", "hold", "rejected", "expired", "re_kyc_required"], "pending") as any,
          secondHolderFirstName: p("secondHolderFirstName"),
          secondHolderLastName: p("secondHolderLastName"),
          secondHolderOccupation: p("secondHolderOccupation"),
          secondHolderCompanyName: p("secondHolderCompanyName"),
          secondHolderBirthPlace: p("secondHolderBirthPlace"),
          secondHolderMotherName: p("secondHolderMotherName"),
          secondHolderMaritalStatus: p("secondHolderMaritalStatus"),
          anniversaryDate: parseDate(pick(row, reverse.anniversaryDate)),
          lastReviewAt: parseTimestamp(pick(row, reverse.lastReviewAt)),
          nextReviewAt: parseTimestamp(pick(row, reverse.nextReviewAt)),
          reviewFrequency: enumize(p("reviewFrequency"), ["monthly", "quarterly", "half_yearly", "annual"], null) as any,
          nomineeName,
          nomineeRelation: p("nomineeRelation"),
          nomineeDob: parseDate(pick(row, reverse.nomineeDob)),
          nominees: nomineeName
            ? [{ name: nomineeName, relation: pick(row, reverse.nomineeRelation) || undefined, dob: parseDate(pick(row, reverse.nomineeDob)) || undefined }]
            : [],
          bankName: p("bankName"),
          bankAccountNumberMasked: p("bankAccountNumberMasked"),
          bankIfsc: p("bankIfsc"),
          notes: p("notes"),
          aum: reverse.aum ? parseAum(pick(row, reverse.aum)) ?? "0" : "0",
        };

        try {
          // Each row in its OWN savepoint: a bad row (e.g. an odd date) rolls
          // back only itself instead of poisoning the whole transaction (which
          // previously made every later row error and discarded the good ones).
          //
          // dedupPan:false opts this row OUT of the partial PAN-unique index
          // (migration 0137), so a migrated book may carry the SAME PAN on many
          // rows — every Excel row is inserted, never skipped for a PAN clash.
          const newId = uuid();
          const cleanCf = rowCustomFields(row);
          const rowRisk = reverse.riskProfile ? normalizeRiskCategory(pick(row, reverse.riskProfile)) : null;
          await tx.transaction(async (sp) => {
            await sp.insert(investors).values({
              id: newId,
              tenantId: session.tenantId,
              branchId: session.branchId ?? null,
              pan,
              dedupPan: false,
              ...core,
              customFields: Object.keys(cleanCf).length ? cleanCf : null,
              onboardedAt: parseTimestamp(pick(row, reverse.onboardedAt)) ?? new Date(),
              rmId: (reverse.rmId ? resolveRm(pick(row, reverse.rmId)) : null) ?? session.userId,
              status: enumize(pick(row, reverse.status), ["active", "dormant", "inactive", "redemption_risk", "closed"], "active") ?? "active",
              ...h,
            } as any);
            // Risk category → create a risk_profile_responses record + cache it.
            if (rowRisk) {
              await applyRiskCategory({ tx: sp as any, tenantId: session.tenantId, investorId: newId, category: rowRisk, currentCategory: null, createdById: session.userId, signedByName: core.name });
            }
          });
          inserted++;
          // Record this row's key so a later duplicate row in the same file is
          // skipped (add mode) or updated rather than re-inserted (both mode).
          if (matchBy !== "none" && key && !keyToExisting.has(key)) {
            keyToExisting.set(key, { id: newId, rmId: session.userId, address: core.address, customFields: cleanCf, riskProfile: rowRisk });
          }
        } catch (err: any) {
          errors.push({ rowIndex: i, error: String(err.message ?? "insert failed"), pan, name });
        }
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "investor.bulk_import",
        entityType: "investor",
        entityId: null,
        meta: { mode, matchBy, inserted, updated, skipped, quotaSkipped, errored: errors.length, totalRows: rows.length },
        ...clientMeta,
      });
    });

    return NextResponse.json({
      inserted,
      updated,
      skipped,
      quotaSkipped,
      errored: errors.length,
      errors: errors.slice(0, 1000),
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}

/** Columns on `investors` that are NOT NULL — never set them to null on update. */
const NEVER_NULL = new Set(["name", "kycStatus", "investorCategory", "status"]);

/**
 * Build a partial UPDATE set from the mapped columns only. Unmapped columns are
 * left untouched. When `dontUpdateEmpty` is true, blank cells are skipped (the
 * existing value stays); when false, a blank cell clears the column (except
 * NOT-NULL columns and the address/nominee/bank groups, which are never wiped).
 */
function buildUpdateSet(
  row: Record<string, any>,
  reverse: Record<string, string>,
  dontUpdateEmpty: boolean,
  existingAddress: any,
  cleanCustomFields: Record<string, any> = {},
  existingCustomFields: any = {},
  rmResolved?: string | null
): Record<string, any> {
  const set: Record<string, any> = {};

  // Assigned RM — only when the file mapped it AND it resolved to a real user
  // (never wipe the current RM on a blank/unknown cell).
  if (rmResolved) set.rmId = rmResolved;

  const put = (col: string, val: any) => {
    const empty = val === null || val === undefined || val === "";
    if (empty) {
      if (!dontUpdateEmpty && !NEVER_NULL.has(col)) set[col] = null;
      return;
    }
    set[col] = val;
  };

  // Scalar fields: ourField -> column, with optional parser.
  const SCALARS: Array<{ field: string; col: string; parse?: (s: string) => any }> = [
    { field: "nameAsPerPan", col: "nameAsPerPan" },
    { field: "email", col: "email" },
    { field: "emailRelation", col: "emailRelation" },
    { field: "phone", col: "phone" },
    { field: "mobileRelation", col: "mobileRelation" },
    { field: "whatsappPhone", col: "whatsappPhone" },
    { field: "dob", col: "dob", parse: parseDate },
    { field: "gender", col: "gender", parse: (s) => coerceGender(s) },
    { field: "birthPlace", col: "birthPlace" },
    { field: "motherName", col: "motherName" },
    { field: "maritalStatus", col: "maritalStatus" },
    { field: "occupation", col: "occupation" },
    { field: "employerName", col: "employerName" },
    { field: "aadhaarLast4", col: "aadhaarLast4", parse: (s) => s.replace(/\D/g, "").slice(-4) || null },
    { field: "investorCategory", col: "investorCategory", parse: (s) => enumize(s, ["individual", "huf", "corporate", "company", "trust", "nri", "minor", "other"], null) },
    { field: "segmentTag", col: "segmentTag", parse: (s) => enumize(s, ["HNI", "Affluent", "Retail", "NRI", "Corporate"], null) },
    { field: "clientCategory", col: "clientCategory", parse: (s) => enumize(s, ["A", "B", "C", "D"], null) },
    { field: "householdType", col: "householdType" },
    { field: "familyOwnerName", col: "familyOwnerName" },
    { field: "referralClientName", col: "referralClientName" },
    { field: "modeOfHolding", col: "modeOfHolding" },
    { field: "bseUccCode", col: "bseUccCode" },
    { field: "nseCanCode", col: "nseCanCode" },
    { field: "uccCodes", col: "uccCodes", parse: (s) => { const a = parseUccCell(s); return a.length ? a : null; } },
    { field: "taxStatus", col: "taxStatus" },
    { field: "residencyStatus", col: "residencyStatus", parse: (s) => enumize(s, ["indian_resident", "nri", "oci", "pio", "foreign_national"], null) },
    { field: "kycStatus", col: "kycStatus", parse: (s) => enumize(s, ["pending", "registered", "verified", "hold", "rejected", "expired", "re_kyc_required"], null) },
    { field: "secondHolderFirstName", col: "secondHolderFirstName" },
    { field: "secondHolderLastName", col: "secondHolderLastName" },
    { field: "secondHolderOccupation", col: "secondHolderOccupation" },
    { field: "secondHolderCompanyName", col: "secondHolderCompanyName" },
    { field: "secondHolderBirthPlace", col: "secondHolderBirthPlace" },
    { field: "secondHolderMotherName", col: "secondHolderMotherName" },
    { field: "secondHolderMaritalStatus", col: "secondHolderMaritalStatus" },
    { field: "anniversaryDate", col: "anniversaryDate", parse: parseDate },
    { field: "onboardedAt", col: "onboardedAt", parse: parseTimestamp },
    { field: "lastReviewAt", col: "lastReviewAt", parse: parseTimestamp },
    { field: "nextReviewAt", col: "nextReviewAt", parse: parseTimestamp },
    { field: "reviewFrequency", col: "reviewFrequency", parse: (s) => enumize(s, ["monthly", "quarterly", "half_yearly", "annual"], null) },
    { field: "status", col: "status", parse: (s) => enumize(s, ["active", "dormant", "inactive", "redemption_risk", "closed"], null) },
    { field: "notes", col: "notes" },
    { field: "aum", col: "aum", parse: parseAum },
  ];

  for (const def of SCALARS) {
    if (!reverse[def.field]) continue; // not mapped → leave column untouched
    const raw = pick(row, reverse[def.field]);
    const val = def.parse ? def.parse(raw) : raw || null;
    put(def.col, val);
  }

  // Name is NOT NULL — only ever set it to a non-empty, humanised value.
  if (reverse.name) {
    const nm = pick(row, reverse.name);
    if (nm) set.name = humanizeName(nm);
  }

  // PAN is NOT NULL at the Drizzle level but DB-nullable; only set when present.
  if (reverse.pan) {
    const pan = pick(row, reverse.pan).toUpperCase();
    if (pan) set.pan = pan;
  }

  // Address (jsonb) — MERGE with the existing address so an update never wipes
  // address parts the file didn't carry. Empty mapped parts clear only when
  // dontUpdateEmpty is false.
  const addrFields: Array<[string, string]> = [
    ["addressLine1", "line1"],
    ["city", "city"],
    ["state", "state"],
    ["pincode", "pincode"],
    ["country", "country"],
  ];
  if (addrFields.some(([f]) => reverse[f])) {
    const next: Record<string, any> = { ...(existingAddress ?? {}) };
    for (const [f, k] of addrFields) {
      if (!reverse[f]) continue;
      const v = pick(row, reverse[f]);
      if (v) next[k] = v;
      else if (!dontUpdateEmpty) delete next[k];
    }
    set.address = next;
  }

  // Nominee / bank groups — replace wholesale only when a non-empty primary
  // value is present (never wiped by a blank cell).
  if (reverse.nomineeName) {
    const nn = pick(row, reverse.nomineeName);
    if (nn) {
      const rel = pick(row, reverse.nomineeRelation) || undefined;
      const dob = parseDate(pick(row, reverse.nomineeDob)) || undefined;
      set.nomineeName = nn;
      set.nomineeRelation = rel ?? null;
      set.nomineeDob = dob ?? null;
      set.nominees = [{ name: nn, relation: rel, dob }];
    }
  }
  if (reverse.bankName) {
    const bn = pick(row, reverse.bankName);
    if (bn) {
      const acct = pick(row, reverse.bankAccountNumberMasked) || undefined;
      const ifsc = pick(row, reverse.bankIfsc) || undefined;
      set.bankName = bn;
      set.bankAccountNumberMasked = acct ?? null;
      set.bankIfsc = ifsc ?? null;
      set.bankAccounts = [{ bankName: bn, accountMasked: acct, ifsc }];
    }
  }

  // Custom fields — merge the mapped, sanitized values over the existing bag so
  // an update only touches the columns present in the file.
  if (Object.keys(cleanCustomFields).length) {
    set.customFields = { ...(existingCustomFields ?? {}), ...cleanCustomFields };
  }

  set.updatedAt = new Date();
  return set;
}

function pick(row: Record<string, any>, header: string | undefined): string {
  if (!header) return "";
  const v = row[header];
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/**
 * Lenient date parser for spreadsheet input → "YYYY-MM-DD" (or null). Handles
 * Indian day-first DD-MM-YYYY (and / . separators), 2-digit years, Excel serial
 * numbers, and ISO. Never throws — unparseable input becomes null so the row
 * still imports.
 */
function parseDate(v: string): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  // Excel serial date (days since 1899-12-30), e.g. "26000".
  if (/^\d{4,6}$/.test(s)) {
    const serial = parseInt(s, 10);
    if (serial > 0 && serial < 100000) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }
  // DD-MM-YYYY / DD/MM/YYYY / DD.MM.YYYY (+ 2-digit year), day-first.
  const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    let day = +m[1];
    let mon = +m[2];
    let year = +m[3];
    if (year < 100) year += year < 50 ? 2000 : 1900;
    if (mon > 12 && day <= 12) { const t = day; day = mon; mon = t; } // clearly MM-DD → swap
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
      const d = new Date(Date.UTC(year, mon - 1, day));
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    return null;
  }
  // ISO / anything the JS engine can parse (YYYY-MM-DD, "Jan 5 1990", …).
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function parseTimestamp(v: string): Date | null {
  const iso = parseDate(v);
  return iso ? new Date(iso + "T00:00:00.000Z") : null;
}

/**
 * Make a display name readable. If the value is (or fell back to) an email, use
 * the local part title-cased so the client list never shows a raw email/PAN as
 * the name. Plain names pass through unchanged.
 */
function humanizeName(s: string): string {
  const v = String(s ?? "").trim();
  if (!v) return v;
  if (v.includes("@")) {
    const local = v.split("@")[0].replace(/[._-]+/g, " ").trim();
    const titled = local.replace(/\b\w/g, (c) => c.toUpperCase());
    return titled || v;
  }
  return v;
}

/** Map free-text gender to the M/F/O enum; unknown/empty → null. */
function coerceGender(v: string): "M" | "F" | "O" | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith("m")) return "M";
  if (s.startsWith("f")) return "F";
  return "O";
}

/**
 * Normalise an imported enum cell to one of the allowed DB values
 * (case-insensitive), or the fallback when it doesn't match. Without this,
 * Excel values like "Individual" / "Regular" were stored raw and then made
 * EVERY later edit of the client fail the API's enum validation ("invalid
 * body"). Returns the canonical-cased allowed value.
 */
/**
 * "₹12,34,567.50" / "1234567.5" / "" -> "1234567.50" (a numeric-column string)
 * or null. Strips currency symbols, commas and stray whitespace; never throws
 * on garbage input — an unparseable cell just leaves the column untouched
 * (same "permissive import" rule every other field in this file follows).
 */
function parseAum(v: string): string | null {
  const cleaned = String(v ?? "").replace(/[₹,s]/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return n.toFixed(2);
}

function enumize(raw: string | null | undefined, allowed: string[], fallback: string | null): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return fallback;
  const hit = allowed.find((a) => a.toLowerCase() === v.toLowerCase());
  return hit ?? fallback;
}
