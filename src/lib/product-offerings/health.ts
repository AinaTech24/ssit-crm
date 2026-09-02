/**
 * Offering health — turns the Products & Services catalog from a static list into
 * a live readiness + compliance surface.
 *
 * Two deterministic checks per offering:
 *   1. LICENSE  — the linked legal_registrations that authorise the offering.
 *                 An active offering whose authorising licence has expired (or
 *                 expires within 90 days) is a real SEBI risk.
 *   2. TEAM     — the assigned team members vs the offering's required exams.
 *                 We can verify the three creds the user record actually tracks
 *                 (NISM / ARN / EUIN) with their expiry; anything else (IRDA,
 *                 CFA, …) is flagged "unverifiable", never a false gap.
 */

export type LicenseState = "ok" | "expiring" | "expired" | "none";
export type ReadinessState = "ready" | "attention" | "blocked" | "no_team";

export interface LinkedLicense {
  id: string;
  label: string;
  expiresAt: string | Date | null;
  daysLeft: number | null;
}

export interface TeamMemberCred {
  id: string;
  name: string;
  /** Verifiable creds this member currently holds. */
  nismOk: boolean;
  arnOk: boolean;
  euinOk: boolean;
}

export interface OfferingHealth {
  license: LicenseState;
  licenses: LinkedLicense[];
  readiness: ReadinessState;
  /** Verifiable creds this offering requires (derived from requiredExams text). */
  requires: { nism: boolean; arn: boolean; euin: boolean };
  /** Required-but-unverifiable exam strings (e.g. "IRDA", "CFA"). */
  unverifiable: string[];
  qualifiedCount: number;
  teamCount: number;
  /** Human-readable gaps, e.g. "Asha — NISM expired", "No team member holds ARN". */
  gaps: string[];
}

const EXPIRY_WARN_DAYS = 90;

export function daysUntil(d: string | Date | null | undefined): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  if (isNaN(t)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((t - today.getTime()) / 86400000);
}

/** Which verifiable creds a free-text required-exams list implies. */
export function parseRequiredCreds(requiredExams: string[]): { nism: boolean; arn: boolean; euin: boolean; unverifiable: string[] } {
  let nism = false, arn = false, euin = false;
  const unverifiable: string[] = [];
  for (const raw of requiredExams ?? []) {
    const e = raw.toLowerCase();
    if (e.includes("nism")) nism = true;
    else if (e.includes("euin")) euin = true;
    else if (e.includes("arn")) arn = true;
    else unverifiable.push(raw);
  }
  return { nism, arn, euin, unverifiable };
}

export interface ComputeHealthInput {
  status: string;
  requiredExams: string[];
  linkedRegistrationIds: string[];
  teamMemberIds: string[];
  /** regId → { label, expiresAt } for the offering's linked registrations. */
  regMap: Map<string, { label: string; expiresAt: string | Date | null }>;
  /** userId → cred currency. */
  credMap: Map<string, TeamMemberCred>;
}

export function computeOfferingHealth(input: ComputeHealthInput): OfferingHealth {
  // ── License ──
  const licenses: LinkedLicense[] = (input.linkedRegistrationIds ?? [])
    .map((rid) => {
      const r = input.regMap.get(rid);
      if (!r) return null;
      return { id: rid, label: r.label, expiresAt: r.expiresAt, daysLeft: daysUntil(r.expiresAt) };
    })
    .filter(Boolean) as LinkedLicense[];

  let license: LicenseState;
  if (licenses.length === 0) {
    license = "none";
  } else {
    const dls = licenses.map((l) => l.daysLeft).filter((d): d is number => d != null);
    if (dls.some((d) => d < 0)) license = "expired";
    else if (dls.some((d) => d < EXPIRY_WARN_DAYS)) license = "expiring";
    else license = "ok";
  }

  // ── Team readiness ──
  const requires = parseRequiredCreds(input.requiredExams ?? []);
  const unverifiable = requires.unverifiable;
  const team = (input.teamMemberIds ?? []).map((uid) => input.credMap.get(uid)).filter(Boolean) as TeamMemberCred[];
  const teamCount = team.length;

  const needs = requires.nism || requires.arn || requires.euin;
  const memberQualified = (m: TeamMemberCred) =>
    (!requires.nism || m.nismOk) && (!requires.arn || m.arnOk) && (!requires.euin || m.euinOk);
  const qualifiedCount = needs ? team.filter(memberQualified).length : teamCount;

  const gaps: string[] = [];
  if (needs) {
    // Per-cred: is anyone qualified? Which members lack it?
    const credChecks: Array<{ key: "nism" | "arn" | "euin"; label: string; ok: (m: TeamMemberCred) => boolean }> = [
      { key: "nism", label: "NISM", ok: (m) => m.nismOk },
      { key: "arn", label: "ARN", ok: (m) => m.arnOk },
      { key: "euin", label: "EUIN", ok: (m) => m.euinOk },
    ];
    for (const c of credChecks) {
      if (!requires[c.key]) continue;
      const holders = team.filter(c.ok);
      if (team.length === 0) continue; // handled by no_team below
      if (holders.length === 0) {
        gaps.push(`No assigned member holds a current ${c.label}`);
      } else {
        for (const m of team.filter((x) => !c.ok(x))) gaps.push(`${m.name} — ${c.label} missing/expired`);
      }
    }
  }

  let readiness: ReadinessState;
  if (teamCount === 0) readiness = "no_team";
  else if (!needs) readiness = "ready";
  else if (qualifiedCount === 0) readiness = "blocked";
  else if (qualifiedCount < teamCount || gaps.length > 0) readiness = "attention";
  else readiness = "ready";

  return { license, licenses, readiness, requires, unverifiable, qualifiedCount, teamCount, gaps };
}

/** Build a cred-currency map from raw user rows (NISM/ARN/EUIN + expiries). */
export function buildCredMap(
  rows: Array<{
    id: string;
    name: string;
    nismExpiryAt?: string | Date | null;
    nismCertificateNo?: string | null;
    arnExpiryAt?: string | Date | null;
    personalArn?: string | null;
    euinExpiryAt?: string | Date | null;
    euin?: string | null;
  }>
): Map<string, TeamMemberCred> {
  const m = new Map<string, TeamMemberCred>();
  // A cred is "current" when held and either undated or not past expiry.
  const cur = (held: unknown, expiry: string | Date | null | undefined): boolean => {
    if (!held) return false;
    const dl = daysUntil(expiry ?? null);
    return dl == null ? true : dl >= 0;
  };
  for (const r of rows) {
    m.set(r.id, {
      id: r.id,
      name: r.name,
      nismOk: cur(r.nismCertificateNo ?? r.nismExpiryAt, r.nismExpiryAt),
      arnOk: cur(r.personalArn ?? r.arnExpiryAt, r.arnExpiryAt),
      euinOk: cur(r.euin ?? r.euinExpiryAt, r.euinExpiryAt),
    });
  }
  return m;
}
