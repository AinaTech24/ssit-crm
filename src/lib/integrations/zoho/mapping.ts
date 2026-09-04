/**
 * Field mapping: a domain record → a Zoho record payload, keyed by our entity
 * type. This is the registry you extend to add a module to the sync.
 *
 * Two source modes:
 *   - OUTBOX (investor, lead): the engine reads the record snapshot from
 *     `events_outbox.after`. These two are richly instrumented at the route.
 *   - TABLE  (everything else): the engine polls the module's own table by
 *     `updatedAt` and maps the full row — no per-route instrumentation needed.
 *     Declare `table` on the mapping to opt into this mode.
 *
 * Zoho targets:
 *   - Contacts / Leads / Tasks / Events are NATIVE Zoho modules.
 *   - The rest are CUSTOM modules the MFD creates in their Zoho org. For every
 *     target the MFD adds a single-line external-id field (default
 *     "Equitywala_Record_ID") used for the idempotent upsert, plus the fields named in
 *     `toZoho`. The setup list is surfaced in ZohoIntegrationCard.
 */
import {
  tasks,
  reviewMeetings,
  riskProfileResponses,
  families,
  insurancePolicies,
  insuranceClaims,
  businessEntries,
  sips,
  sipRejections,
  schemeMaster,
} from "@/db/schema";

export const EXTERNAL_ID_FIELD = "Equitywala_Record_ID";

export type ZohoMapping = {
  entityType: string;
  zohoModule: string;
  externalIdField: string;
  /** Build the Zoho payload from our record snapshot (outbox `after` or a table row). */
  toZoho: (after: Record<string, any>) => Record<string, any>;
  /**
   * When set, the engine polls THIS table by `updatedAt` instead of reading
   * events_outbox. The table must expose `id`, `tenantId`, and `updatedAt`.
   */
  table?: any;
};

/** Drop undefined / null / empty-string fields so we never blank out Zoho data. */
function clean(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return out;
}

/** Zoho date field (YYYY-MM-DD). */
function d(v: any): string | undefined {
  if (!v) return undefined;
  const dt = v instanceof Date ? v : new Date(v);
  return Number.isNaN(dt.getTime()) ? undefined : dt.toISOString().slice(0, 10);
}
/** Zoho datetime field (ISO 8601). */
function dtime(v: any): string | undefined {
  if (!v) return undefined;
  const x = v instanceof Date ? v : new Date(v);
  return Number.isNaN(x.getTime()) ? undefined : x.toISOString();
}
/** Zoho number field — coerce our decimal-as-string columns to a number. */
function num(v: any): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// Map our task enums onto Zoho's STOCK Tasks picklist values so the native
// module accepts them without the MFD having to edit picklists (an unknown
// picklist value makes Zoho reject the whole record).
const ZOHO_TASK_STATUS: Record<string, string> = {
  open: "Not Started",
  in_progress: "In Progress",
  blocked: "Waiting on someone else",
  completed: "Completed",
  cancelled: "Deferred",
};
const ZOHO_TASK_PRIORITY: Record<string, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Highest",
};

export const ZOHO_MAPPINGS: ZohoMapping[] = [
  // ─────────────── Outbox-driven (Phase 1) ───────────────
  {
    entityType: "investor",
    zohoModule: "Contacts",
    externalIdField: EXTERNAL_ID_FIELD,
    toZoho: (a) =>
      clean({
        Last_Name: a.name || "Unknown",
        Email: a.email,
        Phone: a.phone || a.mobile,
        Mailing_City: a.city,
        Description: a.pan ? `PAN: ${a.pan}` : undefined,
        [EXTERNAL_ID_FIELD]: a.id,
      }),
  },
  {
    entityType: "lead",
    zohoModule: "Leads",
    externalIdField: EXTERNAL_ID_FIELD,
    toZoho: (a) =>
      clean({
        Last_Name: a.name || "Unknown",
        Email: a.email,
        Phone: a.phone || a.mobile,
        Lead_Status: a.stage,
        Lead_Source: a.source,
        City: a.city,
        [EXTERNAL_ID_FIELD]: a.id,
      }),
  },

  // ─────────────── Table-polled (Phase 2) ───────────────
  {
    entityType: "task",
    zohoModule: "Tasks", // native Zoho Tasks module
    externalIdField: EXTERNAL_ID_FIELD,
    table: tasks,
    toZoho: (r) =>
      clean({
        Subject: r.title || "Task",
        Status: ZOHO_TASK_STATUS[r.status as string],
        Priority: ZOHO_TASK_PRIORITY[r.priority as string],
        Due_Date: d(r.dueAt),
        Description: r.description,
        [EXTERNAL_ID_FIELD]: r.id,
      }),
  },
  {
    entityType: "review_meeting",
    zohoModule: "Meetings", // custom module
    externalIdField: EXTERNAL_ID_FIELD,
    table: reviewMeetings,
    toZoho: (r) =>
      clean({
        Name: r.subject || r.meetingType || "Meeting",
        Meeting_Type: r.meetingType,
        Meeting_Date: dtime(r.meetingDate),
        Status: r.status,
        Outcome: r.outcome,
        Notes: r.meetingNotes,
        [EXTERNAL_ID_FIELD]: r.id,
      }),
  },
  {
    entityType: "risk_profile",
    zohoModule: "Risk_Profiles", // custom module
    externalIdField: EXTERNAL_ID_FIELD,
    table: riskProfileResponses,
    toZoho: (r) =>
      clean({
        Name: r.finalCategory || "Risk Profile",
        Risk_Category: r.finalCategory,
        Total_Score: num(r.totalScore),
        Profile_Date: d(r.profileDate),
        Next_Review: d(r.nextReviewAt),
        [EXTERNAL_ID_FIELD]: r.id,
      }),
  },
  {
    entityType: "family",
    zohoModule: "Families", // custom module
    externalIdField: EXTERNAL_ID_FIELD,
    table: families,
    toZoho: (r) =>
      clean({
        Name: r.familyName || r.headName || "Family",
        Head_Name: r.headName,
        Family_Code: r.familyCode,
        Family_Category: r.familyCategory,
        Health_Score: num(r.healthScore),
        [EXTERNAL_ID_FIELD]: r.id,
      }),
  },
  {
    entityType: "insurance_policy",
    zohoModule: "Insurance_Policies", // custom module
    externalIdField: EXTERNAL_ID_FIELD,
    table: insurancePolicies,
    toZoho: (r) =>
      clean({
        Name: r.planName || r.policyNumber || "Policy",
        Policy_Number: r.policyNumber,
        Insurer: r.insurer,
        Plan_Name: r.planName,
        Policy_Type: r.policyType,
        Sum_Assured: num(r.sumAssured),
        Annual_Premium: num(r.annualPremium),
        Maturity_Date: d(r.maturityDate),
        Status: r.status,
        [EXTERNAL_ID_FIELD]: r.id,
      }),
  },
  {
    entityType: "insurance_claim",
    zohoModule: "Insurance_Claims", // custom module
    externalIdField: EXTERNAL_ID_FIELD,
    table: insuranceClaims,
    toZoho: (r) =>
      clean({
        Name: r.claimType || r.policyNumber || "Claim",
        Policy_Number: r.policyNumber,
        Insurer: r.insurer,
        Claim_Status: r.claimStatus,
        Claim_Type: r.claimType,
        Claimed_Amount: num(r.claimedAmount),
        Settled_Amount: num(r.settledAmount),
        Intimation_Date: d(r.intimationDate),
        [EXTERNAL_ID_FIELD]: r.id,
      }),
  },
  {
    entityType: "business_entry",
    zohoModule: "Business_Entries", // custom module
    externalIdField: EXTERNAL_ID_FIELD,
    table: businessEntries,
    toZoho: (r) =>
      clean({
        Name: r.clientName || r.productType || "Business Entry",
        Client_Name: r.clientName,
        Product_Type: r.productType,
        Platform: r.platform,
        AMC_Name: r.amcName,
        Folio_No: r.folioNo,
        Total_Amount: num(r.totalAmount),
        Business_Date: d(r.businessDate),
        Status: r.status,
        [EXTERNAL_ID_FIELD]: r.id,
      }),
  },
  {
    entityType: "sip",
    zohoModule: "SIPs", // custom module
    externalIdField: EXTERNAL_ID_FIELD,
    table: sips,
    toZoho: (r) =>
      clean({
        Name: r.schemeName || r.folioNumber || "SIP",
        Scheme_Name: r.schemeName,
        AMC_Name: r.amcName,
        Folio_Number: r.folioNumber,
        Amount: num(r.amount),
        Frequency: r.frequency,
        Status: r.status,
        Start_Date: d(r.startDate),
        Next_Installment: d(r.nextInstallmentAt),
        [EXTERNAL_ID_FIELD]: r.id,
      }),
  },
  {
    entityType: "sip_rejection",
    zohoModule: "SIP_Rejections", // custom module
    externalIdField: EXTERNAL_ID_FIELD,
    table: sipRejections,
    toZoho: (r) =>
      clean({
        Name: r.schemeName || "SIP Rejection",
        Scheme_Name: r.schemeName,
        AMC_Name: r.amcName,
        Folio_Number: r.folioNumber,
        Rejection_Amount: num(r.rejectionAmount),
        Rejection_Reason: r.rejectionReason,
        Rejection_Date: d(r.rejectionDate),
        Recovery_Status: r.recoveryStatus,
        [EXTERNAL_ID_FIELD]: r.id,
      }),
  },
  {
    entityType: "scheme",
    zohoModule: "Schemes", // custom module
    externalIdField: EXTERNAL_ID_FIELD,
    table: schemeMaster,
    toZoho: (r) =>
      clean({
        Name: r.schemeName || r.schemeCode || "Scheme",
        Scheme_Code: r.schemeCode,
        AMC_Code: r.amcCode,
        Category: r.category,
        Sub_Category: r.subCategory,
        Risk_Category: r.riskCategory,
        [EXTERNAL_ID_FIELD]: r.id,
      }),
  },
];

const BY_ENTITY = new Map(ZOHO_MAPPINGS.map((m) => [m.entityType, m]));

export function mappingFor(entityType: string): ZohoMapping | undefined {
  return BY_ENTITY.get(entityType);
}

/** Outbox-driven entity types — drives the `events_outbox` query in the engine. */
export const SYNCED_ENTITY_TYPES: string[] = ZOHO_MAPPINGS.filter((m) => !m.table).map((m) => m.entityType);

/** Table-polled mappings — drives the per-table change scan in the engine. */
export const TABLE_MAPPINGS: ZohoMapping[] = ZOHO_MAPPINGS.filter((m) => m.table);
