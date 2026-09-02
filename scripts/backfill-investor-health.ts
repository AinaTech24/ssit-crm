/**
 * Backfill the persisted client-health score for every existing investor.
 *
 * Migration 0041 added health_score/health_band/health_scored_at with optimistic
 * defaults (100/green/NULL). New + edited investors get scored going forward by
 * the app; this one-time pass scores the rows that already existed. The nightly
 * daily-ops scanner keeps them fresh thereafter (health has time-based factors).
 *
 * Idempotent. Safe in prod.
 *
 * Usage:
 *   npx tsx scripts/backfill-investor-health.ts          score all investors
 *   npx tsx scripts/backfill-investor-health.ts --dry    report, don't write
 */

import "dotenv/config";
import { sql } from "drizzle-orm";

// Cross-tenant maintenance ⇒ needs system (RLS-bypassing) access.
process.env.ALLOW_SYSTEM_TX = process.env.ALLOW_SYSTEM_TX ?? "1";

import { withSystem } from "../src/db/client";
import { clientHealth } from "../src/lib/investors/health";

const DRY = process.argv.includes("--dry");
const BATCH = 500;

async function main() {
  const now = new Date();
  let offset = 0;
  let total = 0;
  const tally: Record<string, number> = { green: 0, amber: 0, red: 0 };

  for (;;) {
    const page = await withSystem(async (tx) =>
      (
        await tx.execute(sql`
          SELECT id, status, service_tier, last_contact_at, last_review_at,
                 next_review_at, last_transaction_at, kyc_status, ckyc_expiry_at,
                 fatca_expiry_at, fatca_status, nominee_name, bank_account_masked,
                 pan_aadhaar_link_status, risk_profile, risk_profile_signed_at,
                 redemption_risk_flagged_at
          FROM investors
          ORDER BY id
          LIMIT ${BATCH} OFFSET ${offset}
        `)
      ).rows as any[]
    );
    if (page.length === 0) break;

    for (const r of page) {
      const { score, band } = clientHealth(
        {
          status: r.status,
          serviceTier: r.service_tier,
          lastContactAt: r.last_contact_at,
          lastReviewAt: r.last_review_at,
          nextReviewAt: r.next_review_at,
          lastTransactionAt: r.last_transaction_at,
          kycStatus: r.kyc_status,
          ckycExpiryAt: r.ckyc_expiry_at,
          fatcaExpiryAt: r.fatca_expiry_at,
          fatcaStatus: r.fatca_status,
          nomineeName: r.nominee_name,
          bankAccountNumberMasked: r.bank_account_masked,
          panAadhaarLinkStatus: r.pan_aadhaar_link_status,
          riskProfile: r.risk_profile,
          riskProfileSignedAt: r.risk_profile_signed_at,
          redemptionRiskFlaggedAt: r.redemption_risk_flagged_at,
        },
        now
      );
      tally[band] = (tally[band] ?? 0) + 1;
      total++;

      if (!DRY) {
        await withSystem(async (tx) => {
          await tx.execute(sql`
            UPDATE investors
               SET health_score = ${score}, health_band = ${band}, health_scored_at = now()
             WHERE id = ${r.id}::uuid
          `);
        });
      }
    }

    process.stdout.write(`[backfill] scored ${total} …\r`);
    offset += BATCH;
  }

  console.log(
    `\n[backfill] ${DRY ? "(dry) would score" : "scored"} ${total} investor(s) — ` +
      `green ${tally.green}, amber ${tally.amber}, red ${tally.red}.`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("\n[backfill] failed:", e?.message ?? e);
  process.exit(1);
});
