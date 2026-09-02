/**
 * Churn-risk model — predicts which clients are most likely to redeem and walk.
 *
 * We use a TRANSPARENT WEIGHTED SCORECARD, not a black-box ML model. In a
 * regulated advisory business an MFD has to be able to explain to a client (and
 * to compliance) WHY the system flagged someone — "no SIP, two redemptions in
 * 90 days, negative XIRR, 8 months of silence" beats "the neural net said 0.83".
 * Each signal contributes points; the total is the churn-risk score (0 = sticky,
 * 100 = about to leave). The factors list is returned so the UI shows the reasons
 * and the RM knows exactly what to act on.
 *
 * Signals are behavioural/financial (redemptions, SIP health, returns, dormancy,
 * net flows, engagement) — deliberately COMPLEMENTARY to clientHealth(), which
 * scores compliance/data hygiene (KYC, nominee, review cadence). A client can be
 * compliance-green but churn-red (happy paperwork, quietly redeeming) and vice
 * versa.
 *
 * Pure: feed it the per-investor signals (one batch SQL row) and it scores.
 */

export type ChurnBand = "low" | "medium" | "high";

export type ChurnSignals = {
  /** investor.status — 'active' | 'dormant' | ... */
  status?: string | null;
  serviceTier?: string | null;
  onboardedAt?: Date | string | null;
  /** Latest purchase/SIP/STP-in (money-in) order date. */
  lastInflowAt?: Date | string | null;
  /** Latest contact (call/meet/WA) — engagement. */
  lastContactAt?: Date | string | null;
  /** Redemptions (money-out) in trailing 180 days. */
  redemptionAmt180d?: number | null;
  redemptionCount180d?: number | null;
  /** Net flow over trailing 365 days (inflow − outflow). Negative = shrinking. */
  netFlow365d?: number | null;
  /** Active SIP count + recent disruptions. */
  activeSips?: number | null;
  sipStops90d?: number | null;
  sipRejections90d?: number | null;
  /** Portfolio XIRR as a decimal (−0.08 = −8% p.a.), or null if unpriced. */
  xirr?: number | null;
  /**
   * Cheap absolute-return proxy = (current value − net invested) / net invested,
   * as a decimal. Used by the whole-book batch sweep, where a precise per-investor
   * XIRR (NAV join) is too heavy; the 360 badge passes the real `xirr` instead.
   * Only one of the two scores the "returns" factor (XIRR wins).
   */
  absoluteReturnPct?: number | null;
  /** Current market value (₹) — small books are lower-stickiness. */
  currentValue?: number | null;
  /** Explicit redemption-risk flag set elsewhere. */
  redemptionRiskFlaggedAt?: Date | string | null;
};

export type ChurnFactor = { key: string; label: string; points: number; why: string };
export type ChurnResult = {
  score: number;          // 0-100, higher = more likely to churn
  band: ChurnBand;        // low <34, medium 34-59, high >=60
  factors: ChurnFactor[]; // contributing signals, biggest first
  /** One-line headline reason for list views. */
  headline: string;
};

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function daysSince(v: Date | string | null | undefined, now: Date): number | null {
  const d = toDate(v);
  return d ? Math.floor((now.getTime() - d.getTime()) / 86_400_000) : null;
}

export function churnScore(s: ChurnSignals, now = new Date()): ChurnResult {
  const f: ChurnFactor[] = [];
  let score = 0;

  // 1. Recent redemptions — the strongest leading signal of an exit.
  const redCount = s.redemptionCount180d ?? 0;
  if (redCount >= 3) {
    f.push({ key: "redemptions", label: `${redCount} redemptions in 180d`, points: 30, why: "Repeated withdrawals — actively pulling money out" });
    score += 30;
  } else if (redCount === 2) {
    f.push({ key: "redemptions", label: "2 redemptions in 180d", points: 20, why: "More than one recent withdrawal" });
    score += 20;
  } else if (redCount === 1) {
    f.push({ key: "redemptions", label: "1 redemption in 180d", points: 10, why: "A recent withdrawal — check the reason" });
    score += 10;
  }

  // 2. Net shrinking book over a year.
  if (s.netFlow365d != null && s.netFlow365d < 0) {
    const big = Math.abs(s.netFlow365d) > (s.currentValue ?? 0) * 0.25;
    f.push({
      key: "net_outflow",
      label: "Net outflow over 12 months",
      points: big ? 18 : 10,
      why: big ? "Withdrawals dwarf fresh investments" : "Taking out more than putting in",
    });
    score += big ? 18 : 10;
  }

  // 3. SIP health — a live SIP is the stickiest thing an MFD has.
  const sips = s.activeSips ?? 0;
  if ((s.sipStops90d ?? 0) > 0) {
    f.push({ key: "sip_stop", label: `${s.sipStops90d} SIP stop(s) in 90d`, points: 18, why: "Stopping a SIP is a classic pre-exit move" });
    score += 18;
  }
  if ((s.sipRejections90d ?? 0) >= 2) {
    f.push({ key: "sip_reject", label: `${s.sipRejections90d} SIP rejections in 90d`, points: 12, why: "Repeated bounces — mandate/bank issue or disengagement" });
    score += 12;
  }
  if (sips === 0 && (s.currentValue ?? 0) > 0) {
    f.push({ key: "no_sip", label: "No active SIP", points: 12, why: "No recurring commitment keeping the relationship warm" });
    score += 12;
  }

  // 4. Performance dissatisfaction. Prefer precise XIRR (the 360 badge); fall
  //    back to the cheap absolute-return proxy for the whole-book batch sweep so
  //    the radar doesn't ignore returns entirely (and so it agrees with the 360
  //    page's direction). Only one fires — XIRR wins when present.
  if (s.xirr != null) {
    if (s.xirr < -0.05) {
      f.push({ key: "returns", label: `XIRR ${(s.xirr * 100).toFixed(1)}%`, points: 16, why: "Negative returns — high dissatisfaction risk" });
      score += 16;
    } else if (s.xirr < 0.04) {
      f.push({ key: "returns", label: `XIRR ${(s.xirr * 100).toFixed(1)}%`, points: 8, why: "Returns below a bank FD — client may question staying" });
      score += 8;
    }
  } else if (s.absoluteReturnPct != null) {
    if (s.absoluteReturnPct < -0.05) {
      f.push({ key: "returns", label: `Down ${Math.abs(s.absoluteReturnPct * 100).toFixed(0)}% vs invested`, points: 16, why: "Portfolio value is below net invested — high dissatisfaction risk" });
      score += 16;
    } else if (s.absoluteReturnPct < 0.04) {
      f.push({ key: "returns", label: "Flat vs invested", points: 8, why: "Barely ahead of net invested — client may question staying" });
      score += 8;
    }
  }

  // 5. Investment dormancy (no fresh money in).
  const inflowGap = daysSince(s.lastInflowAt, now);
  if (inflowGap == null) {
    f.push({ key: "dormant", label: "No investment on record", points: 10, why: "No purchase/SIP ever captured" });
    score += 10;
  } else if (inflowGap > 365) {
    f.push({ key: "dormant", label: `${Math.floor(inflowGap / 30)}mo since last investment`, points: 14, why: "Over a year with no fresh investment" });
    score += 14;
  } else if (inflowGap > 180) {
    f.push({ key: "dormant", label: `${Math.floor(inflowGap / 30)}mo since last investment`, points: 7, why: "6+ months without adding money" });
    score += 7;
  }

  // 6. Engagement / silence.
  const contactGap = daysSince(s.lastContactAt, now);
  if (contactGap == null || contactGap > 180) {
    f.push({ key: "silence", label: contactGap == null ? "No contact recorded" : `${Math.floor(contactGap / 30)}mo of silence`, points: 12, why: "Out of touch — easy for a competitor to poach" });
    score += 12;
  } else if (contactGap > 90) {
    f.push({ key: "silence", label: `${contactGap}d since last contact`, points: 6, why: "Quarter of silence — schedule a check-in" });
    score += 6;
  }

  // 7. Explicit flag (set by the daily scanner / RM).
  if (s.redemptionRiskFlaggedAt) {
    f.push({ key: "flagged", label: "Flagged redemption-risk", points: 15, why: "Already flagged as redemption-risk" });
    score += 15;
  }

  // 8. New + tiny relationship is inherently fragile.
  const tenure = daysSince(s.onboardedAt, now);
  if (tenure != null && tenure < 180 && (s.currentValue ?? 0) < 50_000) {
    f.push({ key: "new_small", label: "New + small book", points: 6, why: "Recent, low-value clients churn most — over-service early" });
    score += 6;
  }

  const clamped = Math.max(0, Math.min(100, score));
  const band: ChurnBand = clamped >= 60 ? "high" : clamped >= 34 ? "medium" : "low";
  f.sort((a, b) => b.points - a.points);

  const headline =
    f.length === 0
      ? "No churn signals — sticky client"
      : f[0].label + (f.length > 1 ? ` · +${f.length - 1} more` : "");

  return { score: clamped, band, factors: f, headline };
}

export function churnBandClasses(b: ChurnBand) {
  switch (b) {
    case "low":
      return { chip: "bg-emerald-50 text-emerald-700 border-emerald-200", bar: "bg-emerald-500", label: "Low risk" };
    case "medium":
      return { chip: "bg-amber-50 text-amber-700 border-amber-200", bar: "bg-amber-500", label: "Watch" };
    case "high":
      return { chip: "bg-rose-50 text-rose-700 border-rose-200", bar: "bg-rose-500", label: "High risk" };
  }
}
