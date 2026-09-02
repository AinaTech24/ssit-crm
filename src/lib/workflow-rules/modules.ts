/**
 * Module catalog for Workflow Rules.
 *
 * Each module declares:
 *   - which events it emits (mapped from events_outbox.kind)
 *   - which fields are queryable in rule criteria
 *   - which fields are writable by Field Update actions
 *   - which date fields trigger Date-based rules
 *   - which numeric fields trigger Score-based rules
 *
 * This is the single source of truth that the UI, the rule matcher, and the
 * action handlers all read from. To add a new module: add an entry here.
 */

export type ModuleKey =
  | "leads"
  | "investors"
  | "families"
  | "tasks"
  | "transactions"
  | "sips"
  | "sip_rejections"
  | "service_requests"
  | "complaints"
  | "review_meetings"
  | "proposals"
  | "insurance"
  | "content_posts"
  | "campaigns"
  | "goals"
  | "onboarding"
  | "risk_profiles"
  | "business_entries";

export type ModuleFieldType =
  | "string"
  | "text"
  | "integer"
  | "number"
  | "currency"
  | "boolean"
  | "date"
  | "datetime"
  | "enum"
  | "phone"
  | "email"
  | "uuid";

export interface ModuleField {
  key: string;
  /** Real DB column to query for date/score scans when it differs from `key`
   *  (e.g. a "Last Activity" catalog field backed by the `updated_at` column).
   *  Defaults to `key`. */
  column?: string;
  label: string;
  type: ModuleFieldType;
  /** Allowed in criteria (default true) */
  filterable?: boolean;
  /** Allowed in `update_field` actions */
  writable?: boolean;
  /** Allowed as the trigger-anchor for date-based rules */
  dateAnchor?: boolean;
  /** Allowed as the score field for score-based rules */
  scoreField?: boolean;
  /** Enum values (for type='enum') */
  enumValues?: string[];
  /** Optional help text shown in the UI */
  help?: string;
}

export interface ModuleCatalog {
  key: ModuleKey;
  label: string;
  /** Database table name */
  table: string;
  /** Subject type used in events_outbox.entity_type */
  entityType: string;
  /** Event-kind prefix this module emits (e.g. "investor" → "investor.*") */
  eventPrefix: string;
  /** All recognised record_action event suffixes for this module. */
  actionEvents: { create: string; edit: string; delete?: string };
  fields: ModuleField[];
}

const ID = (overrides: Partial<ModuleField> = {}): ModuleField => ({
  key: "id",
  label: "ID",
  type: "uuid",
  filterable: false,
  ...overrides,
});
const CREATED = (): ModuleField => ({
  key: "created_at",
  label: "Created Time",
  type: "datetime",
  dateAnchor: true,
});
const UPDATED = (): ModuleField => ({
  key: "updated_at",
  label: "Modified Time",
  type: "datetime",
  dateAnchor: true,
});

export const MODULES: Record<ModuleKey, ModuleCatalog> = {
  leads: {
    key: "leads",
    label: "Leads",
    table: "leads",
    entityType: "lead",
    eventPrefix: "lead",
    actionEvents: { create: "lead.created", edit: "lead.updated", delete: "lead.deleted" },
    fields: [
      ID(),
      { key: "name", label: "Name", type: "string", writable: true },
      { key: "phone", label: "Phone", type: "phone", writable: true },
      { key: "email", label: "Email", type: "email", writable: true },
      {
        key: "stage",
        label: "Stage",
        type: "enum",
        writable: true,
        enumValues: [
          "new",
          "contacted",
          "meeting_scheduled",
          "proposal_shared",
          "follow_up",
          "won_lead",
          "converted",
          "lost",
          "not_interested",
        ],
      },
      {
        key: "pipeline",
        label: "Pipeline (product branch)",
        type: "enum",
        enumValues: ["mf", "insurance", "general"],
        help: "Set from the primary product when a lead is Won",
      },
      {
        key: "source",
        label: "Source",
        type: "enum",
        writable: true,
        enumValues: [
          "referral",
          "existing_client",
          "website",
          "social_media",
          "webinar",
          "seminar",
          "walk_in",
          "google",
          "cold_call",
          "manual",
          "other",
        ],
      },
      { key: "owner_id", label: "Owner", type: "uuid", writable: true },
      { key: "score", label: "Lead Score", type: "integer", writable: true, scoreField: true },
      { key: "last_activity_at", column: "updated_at", label: "Last Activity Time", type: "datetime", dateAnchor: true },
      // ── Client / prospect details ──
      { key: "pan", label: "PAN", type: "string", writable: true },
      { key: "city", label: "City", type: "string", writable: true },
      { key: "lead_type", label: "Lead Type", type: "string", writable: true },
      { key: "alt_phone", label: "Alternate Phone", type: "phone", writable: true },
      { key: "intended_amount", label: "Intended Amount", type: "currency", writable: true, scoreField: true },
      { key: "expected_business_amount", label: "Expected Business (₹)", type: "currency", writable: true, scoreField: true },
      { key: "aum_potential", label: "AUM Potential", type: "currency", writable: true, scoreField: true },
      { key: "referred_by_name", label: "Referred By", type: "string", writable: true },
      { key: "last_contact_at", label: "Last Contacted", type: "datetime", dateAnchor: true },
      { key: "last_follow_up_at", label: "Last Follow-up", type: "datetime", dateAnchor: true },
      { key: "next_follow_up_at", label: "Next Follow-up", type: "datetime", writable: true, dateAnchor: true },
      { key: "converted_at", label: "Converted On", type: "datetime", dateAnchor: true },
      { key: "lost_reason", label: "Lost Reason", type: "string", writable: true },
      CREATED(),
      UPDATED(),
    ],
  },

  investors: {
    key: "investors",
    label: "Investors / Clients",
    table: "investors",
    entityType: "investor",
    eventPrefix: "investor",
    actionEvents: { create: "investor.created", edit: "investor.updated", delete: "investor.deleted" },
    fields: [
      ID(),
      { key: "name", label: "Name", type: "string", writable: true },
      { key: "pan", label: "PAN", type: "string", writable: true },
      { key: "phone", label: "Phone", type: "phone", writable: true },
      { key: "email", label: "Email", type: "email", writable: true },
      {
        key: "segment_tag",
        label: "Segment",
        type: "enum",
        writable: true,
        enumValues: ["HNI", "Affluent", "Retail", "NRI", "Corporate"],
      },
      {
        key: "service_tier",
        label: "Service Tier",
        type: "enum",
        writable: true,
        enumValues: ["A", "B", "C"],
      },
      {
        key: "kyc_status",
        label: "KYC Status",
        type: "enum",
        writable: true,
        enumValues: ["verified", "pending", "expired", "rejected"],
      },
      {
        key: "status",
        label: "Status",
        type: "enum",
        writable: true,
        enumValues: ["active", "dormant", "inactive", "deceased", "closed"],
      },
      { key: "aum", label: "AUM", type: "currency", writable: false, scoreField: true },
      { key: "active_sip_amount", label: "Active SIP Amount", type: "currency", scoreField: true },
      { key: "rm_id", label: "Relationship Manager", type: "uuid", writable: true },
      { key: "date_of_birth", column: "dob", label: "Date of Birth", type: "date", dateAnchor: true },
      { key: "kyc_expires_at", column: "ckyc_expiry_at", label: "KYC Expiry", type: "date", dateAnchor: true },
      { key: "next_review_at", label: "Next Review Date", type: "date", dateAnchor: true },
      { key: "last_review_at", label: "Last Review Date", type: "datetime", dateAnchor: true },
      { key: "onboarded_at", label: "Onboarded On", type: "datetime", dateAnchor: true },
      { key: "last_transaction_at", label: "Last Transaction", type: "datetime", dateAnchor: true },
      CREATED(),
      UPDATED(),
    ],
  },

  families: {
    key: "families",
    label: "Families",
    table: "families",
    entityType: "family",
    eventPrefix: "family",
    actionEvents: { create: "family.created", edit: "family.updated" },
    fields: [
      ID(),
      { key: "family_name", label: "Family Name", type: "string", writable: true },
      { key: "head_name", label: "Family Head", type: "string", writable: true },
      { key: "rm_id", label: "RM", type: "uuid", writable: true },
      { key: "next_review_at", label: "Next Review Date", type: "date", dateAnchor: true },
      CREATED(),
      UPDATED(),
    ],
  },

  tasks: {
    key: "tasks",
    label: "Tasks",
    table: "tasks",
    entityType: "task",
    eventPrefix: "task",
    actionEvents: { create: "task.created", edit: "task.updated", delete: "task.deleted" },
    fields: [
      ID(),
      { key: "title", label: "Title", type: "string", writable: true },
      { key: "type", label: "Type", type: "string", writable: true },
      {
        key: "priority",
        label: "Priority",
        type: "enum",
        writable: true,
        enumValues: ["urgent", "high", "normal", "low"],
      },
      {
        key: "status",
        label: "Status",
        type: "enum",
        writable: true,
        enumValues: ["open", "in_progress", "done", "cancelled"],
      },
      {
        key: "department",
        label: "Department",
        type: "enum",
        writable: true,
        enumValues: [
          "sales",
          "back_office",
          "compliance",
          "marketing",
          "service",
          "operations",
          "rm",
          "admin",
          "other",
        ],
      },
      { key: "assignee_id", label: "Assignee", type: "uuid", writable: true },
      { key: "due_at", label: "Due Date", type: "datetime", dateAnchor: true },
      { key: "sla_due_at", label: "SLA Due", type: "datetime", dateAnchor: true },
      CREATED(),
      UPDATED(),
    ],
  },

  transactions: {
    key: "transactions",
    label: "MF Transactions",
    table: "transactions",
    entityType: "transaction",
    eventPrefix: "transaction",
    actionEvents: { create: "transaction.created", edit: "transaction.updated" },
    fields: [
      ID(),
      { key: "investor_id", label: "Investor", type: "uuid" },
      {
        key: "type",
        label: "Type",
        type: "enum",
        enumValues: ["sip", "lumpsum", "redemption", "switch", "stp", "swp"],
      },
      {
        key: "status",
        label: "Status",
        type: "enum",
        enumValues: ["pending", "successful", "processed", "rejected", "failed"],
      },
      { key: "amount", label: "Amount", type: "currency", scoreField: true },
      { key: "transaction_date", label: "Transaction Date", type: "date", dateAnchor: true },
      CREATED(),
    ],
  },

  sips: {
    key: "sips",
    label: "SIPs",
    table: "sips",
    entityType: "sip",
    eventPrefix: "sip",
    actionEvents: { create: "sip.created", edit: "sip.updated" },
    fields: [
      ID(),
      {
        key: "status",
        label: "Status",
        type: "enum",
        enumValues: ["active", "paused", "stopped", "rejected", "completed", "pending", "expired"],
      },
      { key: "amount", label: "SIP Amount", type: "currency", scoreField: true },
      {
        key: "frequency",
        label: "Frequency",
        type: "enum",
        enumValues: ["monthly", "quarterly", "weekly", "fortnightly", "yearly"],
      },
      { key: "start_date", label: "Start Date", type: "date", dateAnchor: true },
      { key: "end_date", label: "End Date", type: "date", dateAnchor: true },
      { key: "next_installment_at", label: "Next Installment", type: "datetime", dateAnchor: true },
      CREATED(),
      UPDATED(),
    ],
  },

  sip_rejections: {
    key: "sip_rejections",
    label: "SIP Rejections",
    table: "sip_rejections",
    entityType: "sip_rejection",
    eventPrefix: "sip_rejection",
    actionEvents: { create: "sip_rejection.created", edit: "sip_rejection.updated" },
    fields: [
      ID(),
      { key: "investor_id", label: "Investor", type: "uuid" },
      { key: "rejection_amount", label: "Amount", type: "currency" },
      { key: "rejection_reason", label: "Reason", type: "string" },
      {
        key: "recovery_status",
        label: "Recovery Status",
        type: "enum",
        writable: true,
        enumValues: [
          "pending",
          "client_contacted",
          "bank_issue",
          "mandate_issue",
          "reprocessed",
          "recovered",
          "not_recoverable",
        ],
      },
      { key: "rejection_date", label: "Rejection Date", type: "date", dateAnchor: true },
      { key: "follow_up_date", label: "Follow-up Date", type: "date", dateAnchor: true },
      CREATED(),
      UPDATED(),
    ],
  },

  service_requests: {
    key: "service_requests",
    label: "Service Requests",
    table: "service_requests",
    entityType: "service_request",
    eventPrefix: "service_request",
    actionEvents: { create: "service_request.created", edit: "service_request.updated" },
    fields: [
      ID(),
      { key: "ticket_no", label: "Ticket No", type: "string" },
      { key: "subject", label: "Subject", type: "string", writable: true },
      { key: "type", label: "Type", type: "string", writable: true },
      {
        key: "priority",
        label: "Priority",
        type: "enum",
        writable: true,
        enumValues: ["urgent", "high", "normal", "low"],
      },
      {
        key: "status",
        label: "Status",
        type: "enum",
        writable: true,
        enumValues: ["open", "in_progress", "waiting_customer", "escalated", "resolved", "closed"],
      },
      { key: "assigned_to_user_id", label: "Assignee", type: "uuid", writable: true },
      { key: "sla_resolution_at", label: "SLA Deadline", type: "datetime", dateAnchor: true },
      CREATED(),
      UPDATED(),
    ],
  },

  complaints: {
    key: "complaints",
    label: "Complaints",
    table: "service_requests",
    entityType: "complaint",
    eventPrefix: "complaint",
    actionEvents: { create: "complaint.created", edit: "complaint.updated" },
    fields: [
      ID(),
      { key: "subject", label: "Subject", type: "string" },
      { key: "sebi_category", label: "SEBI Category", type: "string", writable: true },
      {
        key: "priority",
        label: "Priority",
        type: "enum",
        writable: true,
        enumValues: ["urgent", "high", "normal", "low"],
      },
      {
        key: "status",
        label: "Status",
        type: "enum",
        writable: true,
        enumValues: ["open", "in_progress", "waiting_customer", "escalated", "resolved", "closed"],
      },
      { key: "sla_resolution_at", label: "SLA Deadline", type: "datetime", dateAnchor: true },
      CREATED(),
    ],
  },

  review_meetings: {
    key: "review_meetings",
    label: "Meetings",
    table: "review_meetings",
    entityType: "review_meeting",
    eventPrefix: "review_meeting",
    actionEvents: { create: "review_meeting.created", edit: "review_meeting.updated" },
    fields: [
      ID(),
      {
        key: "category",
        label: "Category",
        type: "enum",
        enumValues: ["review", "new", "follow_up"],
      },
      { key: "meeting_type", label: "Meeting Type", type: "string" },
      {
        key: "status",
        label: "Status",
        type: "enum",
        writable: true,
        enumValues: [
          "scheduled",
          "confirmed",
          "in_progress",
          "completed",
          "rescheduled",
          "cancelled",
          "no_show",
        ],
      },
      { key: "meeting_date", label: "Meeting Date", type: "datetime", dateAnchor: true },
      { key: "next_review_date", label: "Next Review", type: "date", dateAnchor: true },
      { key: "reminder_task_id", label: "Reminder set", type: "uuid", help: "Set when a reminder was added to the meeting" },
      { key: "discussion_points", label: "Discussion points (agenda)", type: "text" },
      CREATED(),
    ],
  },

  proposals: {
    key: "proposals",
    label: "Proposals",
    table: "proposals",
    entityType: "proposal",
    eventPrefix: "proposal",
    actionEvents: { create: "proposal.created", edit: "proposal.updated" },
    fields: [
      ID(),
      { key: "proposal_number", label: "Number", type: "string" },
      { key: "title", label: "Title", type: "string" },
      {
        key: "type",
        label: "Type",
        type: "enum",
        enumValues: ["comprehensive", "mutual_fund", "insurance", "pms", "aif", "mixed"],
      },
      {
        key: "status",
        label: "Status",
        type: "enum",
        writable: true,
        enumValues: ["draft", "ready", "sent", "viewed", "accepted", "rejected", "expired"],
      },
      { key: "total_investment", label: "Total Investment", type: "currency" },
      { key: "valid_until", label: "Valid Until", type: "date", dateAnchor: true },
      { key: "sent_at", label: "Sent At", type: "datetime", dateAnchor: true },
      CREATED(),
    ],
  },

  insurance: {
    key: "insurance",
    label: "Insurance Policies",
    table: "insurance_policies",
    entityType: "insurance_policy",
    eventPrefix: "insurance_policy",
    actionEvents: { create: "insurance_policy.created", edit: "insurance_policy.updated" },
    fields: [
      ID(),
      { key: "policy_number", label: "Policy Number", type: "string" },
      { key: "insurer", label: "Insurer", type: "string" },
      { key: "policy_type", label: "Policy Type", type: "enum", enumValues: ["term", "ulip", "endowment", "money_back", "health", "critical_illness", "personal_accident", "motor", "travel", "home"] },
      {
        key: "status",
        label: "Status",
        type: "enum",
        writable: true,
        enumValues: ["proposed", "in_underwriting", "active", "lapsed", "matured", "surrendered", "cancelled", "claim_filed", "claim_settled"],
      },
      { key: "sum_assured", label: "Sum Assured", type: "currency", scoreField: true },
      { key: "annual_premium", label: "Annual Premium", type: "currency", scoreField: true },
      { key: "policy_start_date", label: "Start Date", type: "date", dateAnchor: true },
      { key: "maturity_date", label: "Maturity Date", type: "date", dateAnchor: true },
      { key: "next_premium_due_date", label: "Next Premium Due", type: "date", dateAnchor: true },
      CREATED(),
    ],
  },

  content_posts: {
    key: "content_posts",
    label: "Social Posts",
    table: "content_posts",
    entityType: "content_post",
    eventPrefix: "content_post",
    actionEvents: { create: "content_post.created", edit: "content_post.updated" },
    fields: [
      ID(),
      { key: "topic", label: "Topic", type: "string" },
      { key: "platform", label: "Platform", type: "enum", enumValues: ["instagram", "facebook", "linkedin", "youtube", "x_twitter", "whatsapp_status", "telegram", "blog", "other"] },
      {
        key: "approval_status",
        label: "Approval",
        type: "enum",
        writable: true,
        enumValues: ["pending", "in_review", "approved", "rejected", "not_required"],
      },
      {
        key: "posted_status",
        label: "Posted Status",
        type: "enum",
        writable: true,
        enumValues: ["not_posted", "scheduled", "posted", "failed", "cancelled"],
      },
      { key: "compliance_checked", label: "Compliance Checked", type: "boolean", writable: true },
      { key: "content_date", label: "Content Date", type: "date", dateAnchor: true },
      CREATED(),
    ],
  },

  campaigns: {
    key: "campaigns",
    label: "Marketing Campaigns",
    table: "campaigns",
    entityType: "campaign",
    eventPrefix: "campaign",
    actionEvents: { create: "campaign.created", edit: "campaign.updated" },
    fields: [
      ID(),
      { key: "name", label: "Name", type: "string" },
      {
        key: "kind",
        label: "Type",
        type: "enum",
        enumValues: ["social_media", "whatsapp", "email", "sms", "webinar", "seminar", "referral", "google_business", "paid_ads", "content", "other"],
      },
      {
        key: "status",
        label: "Status",
        type: "enum",
        writable: true,
        enumValues: ["draft", "scheduled", "sending", "sent", "paused", "cancelled"],
      },
      { key: "leads_generated", label: "Leads Generated", type: "integer", scoreField: true },
      { key: "start_date", label: "Start Date", type: "datetime", dateAnchor: true },
      { key: "end_date", label: "End Date", type: "datetime", dateAnchor: true },
      CREATED(),
    ],
  },

  goals: {
    key: "goals",
    label: "Goals",
    table: "goals",
    entityType: "goal",
    eventPrefix: "goal",
    actionEvents: { create: "goal.created", edit: "goal.updated" },
    fields: [
      ID(),
      { key: "investor_id", label: "Investor", type: "uuid" },
      { key: "name", label: "Goal Name", type: "string" },
      { key: "target_amount", label: "Target Amount", type: "currency" },
      { key: "target_date", label: "Target Date", type: "date", dateAnchor: true },
      CREATED(),
    ],
  },

  onboarding: {
    key: "onboarding",
    label: "Onboarding",
    table: "onboarding_pipelines",
    entityType: "onboarding",
    eventPrefix: "onboarding",
    actionEvents: { create: "onboarding.created", edit: "onboarding.updated" },
    fields: [
      ID(),
      { key: "stage", label: "Stage", type: "string", writable: true },
      CREATED(),
      UPDATED(),
    ],
  },

  risk_profiles: {
    key: "risk_profiles",
    label: "Risk Profiles",
    table: "risk_profile_responses",
    entityType: "risk_profile",
    eventPrefix: "risk_profile",
    actionEvents: { create: "risk_profile.created", edit: "risk_profile.updated" },
    fields: [
      ID(),
      { key: "category", label: "Risk Category", type: "string" },
      { key: "score", label: "Score", type: "integer", scoreField: true },
      { key: "expires_at", label: "Expires At", type: "date", dateAnchor: true },
      CREATED(),
    ],
  },

  business_entries: {
    key: "business_entries",
    label: "Business Entries",
    table: "business_entries",
    entityType: "business_entry",
    eventPrefix: "business_entry",
    actionEvents: { create: "business_entry.created", edit: "business_entry.updated" },
    fields: [
      ID(),
      { key: "client_name", label: "Client Name", type: "string" },
      { key: "investor_id", label: "Client", type: "uuid" },
      {
        key: "product_type",
        label: "Product Type",
        type: "enum",
        enumValues: ["mutual_fund", "direct_equity", "pms", "aif", "sif", "bond", "ncd", "p2p", "las", "other"],
      },
      {
        key: "status",
        label: "Status",
        type: "enum",
        enumValues: ["draft", "confirmed", "emailed", "cancelled"],
      },
      { key: "total_amount", label: "Total Amount", type: "currency", scoreField: true },
      { key: "amc_name", label: "AMC", type: "string" },
      { key: "platform", label: "Platform", type: "string" },
      { key: "rm_id", label: "RM", type: "uuid" },
      { key: "business_date", label: "Business Date", type: "date", dateAnchor: true },
      CREATED(),
      UPDATED(),
    ],
  },
};

export function getModule(key: string): ModuleCatalog | undefined {
  return MODULES[key as ModuleKey];
}

export function getField(moduleKey: string, fieldKey: string): ModuleField | undefined {
  return getModule(moduleKey)?.fields.find((f) => f.key === fieldKey);
}

export const MODULE_LIST = Object.values(MODULES);
