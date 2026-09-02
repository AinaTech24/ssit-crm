/**
 * Firm-profile DDQ / SEBI readiness — scores how complete the firm's
 * regulator-facing record is and lists exactly what's missing, so the owner can
 * close gaps BEFORE an inspector or AMC DDQ finds them. Pure function over the
 * data the firm-profile page already loads (no extra queries).
 */

type Address = { line1?: string; city?: string; state?: string; pincode?: string; country?: string } | null;
type Person = { name?: string } | null;
type Bank = { accountNumber?: string; ifsc?: string } | null;

export type ReadinessItem = {
  key: string;
  label: string;
  ok: boolean;
  critical: boolean;
  href: string;
  hint?: string;
};

export type FirmReadiness = {
  items: ReadinessItem[];
  filled: number;
  total: number;
  pct: number;
  criticalMissing: ReadinessItem[];
  missing: ReadinessItem[];
};

const SELF = "/dashboard/settings/firm-profile";
const LICENSES = "/dashboard/legal-registrations";

export function computeFirmReadiness(input: {
  tenant: {
    legalName?: string | null;
    legalStructure?: string | null;
    incorporationDate?: string | null;
    address?: Address;
    panNumber?: string | null;
    tan?: string | null;
    gstNumber?: string | null;
    arnExpiryAt?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    authorizedSignatory?: Person;
    dataProtectionOfficer?: Person;
    bankAccount?: Bank;
    auditorName?: string | null;
  };
  directorCount: number;
  activeRegistrationCount: number;
}): FirmReadiness {
  const t = input.tenant;
  const addr = t.address ?? null;
  const addressComplete = !!(addr?.line1 && addr?.city && addr?.state && addr?.pincode);
  const arnExpired = !!t.arnExpiryAt && new Date(t.arnExpiryAt).getTime() < Date.now();

  const items: ReadinessItem[] = [
    { key: "legal_name", label: "Legal name", ok: !!t.legalName, critical: true, href: SELF },
    { key: "legal_structure", label: "Legal structure", ok: !!t.legalStructure, critical: true, href: SELF },
    { key: "incorporation_date", label: "Date of incorporation", ok: !!t.incorporationDate, critical: false, href: SELF },
    { key: "registered_address", label: "Registered office address", ok: addressComplete, critical: true, href: SELF, hint: "Full address — line, city, state, PIN" },
    { key: "pan", label: "Firm PAN", ok: !!t.panNumber, critical: true, href: SELF },
    { key: "tan", label: "TAN", ok: !!t.tan, critical: false, href: SELF },
    { key: "gstin", label: "GSTIN", ok: !!t.gstNumber, critical: false, href: SELF },
    { key: "arn_valid", label: "ARN valid (not expired)", ok: !arnExpired, critical: true, href: LICENSES, hint: arnExpired ? "ARN has expired — renew immediately" : undefined },
    { key: "licenses", label: "At least one active registration", ok: input.activeRegistrationCount > 0, critical: false, href: LICENSES },
    { key: "directors", label: "Directors / partners on record", ok: input.directorCount > 0, critical: true, href: SELF },
    { key: "signatory", label: "Authorized signatory", ok: !!t.authorizedSignatory?.name, critical: true, href: SELF },
    { key: "dpo", label: "Data Protection Officer (DPDP)", ok: !!t.dataProtectionOfficer?.name, critical: false, href: SELF, hint: "Required under the DPDP Act" },
    { key: "bank", label: "Firm bank account", ok: !!(t.bankAccount?.accountNumber && t.bankAccount?.ifsc), critical: false, href: SELF },
    { key: "auditor", label: "Statutory auditor", ok: !!t.auditorName, critical: false, href: SELF },
    { key: "phone", label: "Firm phone", ok: !!t.phone, critical: false, href: SELF },
    { key: "email", label: "Firm email", ok: !!t.email, critical: false, href: SELF },
    { key: "website", label: "Website", ok: !!t.website, critical: false, href: SELF },
  ];

  const filled = items.filter((i) => i.ok).length;
  const total = items.length;
  const missing = items.filter((i) => !i.ok);
  return {
    items,
    filled,
    total,
    pct: Math.round((filled / total) * 100),
    criticalMissing: missing.filter((i) => i.critical),
    missing,
  };
}

/** Expiry status for a date string — drives the red/amber alerts. */
export function expiryStatus(date: string | null | undefined, warnDays = 60): { state: "none" | "ok" | "soon" | "expired"; days: number | null } {
  if (!date) return { state: "none", days: null };
  const ms = new Date(date).getTime();
  if (Number.isNaN(ms)) return { state: "none", days: null };
  const days = Math.ceil((ms - Date.now()) / 86_400_000);
  if (days < 0) return { state: "expired", days };
  if (days <= warnDays) return { state: "soon", days };
  return { state: "ok", days };
}
