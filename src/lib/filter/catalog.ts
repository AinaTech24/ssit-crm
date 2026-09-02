/**
 * Field catalog — the source of truth for what is queryable on each subject.
 *
 * Every entry declares:
 *  - `key`: how the AST refers to this field
 *  - `label`: shown in the filter builder UI
 *  - `type`: drives the operator menu + value editor
 *  - `sql`: the SQL fragment to use (must be safe — never user-controlled)
 *  - `ops`: allowed operators (defense in depth — compiler also enforces)
 *  - `valueOptions`: for enum types, the dropdown options
 *
 * To add a new queryable field: add a row here. The UI, compiler, and AI
 * assistant pick it up automatically.
 */

import type { FilterOperator } from "./ast";

export type FieldType =
  | "string"
  | "integer"
  | "number"
  | "currency"
  | "boolean"
  | "date"
  | "datetime"
  | "enum"
  | "multi_enum"
  | "uuid";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  /** Source SQL fragment — referenced unquoted in WHERE clauses. */
  sql: string;
  ops: FilterOperator[];
  enumValues?: string[];
  /** Whether this field can also be used in `update_field` actions. */
  writable?: boolean;
  /** Optional table alias hint for the compiler */
  table?: string;
  /** Help text shown in the UI */
  help?: string;
}

export interface SubjectCatalog {
  subject:
    | "investor"
    | "lead"
    | "task"
    | "folio"
    | "user"
    | "transaction"
    | "sip"
    | "insurance"
    | "goal"
    | "service_request"
    | "claim"
    | "review_meeting"
    | "business_entry";
  /** Primary table + alias used in compiled SQL. */
  table: string;
  alias: string;
  fields: FieldDef[];
  relations: Record<
    string,
    {
      // For correlated subqueries (e.g., "investor has transaction in last 30 days")
      table: string;
      alias: string;
      joinSql: string; // "tx.investor_id = inv.id"
      subjectAlias: string; // alias to use inside the subquery for further nesting
    }
  >;
}

const COMMON_NUMBER_OPS: FilterOperator[] = [
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "not_between",
  "is_null",
  "is_not_null",
];

const COMMON_STRING_OPS: FilterOperator[] = [
  "eq",
  "ne",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "in",
  "not_in",
  "is_empty",
  "is_not_empty",
];

const COMMON_DATE_OPS: FilterOperator[] = [
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "is_null",
  "is_not_null",
  "date_within",
  "date_before",
  "date_after",
  "date_in_next",
  "date_in_last",
  "date_today",
  "date_yesterday",
  "date_tomorrow",
  "date_is_anniversary",
];

const COMMON_ENUM_OPS: FilterOperator[] = ["eq", "ne", "in", "not_in", "is_null", "is_not_null"];

export const investorCatalog: SubjectCatalog = {
  subject: "investor",
  table: "investors",
  alias: "inv",
  fields: [
    { key: "name", label: "Name", type: "string", sql: "inv.name", ops: COMMON_STRING_OPS, writable: true },
    { key: "pan", label: "PAN", type: "string", sql: "inv.pan", ops: COMMON_STRING_OPS },
    { key: "email", label: "Email", type: "string", sql: "inv.email", ops: COMMON_STRING_OPS, writable: true },
    { key: "phone", label: "Phone", type: "string", sql: "inv.phone", ops: COMMON_STRING_OPS, writable: true },
    { key: "city", label: "City", type: "string", sql: "(inv.address->>'city')", ops: COMMON_STRING_OPS },
    { key: "state", label: "State", type: "string", sql: "(inv.address->>'state')", ops: COMMON_STRING_OPS },
    { key: "pincode", label: "Pincode", type: "string", sql: "(inv.address->>'pincode')", ops: COMMON_STRING_OPS },

    {
      key: "investor_category",
      label: "Category",
      type: "enum",
      sql: "inv.investor_category",
      ops: COMMON_ENUM_OPS,
      enumValues: ["individual", "huf", "corporate", "trust", "nri", "minor", "other"],
      writable: true,
    },
    {
      key: "segment_tag",
      label: "Segment",
      type: "enum",
      sql: "inv.segment_tag",
      ops: COMMON_ENUM_OPS,
      enumValues: ["HNI", "Affluent", "Retail", "NRI", "Corporate"],
      writable: true,
    },
    {
      key: "client_category",
      label: "Client Category",
      type: "enum",
      sql: "inv.client_category",
      ops: COMMON_ENUM_OPS,
      enumValues: ["A", "B", "C", "D"],
      writable: true,
      help: "Manually-assigned A/B/C/D client grade.",
    },
    {
      key: "status",
      label: "Status",
      type: "enum",
      sql: "inv.status",
      ops: COMMON_ENUM_OPS,
      enumValues: ["active", "dormant", "exited"],
      writable: true,
    },

    { key: "aum", label: "AUM (₹)", type: "currency", sql: "inv.aum", ops: COMMON_NUMBER_OPS },
    { key: "health_score", label: "Health score (0–100)", type: "integer", sql: "inv.health_score", ops: COMMON_NUMBER_OPS },
    {
      key: "health_band",
      label: "Health band",
      type: "enum",
      sql: "inv.health_band",
      ops: COMMON_ENUM_OPS,
      enumValues: ["green", "amber", "red"],
    },
    {
      key: "active_sip_amount",
      label: "Active SIP (₹)",
      type: "currency",
      sql: "inv.active_sip_amount",
      ops: COMMON_NUMBER_OPS,
    },
    {
      key: "lifetime_inflow",
      label: "Lifetime inflow (₹)",
      type: "currency",
      sql: "inv.lifetime_inflow",
      ops: COMMON_NUMBER_OPS,
    },

    {
      key: "kyc_status",
      label: "KYC status",
      type: "enum",
      sql: "inv.kyc_status",
      ops: COMMON_ENUM_OPS,
      enumValues: ["pending", "verified", "rejected", "expired"],
    },
    { key: "ckyc_expiry_at", label: "CKYC expiry", type: "date", sql: "inv.ckyc_expiry_at", ops: COMMON_DATE_OPS },
    { key: "fatca_expiry_at", label: "FATCA expiry", type: "date", sql: "inv.fatca_expiry_at", ops: COMMON_DATE_OPS },

    {
      key: "risk_profile",
      label: "Risk profile",
      type: "enum",
      sql: "inv.risk_profile",
      ops: COMMON_ENUM_OPS,
      enumValues: ["conservative", "moderate", "aggressive", "very_aggressive"],
    },

    { key: "dob", label: "Date of birth", type: "date", sql: "inv.dob", ops: COMMON_DATE_OPS },
    {
      key: "onboarded_at",
      label: "Onboarded date",
      type: "datetime",
      sql: "inv.onboarded_at",
      ops: COMMON_DATE_OPS,
    },
    {
      key: "last_contact_at",
      label: "Last contact",
      type: "datetime",
      sql: "inv.last_contact_at",
      ops: COMMON_DATE_OPS,
    },
    {
      key: "last_transaction_at",
      label: "Last transaction",
      type: "datetime",
      sql: "inv.last_transaction_at",
      ops: COMMON_DATE_OPS,
    },
    {
      key: "last_review_at",
      label: "Last review meeting",
      type: "datetime",
      sql: "inv.last_review_at",
      ops: COMMON_DATE_OPS,
    },
    {
      key: "next_review_at",
      label: "Next review meeting",
      type: "datetime",
      sql: "inv.next_review_at",
      ops: COMMON_DATE_OPS,
    },

    { key: "rm_id", label: "Relationship manager", type: "uuid", sql: "inv.rm_id", ops: COMMON_ENUM_OPS },
    { key: "branch_id", label: "Branch", type: "uuid", sql: "inv.branch_id", ops: COMMON_ENUM_OPS },

    {
      key: "nominee_name",
      label: "Has nominee",
      type: "string",
      sql: "inv.nominee_name",
      ops: ["is_empty", "is_not_empty", "is_null", "is_not_null"],
    },

    {
      key: "is_minor",
      label: "Is minor",
      type: "boolean",
      sql: "inv.is_minor",
      ops: ["is_true", "is_false"],
    },

    // ============== Computed fields ==============
    {
      key: "days_since_last_contact",
      label: "Days since last contact",
      type: "integer",
      sql: "(now()::date - inv.last_contact_at::date)",
      ops: COMMON_NUMBER_OPS,
    },
    {
      key: "days_since_last_transaction",
      label: "Days since last transaction",
      type: "integer",
      sql: "(now()::date - inv.last_transaction_at::date)",
      ops: COMMON_NUMBER_OPS,
    },
    {
      key: "days_to_review",
      label: "Days to next review",
      type: "integer",
      sql: "(inv.next_review_at::date - now()::date)",
      ops: COMMON_NUMBER_OPS,
    },
    {
      key: "age_years",
      label: "Age (years)",
      type: "integer",
      sql: "(date_part('year', age(inv.dob)))",
      ops: COMMON_NUMBER_OPS,
    },
    {
      key: "has_active_sip",
      label: "Has active SIP",
      type: "boolean",
      sql:
        "(EXISTS (SELECT 1 FROM sips s WHERE s.investor_id = inv.id AND s.tenant_id = inv.tenant_id AND s.status = 'active'))",
      ops: ["is_true", "is_false"],
    },
    {
      key: "has_active_mandate",
      label: "Has active mandate",
      type: "boolean",
      sql:
        "(EXISTS (SELECT 1 FROM mandates m WHERE m.investor_id = inv.id AND m.tenant_id = inv.tenant_id AND m.status = 'active'))",
      ops: ["is_true", "is_false"],
    },
  ],
  relations: {
    transactions: {
      table: "transactions",
      alias: "tx",
      joinSql: "tx.investor_id = inv.id AND tx.tenant_id = inv.tenant_id",
      subjectAlias: "tx",
    },
    sips: {
      table: "sips",
      alias: "s",
      joinSql: "s.investor_id = inv.id AND s.tenant_id = inv.tenant_id",
      subjectAlias: "s",
    },
    folios: {
      table: "folios",
      alias: "f",
      joinSql: "f.investor_id = inv.id AND f.tenant_id = inv.tenant_id",
      subjectAlias: "f",
    },
    goals: {
      table: "goals",
      alias: "g",
      joinSql: "g.investor_id = inv.id AND g.tenant_id = inv.tenant_id",
      subjectAlias: "g",
    },
  },
};

export const leadCatalog: SubjectCatalog = {
  subject: "lead",
  table: "leads",
  alias: "ld",
  fields: [
    { key: "name", label: "Name", type: "string", sql: "ld.name", ops: COMMON_STRING_OPS, writable: true },
    { key: "email", label: "Email", type: "string", sql: "ld.email", ops: COMMON_STRING_OPS, writable: true },
    { key: "phone", label: "Phone", type: "string", sql: "ld.phone", ops: COMMON_STRING_OPS, writable: true },
    {
      key: "stage",
      label: "Stage",
      type: "enum",
      sql: "ld.stage",
      ops: COMMON_ENUM_OPS,
      enumValues: ["new", "contacted", "qualified", "proposal_sent", "converted", "lost", "cold"],
      writable: true,
    },
    {
      key: "source",
      label: "Source",
      type: "enum",
      sql: "ld.source",
      ops: COMMON_ENUM_OPS,
      enumValues: ["website", "referral", "meta_ads", "google_ads", "linkedin", "youtube", "webinar", "event", "walk_in", "manual", "other"],
    },
    { key: "score", label: "Lead score (0–100)", type: "integer", sql: "ld.lead_score", ops: COMMON_NUMBER_OPS },
    {
      key: "score_band",
      label: "Score band",
      type: "enum",
      sql: "ld.score_band",
      ops: COMMON_ENUM_OPS,
      enumValues: ["hot", "warm", "cold"],
    },
    {
      key: "stage_changed_at",
      label: "Stage changed at",
      type: "datetime",
      sql: "ld.stage_changed_at",
      ops: COMMON_DATE_OPS,
    },
    {
      key: "last_contact_at",
      label: "Last contact",
      type: "datetime",
      sql: "ld.last_contact_at",
      ops: COMMON_DATE_OPS,
    },
    {
      key: "next_follow_up_at",
      label: "Next follow-up",
      type: "datetime",
      sql: "ld.next_follow_up_at",
      ops: COMMON_DATE_OPS,
    },
    { key: "owner_id", label: "Owner", type: "uuid", sql: "ld.owner_id", ops: COMMON_ENUM_OPS, writable: true },
    {
      key: "days_in_stage",
      label: "Days in current stage",
      type: "integer",
      sql: "(now()::date - ld.stage_changed_at::date)",
      ops: COMMON_NUMBER_OPS,
    },
  ],
  relations: {},
};

export const taskCatalog: SubjectCatalog = {
  subject: "task",
  table: "tasks",
  alias: "tk",
  fields: [
    { key: "title", label: "Title", type: "string", sql: "tk.title", ops: COMMON_STRING_OPS },
    { key: "type", label: "Type", type: "string", sql: "tk.type", ops: COMMON_STRING_OPS },
    {
      key: "status",
      label: "Status",
      type: "enum",
      sql: "tk.status",
      ops: COMMON_ENUM_OPS,
      enumValues: ["open", "in_progress", "blocked", "completed", "cancelled"],
    },
    {
      key: "priority",
      label: "Priority",
      type: "enum",
      sql: "tk.priority",
      ops: COMMON_ENUM_OPS,
      enumValues: ["low", "normal", "high", "urgent"],
    },
    { key: "assignee_id", label: "Assignee", type: "uuid", sql: "tk.assignee_id", ops: COMMON_ENUM_OPS },
    { key: "due_at", label: "Due date", type: "datetime", sql: "tk.due_at", ops: COMMON_DATE_OPS },
    { key: "sla_due_at", label: "SLA due", type: "datetime", sql: "tk.sla_due_at", ops: COMMON_DATE_OPS },
    {
      key: "days_overdue",
      label: "Days overdue",
      type: "integer",
      sql: "GREATEST(0, (now()::date - tk.due_at::date))",
      ops: COMMON_NUMBER_OPS,
    },
  ],
  relations: {},
};

export const userCatalog: SubjectCatalog = {
  subject: "user",
  table: "users",
  alias: "usr",
  fields: [
    { key: "name", label: "Name", type: "string", sql: "usr.name", ops: COMMON_STRING_OPS },
    { key: "email", label: "Email", type: "string", sql: "usr.email", ops: COMMON_STRING_OPS },
    {
      key: "status",
      label: "Status",
      type: "enum",
      sql: "usr.status",
      ops: COMMON_ENUM_OPS,
      enumValues: ["invited", "active", "suspended", "offboarding", "offboarded"],
    },
    { key: "nism_expiry_at", label: "NISM expiry", type: "date", sql: "usr.nism_expiry_at", ops: COMMON_DATE_OPS },
    { key: "euin", label: "EUIN", type: "string", sql: "usr.euin", ops: COMMON_STRING_OPS },
  ],
  relations: {},
};

/** MF Transactions — purchases, redemptions, switches, SIP debits. */
export const transactionCatalog: SubjectCatalog = {
  subject: "transaction",
  table: "transactions",
  alias: "tx",
  fields: [
    { key: "type", label: "Type", type: "enum", sql: "tx.type", ops: COMMON_ENUM_OPS, enumValues: ["purchase", "redemption", "switch", "sip", "sip_stop", "sip_pause", "stp", "swp", "lumpsum", "dividend_payout", "dividend_reinvest"] },
    { key: "direction", label: "Direction", type: "enum", sql: "tx.direction", ops: COMMON_ENUM_OPS, enumValues: ["inflow", "outflow"] },
    { key: "status", label: "Status", type: "enum", sql: "tx.status", ops: COMMON_ENUM_OPS, enumValues: ["pending", "processed", "rejected", "cancelled", "submitted", "successful", "failed"] },
    { key: "amount", label: "Amount (₹)", type: "currency", sql: "tx.amount", ops: COMMON_NUMBER_OPS },
    { key: "scheme_name", label: "Scheme", type: "string", sql: "tx.scheme_name", ops: COMMON_STRING_OPS },
    { key: "amc_name", label: "AMC", type: "string", sql: "tx.amc_name", ops: COMMON_STRING_OPS },
    { key: "scheme_category", label: "Scheme category", type: "string", sql: "tx.scheme_category", ops: COMMON_STRING_OPS },
    { key: "order_date", label: "Order date", type: "date", sql: "tx.order_date", ops: COMMON_DATE_OPS },
    { key: "exchange", label: "Exchange", type: "enum", sql: "tx.exchange", ops: COMMON_ENUM_OPS, enumValues: ["BSE", "NSE", "MFU", "DIRECT"] },
    { key: "source_feed", label: "Source", type: "enum", sql: "tx.source_feed", ops: COMMON_ENUM_OPS, enumValues: ["manual", "cams", "kfintech", "nse", "mfu", "other", "bse", "import"] },
    { key: "investor_id", label: "Client (id)", type: "uuid", sql: "tx.investor_id", ops: COMMON_ENUM_OPS },
    { key: "created_at", label: "Created", type: "datetime", sql: "tx.created_at", ops: COMMON_DATE_OPS },
  ],
  relations: {},
};

/** SIP book — recurring mandates. */
export const sipCatalog: SubjectCatalog = {
  subject: "sip",
  table: "sips",
  alias: "s",
  fields: [
    { key: "scheme_name", label: "Scheme", type: "string", sql: "s.scheme_name", ops: COMMON_STRING_OPS },
    { key: "amc_name", label: "AMC", type: "string", sql: "s.amc_name", ops: COMMON_STRING_OPS },
    { key: "amount", label: "Amount (₹)", type: "currency", sql: "s.amount", ops: COMMON_NUMBER_OPS },
    { key: "frequency", label: "Frequency", type: "enum", sql: "s.frequency", ops: COMMON_ENUM_OPS, enumValues: ["monthly", "quarterly", "weekly", "fortnightly", "yearly"] },
    { key: "status", label: "Status", type: "enum", sql: "s.status", ops: COMMON_ENUM_OPS, enumValues: ["active", "paused", "stopped", "rejected", "completed", "pending", "expired"] },
    { key: "start_date", label: "Start date", type: "date", sql: "s.start_date", ops: COMMON_DATE_OPS },
    { key: "end_date", label: "End date", type: "date", sql: "s.end_date", ops: COMMON_DATE_OPS },
    { key: "next_installment_at", label: "Next due", type: "date", sql: "s.next_installment_at", ops: COMMON_DATE_OPS },
    { key: "investor_id", label: "Client (id)", type: "uuid", sql: "s.investor_id", ops: COMMON_ENUM_OPS },
    { key: "created_at", label: "Created", type: "datetime", sql: "s.created_at", ops: COMMON_DATE_OPS },
  ],
  relations: {},
};

/** Insurance policies. */
export const insuranceCatalog: SubjectCatalog = {
  subject: "insurance",
  table: "insurance_policies",
  alias: "ip",
  fields: [
    { key: "insurer", label: "Insurer", type: "string", sql: "ip.insurer", ops: COMMON_STRING_OPS },
    { key: "plan_name", label: "Plan", type: "string", sql: "ip.plan_name", ops: COMMON_STRING_OPS },
    { key: "policy_type", label: "Policy type", type: "enum", sql: "ip.policy_type", ops: COMMON_ENUM_OPS, enumValues: ["term", "ulip", "endowment", "money_back", "health", "critical_illness", "personal_accident", "motor", "travel", "home", "life_other", "general_other"] },
    { key: "status", label: "Status", type: "enum", sql: "ip.status", ops: COMMON_ENUM_OPS, enumValues: ["proposed", "in_underwriting", "active", "lapsed", "matured", "surrendered", "cancelled", "claim_filed", "claim_settled"] },
    { key: "sum_assured", label: "Sum assured (₹)", type: "currency", sql: "ip.sum_assured", ops: COMMON_NUMBER_OPS },
    { key: "annual_premium", label: "Annual premium (₹)", type: "currency", sql: "ip.annual_premium", ops: COMMON_NUMBER_OPS },
    { key: "premium_frequency", label: "Premium frequency", type: "enum", sql: "ip.premium_frequency", ops: COMMON_ENUM_OPS, enumValues: ["single", "annual", "semi_annual", "quarterly", "monthly"] },
    { key: "policy_start_date", label: "Start date", type: "date", sql: "ip.policy_start_date", ops: COMMON_DATE_OPS },
    { key: "maturity_date", label: "Maturity", type: "date", sql: "ip.maturity_date", ops: COMMON_DATE_OPS },
    { key: "next_premium_due_date", label: "Next premium due", type: "date", sql: "ip.next_premium_due_date", ops: COMMON_DATE_OPS },
    { key: "investor_id", label: "Client (id)", type: "uuid", sql: "ip.investor_id", ops: COMMON_ENUM_OPS },
    { key: "created_at", label: "Created", type: "datetime", sql: "ip.created_at", ops: COMMON_DATE_OPS },
  ],
  relations: {},
};

/** Financial goals. */
export const goalCatalog: SubjectCatalog = {
  subject: "goal",
  table: "goals",
  alias: "g",
  fields: [
    { key: "name", label: "Goal", type: "string", sql: "g.name", ops: COMMON_STRING_OPS },
    { key: "category", label: "Category", type: "enum", sql: "g.category", ops: COMMON_ENUM_OPS, enumValues: ["retirement", "child_education", "child_marriage", "house", "car", "vacation", "emergency_fund", "wealth_creation", "other"] },
    { key: "status", label: "Status", type: "enum", sql: "g.status", ops: COMMON_ENUM_OPS, enumValues: ["not_started", "on_track", "behind_track", "achieved", "active", "on_hold", "abandoned"] },
    { key: "target_amount", label: "Target (₹)", type: "currency", sql: "g.target_amount", ops: COMMON_NUMBER_OPS },
    { key: "current_value", label: "Current value (₹)", type: "currency", sql: "g.current_value", ops: COMMON_NUMBER_OPS },
    { key: "progress_pct", label: "Progress %", type: "number", sql: "g.progress_pct", ops: COMMON_NUMBER_OPS },
    { key: "target_date", label: "Target date", type: "date", sql: "g.target_date", ops: COMMON_DATE_OPS },
    { key: "next_review_at", label: "Next review", type: "datetime", sql: "g.next_review_at", ops: COMMON_DATE_OPS },
    { key: "investor_id", label: "Client (id)", type: "uuid", sql: "g.investor_id", ops: COMMON_ENUM_OPS },
    { key: "created_at", label: "Created", type: "datetime", sql: "g.created_at", ops: COMMON_DATE_OPS },
  ],
  relations: {},
};

/** Service requests / complaints. */
export const serviceRequestCatalog: SubjectCatalog = {
  subject: "service_request",
  table: "service_requests",
  alias: "sr",
  fields: [
    { key: "ticket_no", label: "Ticket #", type: "string", sql: "sr.ticket_no", ops: COMMON_STRING_OPS },
    { key: "subject", label: "Subject", type: "string", sql: "sr.subject", ops: COMMON_STRING_OPS },
    { key: "type", label: "Type", type: "enum", sql: "sr.type", ops: COMMON_ENUM_OPS, enumValues: ["nominee_update", "bank_update", "mobile_update", "email_update", "kyc_update", "minor_to_major", "capital_gain_report", "statement_request", "redemption_request", "switch_request", "transmission_case", "folio_correction", "complaint", "other"] },
    { key: "status", label: "Status", type: "enum", sql: "sr.status", ops: COMMON_ENUM_OPS, enumValues: ["open", "in_progress", "waiting_customer", "resolved", "closed", "escalated"] },
    { key: "priority", label: "Priority", type: "enum", sql: "sr.priority", ops: COMMON_ENUM_OPS, enumValues: ["low", "normal", "high", "urgent"] },
    { key: "channel", label: "Channel", type: "enum", sql: "sr.channel", ops: COMMON_ENUM_OPS, enumValues: ["whatsapp", "email", "phone", "in_person", "form"] },
    { key: "resolved_at", label: "Resolved at", type: "datetime", sql: "sr.resolved_at", ops: COMMON_DATE_OPS },
    { key: "investor_id", label: "Client (id)", type: "uuid", sql: "sr.investor_id", ops: COMMON_ENUM_OPS },
    { key: "created_at", label: "Created", type: "datetime", sql: "sr.created_at", ops: COMMON_DATE_OPS },
  ],
  relations: {},
};

/** Insurance claims — claim lifecycle + amounts. */
export const claimCatalog: SubjectCatalog = {
  subject: "claim",
  table: "insurance_claims",
  alias: "icl",
  fields: [
    { key: "proposer_name", label: "Proposer", type: "string", sql: "icl.proposer_name", ops: COMMON_STRING_OPS },
    { key: "insurer", label: "Insurer", type: "string", sql: "icl.insurer", ops: COMMON_STRING_OPS },
    { key: "policy_number", label: "Policy number", type: "string", sql: "icl.policy_number", ops: COMMON_STRING_OPS },
    { key: "claim_status", label: "Claim status", type: "enum", sql: "icl.claim_status", ops: COMMON_ENUM_OPS, enumValues: ["empty", "claim_intimated", "file_awaited", "file_received", "add_info_awaited", "query", "query_replied", "under_process", "settled_fully", "settled_partially", "rejected", "withdrawn"] },
    { key: "claim_type", label: "Claim type", type: "enum", sql: "icl.claim_type", ops: COMMON_ENUM_OPS, enumValues: ["main_claim", "supplementary", "pre_authorization", "rider", "other"] },
    { key: "claim_mode", label: "Claim mode", type: "enum", sql: "icl.claim_mode", ops: COMMON_ENUM_OPS, enumValues: ["cashless", "reimbursement"] },
    { key: "claimed_amount", label: "Claimed (₹)", type: "currency", sql: "icl.claimed_amount", ops: COMMON_NUMBER_OPS },
    { key: "settled_amount", label: "Settled (₹)", type: "currency", sql: "icl.settled_amount", ops: COMMON_NUMBER_OPS },
    { key: "intimation_date", label: "Intimation date", type: "date", sql: "icl.intimation_date", ops: COMMON_DATE_OPS },
    { key: "submission_date", label: "Submission date", type: "date", sql: "icl.submission_date", ops: COMMON_DATE_OPS },
    { key: "settlement_date", label: "Settlement date", type: "date", sql: "icl.settlement_date", ops: COMMON_DATE_OPS },
    { key: "investor_id", label: "Client (id)", type: "uuid", sql: "icl.investor_id", ops: COMMON_ENUM_OPS },
    { key: "rm_id", label: "RM (id)", type: "uuid", sql: "icl.rm_id", ops: COMMON_ENUM_OPS },
    { key: "created_at", label: "Created", type: "datetime", sql: "icl.created_at", ops: COMMON_DATE_OPS },
  ],
  relations: {},
};

/** Review meetings — Module 12. rm_name is a correlated lookup so charts can
 *  group by the RM by NAME (not a raw uuid). */
export const reviewMeetingCatalog: SubjectCatalog = {
  subject: "review_meeting",
  table: "review_meetings",
  alias: "mtg",
  fields: [
    { key: "category", label: "Category", type: "enum", sql: "mtg.category", ops: COMMON_ENUM_OPS, enumValues: ["review", "new", "follow_up"] },
    { key: "meeting_type", label: "Agenda / type", type: "enum", sql: "mtg.meeting_type", ops: COMMON_ENUM_OPS },
    { key: "meeting_mode", label: "Mode", type: "enum", sql: "mtg.meeting_mode", ops: COMMON_ENUM_OPS, enumValues: ["office", "client_place", "online", "phone"] },
    { key: "status", label: "Status", type: "enum", sql: "mtg.status", ops: COMMON_ENUM_OPS, enumValues: ["scheduled", "confirmed", "in_progress", "completed", "rescheduled", "cancelled", "no_show"] },
    { key: "outcome", label: "Outcome", type: "enum", sql: "mtg.outcome", ops: COMMON_ENUM_OPS },
    { key: "rm_name", label: "RM", type: "string", sql: "(SELECT u.name FROM users u WHERE u.id = mtg.rm_id)", ops: COMMON_STRING_OPS },
    { key: "rm_id", label: "RM (id)", type: "uuid", sql: "mtg.rm_id", ops: COMMON_ENUM_OPS },
    { key: "meeting_date", label: "Meeting date", type: "datetime", sql: "mtg.meeting_date", ops: COMMON_DATE_OPS },
    { key: "created_at", label: "Created", type: "datetime", sql: "mtg.created_at", ops: COMMON_DATE_OPS },
    { key: "reschedule_count", label: "Reschedules", type: "integer", sql: "mtg.reschedule_count", ops: COMMON_NUMBER_OPS },
    { key: "duration_minutes", label: "Duration (min)", type: "integer", sql: "NULLIF(regexp_replace(COALESCE(mtg.duration_minutes,''), '[^0-9]', '', 'g'), '')::int", ops: COMMON_NUMBER_OPS },
  ],
  relations: {},
};

/** Business Closing Entries — Module: business booked. total_amount is the headline
 *  measure (sum business by RM / month / product). */
export const businessEntryCatalog: SubjectCatalog = {
  subject: "business_entry",
  table: "business_entries",
  alias: "bze",
  fields: [
    { key: "product_type", label: "Product", type: "enum", sql: "bze.product_type", ops: COMMON_ENUM_OPS, enumValues: ["mutual_fund", "pms", "aif", "sif", "bond", "ncd", "other"] },
    { key: "status", label: "Status", type: "enum", sql: "bze.status", ops: COMMON_ENUM_OPS, enumValues: ["draft", "confirmed", "emailed", "cancelled"] },
    { key: "client_name", label: "Client", type: "string", sql: "bze.client_name", ops: COMMON_STRING_OPS },
    { key: "amc_name", label: "AMC", type: "string", sql: "bze.amc_name", ops: COMMON_STRING_OPS },
    { key: "rm_name", label: "RM", type: "string", sql: "(SELECT u.name FROM users u WHERE u.id = bze.rm_id)", ops: COMMON_STRING_OPS },
    { key: "rm_id", label: "RM (id)", type: "uuid", sql: "bze.rm_id", ops: COMMON_ENUM_OPS },
    { key: "business_date", label: "Business date", type: "date", sql: "bze.business_date", ops: COMMON_DATE_OPS },
    { key: "created_at", label: "Created", type: "datetime", sql: "bze.created_at", ops: COMMON_DATE_OPS },
    { key: "total_amount", label: "Total business (₹)", type: "currency", sql: "bze.total_amount", ops: COMMON_NUMBER_OPS },
    { key: "liquid_net", label: "Liquid net (₹)", type: "currency", sql: "bze.liquid_net", ops: COMMON_NUMBER_OPS },
  ],
  relations: {},
};

export const CATALOGS: Record<string, SubjectCatalog> = {
  investor: investorCatalog,
  lead: leadCatalog,
  task: taskCatalog,
  user: userCatalog,
  transaction: transactionCatalog,
  sip: sipCatalog,
  insurance: insuranceCatalog,
  goal: goalCatalog,
  service_request: serviceRequestCatalog,
  claim: claimCatalog,
  review_meeting: reviewMeetingCatalog,
  business_entry: businessEntryCatalog,
};

export function getCatalog(subject: string): SubjectCatalog {
  const cat = CATALOGS[subject];
  if (!cat) throw new Error(`Unknown subject type: ${subject}`);
  return cat;
}

export function getField(subject: string, key: string): FieldDef {
  const cat = getCatalog(subject);
  const f = cat.fields.find((x) => x.key === key);
  if (!f) throw new Error(`Unknown field ${subject}.${key}`);
  return f;
}
