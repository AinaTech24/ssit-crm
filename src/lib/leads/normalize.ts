export const LEAD_SOURCE_VALUES = [
  "referral",
  "website",
  "social_media",
  "webinar",
  "seminar",
  "walk_in",
  "existing_client",
  "google",
  "cold_call",
  "other",
  "meta_ads",
  "google_ads",
  "linkedin",
  "youtube",
  "event",
  "manual",
] as const;

export type LeadSource = (typeof LEAD_SOURCE_VALUES)[number];

const SOURCE_ALIASES: Record<string, LeadSource> = {
  facebook: "social_media",
  instagram: "social_media",
  social: "social_media",
  socialmedia: "social_media",
  meta: "meta_ads",
  googlead: "google_ads",
  googleads: "google_ads",
  existingclient: "existing_client",
  existing_client_reference: "existing_client",
  client_referral: "referral",
  walkin: "walk_in",
  coldcall: "cold_call",
};

export const CANONICAL_LEAD_STAGES = [
  "new",
  "call_done",
  "call_back_later",
  "call_not_connected",
  "contact_in_future",
  "meeting_scheduled",
  "meeting_pending",
  "meeting_done",
  "won_lead",
  "not_qualified",
  "request_documents",
  "documents_pending",
  "documents_received",
  "kyc_validated",
  "kyc_registered",
  "kyc_pending",
  "modify_kyc",
  "physical_kyc",
  "online_kyc",
  "ucc_create",
  "ucc_activated",
  "mandate_create",
  "mandate_activated",
  "mandate_reject",
  "make_transaction",
  "transaction_successful",
  "transaction_failed",
  "family_mapping",
  "update_information",
  "add_in_review_sheet",
] as const;

export type CanonicalLeadStage = (typeof CANONICAL_LEAD_STAGES)[number];

export const LEAD_PHASE_STAGES: CanonicalLeadStage[] = [
  "new",
  "call_done",
  "call_back_later",
  "call_not_connected",
  "contact_in_future",
  "meeting_scheduled",
  "meeting_pending",
  "meeting_done",
  "won_lead",
  "not_qualified",
];

const STAGE_ALIASES: Record<string, CanonicalLeadStage> = {
  contacted: "call_done",
  first_call_pending: "call_done",
  follow_up: "contact_in_future",
  appointment_scheduled: "meeting_scheduled",
  qualified: "meeting_scheduled",
  proposal_sent: "won_lead",
  proposal_shared: "won_lead",
  proposal_drafted: "won_lead",
  proposal_approved: "won_lead",
  risk_profile_sent: "won_lead",
  risk_profiled: "won_lead",
  docs_requested: "request_documents",
  docs_received: "documents_received",
  converted: "won_lead",
  post_meeting_qualified: "won_lead",
  lost: "not_qualified",
  not_interested: "not_qualified",
  cold: "not_qualified",
  mandate_rejected: "mandate_reject",
};

function keyOf(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function normalizeLeadSource(value: unknown, fallback: LeadSource = "manual"): LeadSource {
  if (typeof value !== "string") return fallback;
  const key = keyOf(value);
  if ((LEAD_SOURCE_VALUES as readonly string[]).includes(key)) return key as LeadSource;
  return SOURCE_ALIASES[key.replace(/_/g, "")] ?? SOURCE_ALIASES[key] ?? fallback;
}

export function normalizeLeadStage(
  value: unknown,
  fallback: CanonicalLeadStage = "new"
): CanonicalLeadStage {
  if (typeof value !== "string") return fallback;
  const key = keyOf(value);
  if ((CANONICAL_LEAD_STAGES as readonly string[]).includes(key)) return key as CanonicalLeadStage;
  return STAGE_ALIASES[key] ?? fallback;
}

export function normalizePhoneLast10(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email ? email : null;
}

export function normalizePan(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const pan = value.trim().toUpperCase();
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan) ? pan : null;
}

export function parseInterestProducts(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value !== "string") return [];
  return value
    .split(/[,\n;|]/g)
    .map((v) => v.trim())
    .filter(Boolean);
}
