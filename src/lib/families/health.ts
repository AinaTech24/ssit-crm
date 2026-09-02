/**
 * Family-level health + missing-data helpers.
 *
 * Pure functions, no DB calls. Feed them the family row + its members
 * (the same shapes the family detail page already loads from drizzle).
 *
 * Score model — 100 minus deductions:
 *   - 15  primary investor not set
 *   - 10  family RM not assigned
 *   - 15  family review overdue / never done
 *   -  varies  nominee coverage <100%
 *   -  varies  KYC verified coverage <100%
 *   -  varies  risk-profile coverage <100%
 *   - 10  no next-gen member captured (no minor + no <35-year-old)
 *   -  5  only one member captured (single-person "family")
 */

import type { HealthBand } from "@/lib/investors/health";

export type FamilyForHealth = {
  primaryInvestorId?: string | null;
  rmId?: string | null;
  lastReviewAt?: Date | string | null;
  nextReviewAt?: Date | string | null;
};

export type MemberForHealth = {
  id: string;
  name?: string | null;
  status?: string | null;
  dob?: Date | string | null;
  isMinor?: boolean | null;
  kycStatus?: string | null;
  nomineeName?: string | null;
  riskProfile?: string | null;
  riskProfileSignedAt?: Date | string | null;
  aum?: string | number | null;
  activeSipAmount?: string | number | null;
};

export type FamilyHealthBreakdown = {
  score: number;
  band: HealthBand;
  factors: Array<{
    key: string;
    label: string;
    deduction: number;
    why: string;
  }>;
  coverage: {
    nomineePct: number;
    kycPct: number;
    riskProfilePct: number;
  };
  hasNextGen: boolean;
  activeMemberCount: number;
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

export function familyHealth(
  family: FamilyForHealth,
  members: MemberForHealth[],
  now = new Date()
): FamilyHealthBreakdown {
  const factors: FamilyHealthBreakdown["factors"] = [];
  let score = 100;

  const active = members.filter((m) => m.status === "active" || m.status == null);
  const total = Math.max(active.length, 1);

  // 1. Primary set
  if (!family.primaryInvestorId) {
    factors.push({
      key: "primary",
      label: "Primary client not set",
      deduction: 15,
      why: "Without a head, decisions and routing get ambiguous",
    });
    score -= 15;
  }

  // 2. Family RM
  if (!family.rmId) {
    factors.push({
      key: "rm",
      label: "Family RM not assigned",
      deduction: 10,
      why: "Assign one RM so the family has a single point of contact",
    });
    score -= 10;
  }

  // 3. Review cadence — annual at family level by default
  const reviewGap = daysSince(family.lastReviewAt, now);
  if (reviewGap == null) {
    factors.push({
      key: "review",
      label: "Never reviewed at family level",
      deduction: 12,
      why: "Schedule the first annual family review",
    });
    score -= 12;
  } else if (reviewGap > 365) {
    factors.push({
      key: "review",
      label: `Family review ${Math.floor(reviewGap / 30)}mo overdue`,
      deduction: 10,
      why: "Best practice is an annual family-level review",
    });
    score -= 10;
  }

  // 4. Coverage metrics across active members
  const withNominee = active.filter((m) => m.nomineeName && m.nomineeName.trim() !== "").length;
  const withKyc = active.filter((m) => m.kycStatus === "verified").length;
  const withRp = active.filter(
    (m) => m.riskProfile && m.riskProfileSignedAt
  ).length;

  const nomineePct = total > 0 ? (withNominee / total) * 100 : 0;
  const kycPct = total > 0 ? (withKyc / total) * 100 : 0;
  const riskProfilePct = total > 0 ? (withRp / total) * 100 : 0;

  if (nomineePct < 100) {
    const gap = total - withNominee;
    const ded = nomineePct < 50 ? 15 : nomineePct < 80 ? 10 : 5;
    factors.push({
      key: "nominee",
      label: `${gap} member${gap === 1 ? "" : "s"} without nominee`,
      deduction: ded,
      why: "Transmission risk — every member needs a nominee on file",
    });
    score -= ded;
  }

  if (kycPct < 100) {
    const gap = total - withKyc;
    const ded = kycPct < 50 ? 10 : 5;
    factors.push({
      key: "kyc",
      label: `${gap} member${gap === 1 ? "" : "s"} KYC not verified`,
      deduction: ded,
      why: "Unverified members can't transact freely",
    });
    score -= ded;
  }

  if (riskProfilePct < 100) {
    const gap = total - withRp;
    const ded = riskProfilePct < 50 ? 8 : 5;
    factors.push({
      key: "risk_profile",
      label: `${gap} member${gap === 1 ? "" : "s"} without signed risk profile`,
      deduction: ded,
      why: "SEBI requires a signed risk profile per advised client",
    });
    score -= ded;
  }

  // 5. Next-gen capture
  const hasNextGen = active.some((m) => {
    if (m.isMinor) return true;
    if (!m.dob) return false;
    const dob = toDate(m.dob);
    if (!dob) return false;
    const age = (now.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    return age < 35;
  });
  if (!hasNextGen && total >= 2) {
    factors.push({
      key: "next_gen",
      label: "No next-gen member captured",
      deduction: 10,
      why: "Retention drops sharply at generational handoff without next-gen onboarding",
    });
    score -= 10;
  }

  // 6. Single-member family
  if (total === 1) {
    factors.push({
      key: "single_member",
      label: "Only one member captured",
      deduction: 5,
      why: "Onboarding spouse/children is one of the fastest wallet-share wins",
    });
    score -= 5;
  }

  const clamped = Math.max(0, Math.min(100, score));

  return {
    score: clamped,
    band: clamped >= 80 ? "green" : clamped >= 60 ? "amber" : "red",
    factors,
    coverage: { nomineePct, kycPct, riskProfilePct },
    hasNextGen,
    activeMemberCount: total,
  };
}

/**
 * Convenience: the persistable family-health columns. Spread into a Drizzle
 * insert/update. Pure (no DB) — the persist layer loads the members and calls
 * this. `band` is the familyHealth band.
 */
export function familyHealthFields(
  family: FamilyForHealth,
  members: MemberForHealth[],
  now = new Date()
): { healthScore: number; healthBand: HealthBand; healthScoredAt: Date } {
  const { score, band } = familyHealth(family, members, now);
  return { healthScore: score, healthBand: band, healthScoredAt: now };
}

/**
 * Lightweight "what's missing" generator for the punch-list panel.
 * Returns an ordered checklist of items the RM/ops should fix.
 */
export type MissingItem = {
  key: string;
  label: string;
  severity: "high" | "medium";
  action?: { href: string; label: string };
};

export function familyMissingChecklist(
  familyId: string,
  family: FamilyForHealth,
  members: MemberForHealth[]
): MissingItem[] {
  const items: MissingItem[] = [];

  if (!family.primaryInvestorId) {
    items.push({
      key: "primary",
      label: "Set the primary / head client",
      severity: "high",
    });
  }
  if (!family.rmId) {
    items.push({
      key: "rm",
      label: "Assign a family RM",
      severity: "high",
    });
  }
  if (!family.lastReviewAt) {
    items.push({
      key: "first_review",
      label: "Schedule the first family review",
      severity: "medium",
    });
  }

  for (const m of members) {
    if (!m.nomineeName || m.nomineeName.trim() === "") {
      items.push({
        key: `nominee-${m.id}`,
        label: `Capture nominee for ${m.name ?? "member"}`,
        severity: "high",
        action: { href: `/dashboard/investors/${m.id}`, label: "Open" },
      });
    }
    if (m.kycStatus && m.kycStatus !== "verified") {
      items.push({
        key: `kyc-${m.id}`,
        label: `KYC ${m.kycStatus} for ${m.name ?? "member"}`,
        severity: "high",
        action: { href: `/dashboard/investors/${m.id}`, label: "Open" },
      });
    }
    if (!m.riskProfile || !m.riskProfileSignedAt) {
      items.push({
        key: `rp-${m.id}`,
        label: `Risk profile missing for ${m.name ?? "member"}`,
        severity: "medium",
        action: { href: `/dashboard/investors/${m.id}`, label: "Open" },
      });
    }
  }

  return items;
}
