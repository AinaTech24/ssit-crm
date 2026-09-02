/**
 * Risk-alignment check for proposal line-items.
 *
 * Compares the recipient's current risk profile against each scheme's risk
 * rating. Returns a per-line + overall alignment verdict so the UI can warn
 * before sending.
 *
 * Mapping:
 *   Client profile  →  Acceptable scheme risk ratings
 *   ────────────────────────────────────────────────────────
 *   conservative    →  low, moderate
 *   moderate        →  low, moderate, high
 *   aggressive      →  low, moderate, high, very_high
 *
 * "low / moderate / high / very_high" mirrors AMFI's riskometer dial.
 */

export type ClientProfile = "conservative" | "moderate" | "aggressive" | "very_aggressive" | null | undefined;
export type SchemeRisk = "low" | "moderate" | "high" | "very_high" | null | undefined;

const ALLOWED: Record<NonNullable<ClientProfile>, SchemeRisk[]> = {
  conservative: ["low", "moderate"],
  moderate: ["low", "moderate", "high"],
  aggressive: ["low", "moderate", "high", "very_high"],
  very_aggressive: ["low", "moderate", "high", "very_high"],
};

export interface SchemeLine {
  /** Display name — used only for the alert message. */
  name: string;
  /** AMFI riskometer rating on the scheme. */
  riskRating: SchemeRisk;
}

export interface AlignmentFinding {
  schemeName: string;
  schemeRisk: SchemeRisk;
  severity: "ok" | "warn" | "block";
  message: string;
}

export interface AlignmentResult {
  overall: "ok" | "warn" | "block";
  findings: AlignmentFinding[];
  /** Convenience — "Conservative client + 2 high-risk schemes" etc. */
  summary: string;
}

export function checkAlignment(profile: ClientProfile, schemes: SchemeLine[]): AlignmentResult {
  // No profile = warn loudly so RM knows to capture one first.
  if (!profile) {
    return {
      overall: "warn",
      findings: schemes.map((s) => ({
        schemeName: s.name,
        schemeRisk: s.riskRating,
        severity: "warn",
        message: "No risk profile on file — capture one before sending the proposal.",
      })),
      summary: "Client has no recorded risk profile.",
    };
  }

  const allowed = ALLOWED[profile];
  const findings: AlignmentFinding[] = [];
  let mismatchCount = 0;
  let blockCount = 0;

  for (const s of schemes) {
    if (!s.riskRating) {
      findings.push({
        schemeName: s.name,
        schemeRisk: null,
        severity: "warn",
        message: "Scheme risk rating not set — please tag the scheme before sending.",
      });
      continue;
    }

    if (allowed.includes(s.riskRating)) {
      findings.push({
        schemeName: s.name,
        schemeRisk: s.riskRating,
        severity: "ok",
        message: `${s.riskRating} risk — within ${profile} comfort zone.`,
      });
      continue;
    }

    // Quantify how far out it is
    const gap = riskGap(profile, s.riskRating);
    const severity = gap >= 2 ? "block" : "warn";
    if (severity === "block") blockCount++;
    else mismatchCount++;

    findings.push({
      schemeName: s.name,
      schemeRisk: s.riskRating,
      severity,
      message: `${s.riskRating}-risk scheme is ${gap >= 2 ? "well above" : "above"} a ${profile} profile. Either re-assess the client's risk appetite or pick a lower-risk fund.`,
    });
  }

  let overall: "ok" | "warn" | "block" = "ok";
  if (blockCount > 0) overall = "block";
  else if (mismatchCount > 0) overall = "warn";

  const summary =
    overall === "ok"
      ? `All ${schemes.length} schemes align with ${profile} profile.`
      : overall === "warn"
        ? `${mismatchCount} of ${schemes.length} schemes exceed a ${profile} profile — confirm override.`
        : `${blockCount} of ${schemes.length} schemes are significantly riskier than a ${profile} profile — please re-think.`;

  return { overall, findings, summary };
}

function riskGap(profile: NonNullable<ClientProfile>, risk: NonNullable<SchemeRisk>): number {
  const profileLvl: Record<NonNullable<ClientProfile>, number> = {
    conservative: 1,
    moderate: 2,
    aggressive: 3,
    very_aggressive: 4,
  };
  const riskLvl: Record<NonNullable<SchemeRisk>, number> = {
    low: 1,
    moderate: 2,
    high: 3,
    very_high: 4,
  };
  return Math.max(0, riskLvl[risk] - (profileLvl[profile] + 1));
}
