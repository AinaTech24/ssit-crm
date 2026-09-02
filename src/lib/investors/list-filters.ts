/**
 * Shared investor-list filter builder.
 *
 * The investors list page and the Excel export endpoint must apply the EXACT
 * same WHERE logic, otherwise an exported file wouldn't match what's on
 * screen. This module is the single source of truth for translating the URL
 * search params (?q / ?segment / ?tier / ?status / ?kyc / quick-filter chips /
 * ?gaps) into Drizzle conditions.
 *
 * Tenant isolation is handled by RLS (withTenant) — never add a tenant_id
 * predicate here.
 */

import { and, ilike, inArray, or, sql } from "drizzle-orm";
import { investors } from "@/db/schema";

export type InvestorListParams = Record<string, string | undefined>;

/** Parse the comma-joined multi-select params the FilterBar emits. */
function csv(v: string | undefined): string[] {
  return (v ?? "").split(",").filter(Boolean);
}

/**
 * Build the array of Drizzle conditions for the investor list. Returns an
 * array (possibly empty) so callers can `and(...conditions)` or skip the
 * WHERE entirely. `userId` is needed for the "mine" quick-filter.
 */
export function buildInvestorConditions(
  sp: InvestorListParams,
  userId: string
): any[] {
  const conditions: any[] = [];

  // Trash bin: soft-deleted clients never appear in the list / export / counts.
  conditions.push(sql`${investors.deletedAt} IS NULL`);

  const q = (sp.q ?? "").trim();
  const segment = csv(sp.segment);
  const category = csv(sp.category);
  const tier = csv(sp.tier);
  const status = csv(sp.status);
  const kyc = csv(sp.kyc);
  const rm = csv(sp.rm);
  const gaps = csv(sp.gaps);
  const qf = {
    mine: sp.mine === "1",
    tier_a: sp.tier_a === "1",
    hni: sp.hni === "1",
    reviews_due: sp.reviews_due === "1",
    kyc_expiring: sp.kyc_expiring === "1",
    no_nominee: sp.no_nominee === "1",
    rp_stale: sp.rp_stale === "1",
    dormant: sp.dormant === "1",
    birthday_week: sp.birthday_week === "1",
    birthday_today: sp.birthday_today === "1",
    birthday_tomorrow: sp.birthday_tomorrow === "1",
    birthday_past: sp.birthday_past === "1",
    cross_sell_opp: sp.cross_sell_opp === "1",
  };

  if (q) {
    conditions.push(
      or(
        ilike(investors.name, `%${q}%`),
        ilike(investors.pan, `%${q.toUpperCase()}%`),
        ilike(investors.phone ?? sql`''`, `%${q}%`)
      )!
    );
  }
  // NB: use inArray (not `= ANY(${jsArray})`) — Drizzle expands a JS array
  // passed to sql`` into a `($1,$2,…)` tuple, which is invalid for ANY().
  if (segment.length) conditions.push(inArray(investors.segmentTag, segment as any));
  if (category.length) conditions.push(inArray(investors.clientCategory, category as any));
  if (tier.length) conditions.push(inArray(investors.serviceTier, tier as any));
  if (status.length) conditions.push(inArray(investors.status, status as any));
  if (kyc.length) conditions.push(inArray(investors.kycStatus, kyc as any));
  // RM (owning team member) filter — lets an owner slice the book by RM.
  // Explicit ::uuid casts mirror the meetings/SR/leads filter pattern.
  if (rm.length) {
    conditions.push(
      sql`${investors.rmId} IN (${sql.join(rm.map((v) => sql`${v}::uuid`), sql`, `)})`
    );
  }

  if (qf.mine) conditions.push(sql`${investors.rmId} = ${userId}`);
  if (qf.tier_a) conditions.push(sql`${investors.serviceTier} = 'A'`);
  if (qf.hni) conditions.push(sql`${investors.segmentTag} = 'HNI'`);
  if (qf.reviews_due) {
    conditions.push(
      sql`${investors.nextReviewAt} IS NOT NULL AND ${investors.nextReviewAt} <= now()`
    );
  }
  if (qf.kyc_expiring) {
    conditions.push(sql`(
      ${investors.kycStatus} IN ('expired','re_kyc_required')
      OR (${investors.ckycExpiryAt} IS NOT NULL
          AND ${investors.ckycExpiryAt} BETWEEN current_date AND current_date + interval '30 days')
    )`);
  }
  if (qf.no_nominee) {
    conditions.push(sql`(${investors.nomineeName} IS NULL OR ${investors.nomineeName} = '')`);
  }
  if (qf.rp_stale) {
    conditions.push(
      sql`(${investors.riskProfileSignedAt} IS NULL OR ${investors.riskProfileSignedAt} < now() - interval '365 days')`
    );
  }
  if (qf.dormant) {
    conditions.push(
      sql`(${investors.lastTransactionAt} IS NULL OR ${investors.lastTransactionAt} < now() - make_interval(days => COALESCE((SELECT dormancy_window_days FROM tenants WHERE id = ${investors.tenantId}), 180)))`
    );
  }
  if (qf.birthday_week) {
    conditions.push(sql`(
      ${investors.dob} IS NOT NULL
      AND to_char(${investors.dob}, 'MM-DD') BETWEEN to_char(current_date, 'MM-DD')
                                                 AND to_char(current_date + interval '7 days', 'MM-DD')
    )`);
  }
  if (qf.birthday_today) {
    conditions.push(
      sql`(${investors.dob} IS NOT NULL AND to_char(${investors.dob}, 'MM-DD') = to_char(current_date, 'MM-DD'))`
    );
  }
  if (qf.birthday_tomorrow) {
    conditions.push(
      sql`(${investors.dob} IS NOT NULL AND to_char(${investors.dob}, 'MM-DD') = to_char(current_date + interval '1 day', 'MM-DD'))`
    );
  }
  if (qf.birthday_past) {
    // Birthdays in the last 30 days — day-of-year modular window so it stays
    // correct across the year-end boundary (mirrors the birthday bell's "Past").
    conditions.push(
      sql`(${investors.dob} IS NOT NULL AND ((EXTRACT(DOY FROM current_date)::int - EXTRACT(DOY FROM ${investors.dob})::int + 366) % 366) BETWEEN 1 AND 30)`
    );
  }
  if (qf.cross_sell_opp) {
    // Any product marked held-elsewhere / interested / not-held = a wallet-share opportunity.
    conditions.push(sql`(
      ${investors.crossSell} IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM jsonb_each_text(${investors.crossSell}) AS cs(k, v)
        WHERE cs.v IN ('held_elsewhere', 'interested', 'not_held')
      )
    )`);
  }

  for (const gap of gaps) {
    switch (gap) {
      case "pan":
        conditions.push(sql`(${investors.pan} IS NULL OR ${investors.pan} = '')`);
        break;
      case "phone":
        conditions.push(sql`(${investors.phone} IS NULL OR ${investors.phone} = '')`);
        break;
      case "email":
        conditions.push(sql`(${investors.email} IS NULL OR ${investors.email} = '')`);
        break;
      case "dob":
        conditions.push(sql`${investors.dob} IS NULL`);
        break;
      case "nominee":
        conditions.push(sql`(${investors.nomineeName} IS NULL OR ${investors.nomineeName} = '')`);
        break;
      case "bank":
        conditions.push(
          sql`(${investors.bankAccountNumberMasked} IS NULL OR ${investors.bankAccountNumberMasked} = '')`
        );
        break;
      case "risk_profile":
        conditions.push(
          sql`(${investors.riskProfile} IS NULL OR ${investors.riskProfileSignedAt} IS NULL)`
        );
        break;
      case "rm":
        conditions.push(sql`${investors.rmId} IS NULL`);
        break;
      case "pan_aadhaar":
        conditions.push(sql`(${investors.panAadhaarLinkStatus} = 'not_linked' OR ${investors.panAadhaarLinkStatus} IS NULL)`);
        break;
      case "unverified_contact":
        // Sanchay "Verified At" parity — email/phone present but not confirmed.
        conditions.push(sql`(
          (${investors.email} IS NOT NULL AND ${investors.email} <> '' AND ${investors.emailVerifiedAt} IS NULL)
          OR (${investors.phone} IS NOT NULL AND ${investors.phone} <> '' AND ${investors.phoneVerifiedAt} IS NULL)
        )`);
        break;
    }
  }

  // Custom created-date range (FilterBar date_range emits created_from / created_to
  // as yyyy-mm-dd). Half-open [from, to+1) so the "to" day is inclusive. Uses the
  // qualified investors.createdAt column so it's unambiguous under joins, and is
  // applied here so the Excel export honours the same range as the on-screen list.
  const createdFrom = (sp.created_from ?? "").trim();
  const createdTo = (sp.created_to ?? "").trim();
  const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (isDate(createdFrom)) conditions.push(sql`${investors.createdAt} >= ${createdFrom}::date`);
  if (isDate(createdTo)) conditions.push(sql`${investors.createdAt} < (${createdTo}::date + interval '1 day')`);

  return conditions;
}

/** Convenience: combined WHERE (undefined when no conditions). */
export function buildInvestorWhere(sp: InvestorListParams, userId: string) {
  const conditions = buildInvestorConditions(sp, userId);
  return conditions.length ? and(...conditions) : undefined;
}
