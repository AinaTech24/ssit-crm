/**
 * Client-side helpers for computing investor health, dormancy, review
 * cadence adherence, and at-a-glance compliance flags.
 *
 * Pure functions — no DB access, no network. Feed them the investor row
 * (the same shape the detail page already loads from drizzle).
 */

export type HealthBand = "green" | "amber" | "red";

export type InvestorForHealth = {
  status?: string | null;
  serviceTier?: string | null;
  lastContactAt?: Date | string | null;
  lastReviewAt?: Date | string | null;
  nextReviewAt?: Date | string | null;
  lastTransactionAt?: Date | string | null;
  kycStatus?: string | null;
  ckycExpiryAt?: Date | string | null;
  fatcaExpiryAt?: Date | string | null;
  fatcaStatus?: string | null;
  nomineeName?: string | null;
  bankAccountNumberMasked?: string | null;
  panAadhaarLinkStatus?: string | null;
  riskProfile?: string | null;
  riskProfileSignedAt?: Date | string | null;
  redemptionRiskFlaggedAt?: Date | string | null;
  /** Open service-request SLA breach indicator (caller can pass `true` when
   *  any open SR has `sla_resolution_at < now()`). */
  hasOpenSrBreach?: boolean;
};

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  return v instanceof Date ? v : new Date(v);
}

function daysSince(v: Date | string | null | undefined, now = new Date()): number | null {
  const d = toDate(v);
  if (!d || isNaN(d.getTime())) return null;
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000);
}

function daysUntil(v: Date | string | null | undefined, now = new Date()): number | null {
  const d = toDate(v);
  if (!d || isNaN(d.getTime())) return null;
  return Math.floor((d.getTime() - now.getTime()) / 86_400_000);
}

/** Cadence per service tier in days. A=90 (quarterly), B=180 (half-yearly), C=365 (annual). */
const TIER_CADENCE: Record<string, number> = { A: 90, B: 180, C: 365 };

export type HealthBreakdown = {
  score: number;
  band: HealthBand;
  factors: Array<{
    key: string;
    label: string;
    deduction: number;
    why: string;
  }>;
};

/**
 * Composite client health score. Starts at 100 and deducts for each red
 * flag. Each deduction has a label so the UI can list "why" inline.
 */
export function clientHealth(
  inv: InvestorForHealth,
  now = new Date()
): HealthBreakdown {
  const factors: HealthBreakdown["factors"] = [];
  let score = 100;

  // 1. Last contact recency
  const contactGap = daysSince(inv.lastContactAt, now);
  if (contactGap == null) {
    factors.push({
      key: "contact",
      label: "No contact recorded",
      deduction: 20,
      why: "Set last_contact_at when you call/meet/WA the client",
    });
    score -= 20;
  } else if (contactGap > 90) {
    factors.push({
      key: "contact",
      label: `${contactGap}d since last contact`,
      deduction: 25,
      why: "More than 90 days of silence",
    });
    score -= 25;
  } else if (contactGap > 45) {
    factors.push({
      key: "contact",
      label: `${contactGap}d since last contact`,
      deduction: 10,
      why: "45+ days silent — schedule a touchpoint",
    });
    score -= 10;
  }

  // 2. Review cadence vs tier
  const cadence = TIER_CADENCE[inv.serviceTier ?? ""] ?? 0;
  const reviewGap = daysSince(inv.lastReviewAt, now);
  if (cadence > 0) {
    if (reviewGap == null) {
      factors.push({
        key: "review",
        label: `Tier ${inv.serviceTier} — no review yet`,
        deduction: 15,
        why: `Tier ${inv.serviceTier} expects a review every ${cadence} days`,
      });
      score -= 15;
    } else if (reviewGap > cadence) {
      const overdue = reviewGap - cadence;
      const ded = inv.serviceTier === "A" ? 15 : 10;
      factors.push({
        key: "review",
        label: `Review overdue ${overdue}d (tier ${inv.serviceTier})`,
        deduction: ded,
        why: `Tier ${inv.serviceTier} cadence is ${cadence}d`,
      });
      score -= ded;
    }
  }

  // 3. KYC hygiene
  if (
    inv.kycStatus === "expired" ||
    inv.kycStatus === "rejected" ||
    inv.kycStatus === "re_kyc_required"
  ) {
    factors.push({
      key: "kyc",
      label: `KYC ${inv.kycStatus}`,
      deduction: 20,
      why: "Investments can't progress until KYC is clean",
    });
    score -= 20;
  } else {
    const ckycExpiry = daysUntil(inv.ckycExpiryAt, now);
    if (ckycExpiry != null && ckycExpiry < 30) {
      factors.push({
        key: "kyc",
        label: `CKYC expires in ${ckycExpiry}d`,
        deduction: 10,
        why: "CKYC renewal needed",
      });
      score -= 10;
    }
  }

  // 4. PAN-Aadhaar
  if (
    inv.panAadhaarLinkStatus === "not_linked" ||
    inv.panAadhaarLinkStatus === "pending"
  ) {
    factors.push({
      key: "pan_aadhaar",
      label: "PAN-Aadhaar not linked",
      deduction: 10,
      why: "Unlinked PAN can block new investments AMC-side",
    });
    score -= 10;
  }

  // 5. FATCA
  const fatcaExpiry = daysUntil(inv.fatcaExpiryAt, now);
  if (inv.fatcaStatus === "expired") {
    factors.push({
      key: "fatca",
      label: "FATCA expired",
      deduction: 10,
      why: "Refresh FATCA declaration",
    });
    score -= 10;
  } else if (fatcaExpiry != null && fatcaExpiry < 30) {
    factors.push({
      key: "fatca",
      label: `FATCA expires in ${fatcaExpiry}d`,
      deduction: 5,
      why: "Renew FATCA",
    });
    score -= 5;
  }

  // 6. Nominee
  if (!inv.nomineeName || inv.nomineeName.trim() === "") {
    factors.push({
      key: "nominee",
      label: "Nominee missing",
      deduction: 10,
      why: "Transmission risk — capture nominee",
    });
    score -= 10;
  }

  // 7. Bank
  if (
    !inv.bankAccountNumberMasked ||
    inv.bankAccountNumberMasked.trim() === ""
  ) {
    factors.push({
      key: "bank",
      label: "Bank details missing",
      deduction: 8,
      why: "Required for redemption + mandate",
    });
    score -= 8;
  }

  // 8. Risk profile
  const rpGap = daysSince(inv.riskProfileSignedAt, now);
  if (!inv.riskProfile || !inv.riskProfileSignedAt) {
    factors.push({
      key: "risk_profile",
      label: "Risk profile missing",
      deduction: 10,
      why: "SEBI: advisory needs a signed risk profile",
    });
    score -= 10;
  } else if (rpGap != null && rpGap > 365) {
    factors.push({
      key: "risk_profile",
      label: `Risk profile ${Math.floor(rpGap / 30)}mo old`,
      deduction: 5,
      why: "Risk profile should be refreshed annually",
    });
    score -= 5;
  }

  // 9. Explicit redemption-risk flag
  if (inv.redemptionRiskFlaggedAt) {
    factors.push({
      key: "redemption_risk",
      label: "Flagged redemption-risk",
      deduction: 20,
      why: "System flagged this client as redemption risk",
    });
    score -= 20;
  }

  // 10. Open SR SLA breach
  if (inv.hasOpenSrBreach) {
    factors.push({
      key: "sr",
      label: "Open SR SLA breached",
      deduction: 12,
      why: "Service request past resolution SLA",
    });
    score -= 12;
  }

  // 11. Client dormancy
  const txGap = daysSince(inv.lastTransactionAt, now);
  if (inv.status === "active" && txGap != null && txGap > 180) {
    factors.push({
      key: "dormant",
      label: `Dormant ${Math.floor(txGap / 30)}mo`,
      deduction: 8,
      why: "No transactions in >180 days",
    });
    score -= 8;
  }

  const clamped = Math.max(0, Math.min(100, score));
  return {
    score: clamped,
    band: clamped >= 80 ? "green" : clamped >= 60 ? "amber" : "red",
    factors,
  };
}

/**
 * Convenience: the persistable health columns for an investor row. Spread into
 * a Drizzle insert/update. Pure (no DB) so it's safe to call anywhere.
 * `band` is the `clientHealth` band; we persist the numeric score + band.
 */
export function healthFields(
  inv: InvestorForHealth,
  now = new Date()
): { healthScore: number; healthBand: HealthBand; healthScoredAt: Date } {
  const { score, band } = clientHealth(inv, now);
  return { healthScore: score, healthBand: band, healthScoredAt: now };
}

export function dormancyDays(inv: InvestorForHealth, now = new Date()): number | null {
  return daysSince(inv.lastTransactionAt, now);
}

export function daysSinceReview(inv: InvestorForHealth, now = new Date()): number | null {
  return daysSince(inv.lastReviewAt, now);
}

export function reviewOverdue(inv: InvestorForHealth, now = new Date()): boolean {
  const cadence = TIER_CADENCE[inv.serviceTier ?? ""] ?? 0;
  if (cadence === 0) return false;
  const gap = daysSinceReview(inv, now);
  return gap == null ? true : gap > cadence;
}

/** Tone classes that match the rest of the platform's palette. */
export function healthBandClasses(b: HealthBand) {
  switch (b) {
    case "green":
      return {
        chip: "bg-emerald-50 text-emerald-700 border-emerald-200",
        dot: "bg-emerald-500",
        bar: "bg-emerald-500",
        label: "Healthy",
      };
    case "amber":
      return {
        chip: "bg-amber-50 text-amber-700 border-amber-200",
        dot: "bg-amber-500",
        bar: "bg-amber-500",
        label: "Watch",
      };
    case "red":
      return {
        chip: "bg-rose-50 text-rose-700 border-rose-200",
        dot: "bg-rose-500",
        bar: "bg-rose-500",
        label: "At risk",
      };
  }
}
