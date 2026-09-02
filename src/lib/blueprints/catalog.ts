/**
 * Blueprint catalog — the 5 ready-to-use journey templates the engine ships
 * with. Each is module-scoped (the `subject_type` it applies to) and lists
 * its stages + simple forward transitions.
 *
 * Tenants get every blueprint auto-seeded on first use of the relevant
 * module. They can edit stages later via /dashboard/settings/blueprints.
 */

import { LEAD_TO_CLIENT_STAGES, LEAD_TO_CLIENT_TRANSITIONS, LEAD_TO_CLIENT_BLUEPRINT_NAME, type SeedStage } from "./lead_to_client";

export interface BlueprintCatalogEntry {
  /** Subject type — drives the subjectType column on blueprint_instances. */
  subjectType: "lead" | "service_request" | "complaint" | "sip_rejection" | "investor";
  moduleName: string;
  blueprintName: string;
  description?: string;
  stages: SeedStage[];
  transitions: Array<{ from: string; to: string; name: string; allowedRoles?: string[] }>;
}

// ───────────────────────────────────────────────────────────────────────
// Service Request resolution — 6 stages
// ───────────────────────────────────────────────────────────────────────
const SR_STAGES: SeedStage[] = [
  {
    key: "open",
    name: "New Service Request",
    order: 1,
    ownerRole: "back_office",
    requiredFields: ["subject", "type", "investorId"],
    slaDays: 1,
    allowedActions: ["acknowledge", "assign"],
    automationsOnEnter: ["sr_acknowledged_to_client"],
  },
  {
    key: "in_progress",
    name: "In Progress",
    order: 2,
    ownerRole: "back_office",
    requiredFields: ["assignedToUserId"],
    slaDays: 3,
    allowedActions: ["add_note", "request_info_from_client", "escalate"],
  },
  {
    key: "waiting_customer",
    name: "Waiting on Customer",
    order: 3,
    ownerRole: "back_office",
    requiredFields: [],
    slaDays: 5,
    allowedActions: ["resume", "auto_close"],
  },
  {
    key: "escalated",
    name: "Escalated",
    order: 4,
    ownerRole: "owner",
    requiredFields: ["escalatedToUserId"],
    slaDays: 2,
    allowedActions: ["assign_specialist", "resolve"],
    automationsOnEnter: ["sr_escalated_to_owner"],
  },
  {
    key: "resolved",
    name: "Resolved",
    order: 5,
    ownerRole: "back_office",
    requiredFields: ["resolutionNotes"],
    slaDays: 1,
    allowedActions: ["confirm_with_client", "reopen"],
  },
  {
    key: "closed",
    name: "Closed",
    order: 6,
    ownerRole: "back_office",
    requiredFields: [],
    allowedActions: [],
  },
];
const SR_TRANSITIONS = [
  { from: "open", to: "in_progress", name: "Assigned to BO" },
  { from: "in_progress", to: "waiting_customer", name: "Need info from client" },
  { from: "waiting_customer", to: "in_progress", name: "Client responded" },
  { from: "in_progress", to: "escalated", name: "Escalate" },
  { from: "escalated", to: "resolved", name: "Owner resolved" },
  { from: "in_progress", to: "resolved", name: "Resolved" },
  { from: "resolved", to: "closed", name: "Close ticket" },
  { from: "resolved", to: "in_progress", name: "Re-opened" },
];

// ───────────────────────────────────────────────────────────────────────
// Complaint handling (SEBI 21-day TAT) — 8 stages
// ───────────────────────────────────────────────────────────────────────
const COMPLAINT_STAGES: SeedStage[] = [
  {
    key: "logged",
    name: "Complaint Logged",
    order: 1,
    ownerRole: "compliance",
    requiredFields: ["subject", "sebiCategory", "investorId"],
    slaDays: 1,
    allowedActions: ["acknowledge", "assign_rm"],
    automationsOnEnter: ["complaint_acknowledged"],
  },
  {
    key: "under_review",
    name: "Under Review",
    order: 2,
    ownerRole: "compliance",
    requiredFields: ["assignedToUserId"],
    slaDays: 3,
    allowedActions: ["request_documents", "interview_rm"],
  },
  {
    key: "investigation",
    name: "Investigation",
    order: 3,
    ownerRole: "compliance",
    requiredFields: [],
    slaDays: 7,
    allowedActions: ["add_finding", "request_more_info"],
  },
  {
    key: "resolution_proposed",
    name: "Resolution Proposed",
    order: 4,
    ownerRole: "compliance",
    requiredFields: ["resolutionNotes"],
    slaDays: 2,
    allowedActions: ["send_to_client", "owner_review"],
  },
  {
    key: "awaiting_client_acceptance",
    name: "Awaiting Client Acceptance",
    order: 5,
    ownerRole: "compliance",
    requiredFields: [],
    slaDays: 5,
    allowedActions: ["accept", "reject", "escalate_to_sebi"],
  },
  {
    key: "escalated_to_sebi",
    name: "Escalated to SEBI",
    order: 6,
    ownerRole: "owner",
    requiredFields: [],
    slaDays: 30,
    allowedActions: ["sebi_response", "close"],
    automationsOnEnter: ["complaint_sebi_alert"],
  },
  {
    key: "resolved",
    name: "Resolved",
    order: 7,
    ownerRole: "compliance",
    requiredFields: ["resolvedAt"],
    slaDays: 1,
    allowedActions: ["close"],
  },
  {
    key: "closed",
    name: "Closed",
    order: 8,
    ownerRole: "compliance",
    requiredFields: [],
    allowedActions: [],
  },
];
const COMPLAINT_TRANSITIONS = [
  { from: "logged", to: "under_review", name: "Acknowledged + assigned" },
  { from: "under_review", to: "investigation", name: "Move to investigation" },
  { from: "investigation", to: "resolution_proposed", name: "Propose resolution" },
  { from: "resolution_proposed", to: "awaiting_client_acceptance", name: "Sent to client" },
  { from: "awaiting_client_acceptance", to: "resolved", name: "Client accepted" },
  { from: "awaiting_client_acceptance", to: "escalated_to_sebi", name: "Client escalated" },
  { from: "escalated_to_sebi", to: "resolved", name: "SEBI resolved" },
  { from: "resolved", to: "closed", name: "Close" },
];

// ───────────────────────────────────────────────────────────────────────
// SIP rejection recovery — 5 stages
// ───────────────────────────────────────────────────────────────────────
const SIP_RECOVERY_STAGES: SeedStage[] = [
  {
    key: "rejected",
    name: "SIP Rejected",
    order: 1,
    ownerRole: "sales",
    requiredFields: ["rejectionReason", "investorId"],
    slaDays: 1,
    allowedActions: ["log_contact_attempt"],
    automationsOnEnter: ["sip_rejection_followup"],
  },
  {
    key: "client_contacted",
    name: "Client Contacted",
    order: 2,
    ownerRole: "sales",
    requiredFields: [],
    slaDays: 2,
    allowedActions: ["mark_bank_issue", "mark_mandate_issue", "reprocess"],
  },
  {
    key: "issue_identified",
    name: "Issue Identified",
    order: 3,
    ownerRole: "back_office",
    requiredFields: [],
    slaDays: 3,
    allowedActions: ["fix_mandate", "fix_bank_details", "request_new_mandate"],
  },
  {
    key: "reprocessed",
    name: "Re-processed",
    order: 4,
    ownerRole: "back_office",
    requiredFields: [],
    slaDays: 1,
    allowedActions: ["verify_success"],
  },
  {
    key: "recovered",
    name: "Recovered",
    order: 5,
    ownerRole: "sales",
    requiredFields: [],
    allowedActions: [],
  },
];
const SIP_RECOVERY_TRANSITIONS = [
  { from: "rejected", to: "client_contacted", name: "Contacted client" },
  { from: "client_contacted", to: "issue_identified", name: "Issue identified" },
  { from: "issue_identified", to: "reprocessed", name: "Re-processed" },
  { from: "reprocessed", to: "recovered", name: "Confirmed recovered" },
];

// ───────────────────────────────────────────────────────────────────────
// Client review cycle — 4 stages
// ───────────────────────────────────────────────────────────────────────
const REVIEW_STAGES: SeedStage[] = [
  {
    key: "review_due",
    name: "Review Due",
    order: 1,
    ownerRole: "sales",
    requiredFields: ["nextReviewAt"],
    slaDays: 7,
    allowedActions: ["schedule_meeting"],
    automationsOnEnter: ["review_reminder_sent"],
  },
  {
    key: "meeting_scheduled",
    name: "Meeting Scheduled",
    order: 2,
    ownerRole: "sales",
    requiredFields: [],
    slaDays: 14,
    allowedActions: ["confirm_with_client", "reschedule"],
  },
  {
    key: "review_in_progress",
    name: "Review In Progress",
    order: 3,
    ownerRole: "sales",
    requiredFields: [],
    slaDays: 2,
    allowedActions: ["capture_notes", "fan_out_action_items"],
  },
  {
    key: "review_complete",
    name: "Review Complete",
    order: 4,
    ownerRole: "sales",
    requiredFields: ["meetingNotes"],
    allowedActions: [],
    automationsOnEnter: ["schedule_next_review"],
  },
];
const REVIEW_TRANSITIONS = [
  { from: "review_due", to: "meeting_scheduled", name: "Scheduled" },
  { from: "meeting_scheduled", to: "review_in_progress", name: "Meeting started" },
  { from: "review_in_progress", to: "review_complete", name: "Completed" },
];

// ───────────────────────────────────────────────────────────────────────
// Catalog
// ───────────────────────────────────────────────────────────────────────

export const BLUEPRINT_CATALOG: BlueprintCatalogEntry[] = [
  {
    subjectType: "lead",
    moduleName: "leads",
    blueprintName: LEAD_TO_CLIENT_BLUEPRINT_NAME,
    description: "Default lead-to-client journey — 15 stages from new lead through active client.",
    stages: LEAD_TO_CLIENT_STAGES,
    transitions: LEAD_TO_CLIENT_TRANSITIONS,
  },
  {
    subjectType: "service_request",
    moduleName: "service_requests",
    blueprintName: "Service request resolution",
    description: "6-stage SR resolution path with escalation + waiting-customer state.",
    stages: SR_STAGES,
    transitions: SR_TRANSITIONS,
  },
  {
    subjectType: "complaint",
    moduleName: "complaints",
    blueprintName: "Complaint handling (SEBI 21-day TAT)",
    description: "8-stage SEBI-compliant complaint workflow with SEBI-escalation path.",
    stages: COMPLAINT_STAGES,
    transitions: COMPLAINT_TRANSITIONS,
  },
  {
    subjectType: "sip_rejection",
    moduleName: "sip_rejections",
    blueprintName: "SIP rejection recovery",
    description: "5-stage recovery path — contact → identify → fix → re-process → confirm.",
    stages: SIP_RECOVERY_STAGES,
    transitions: SIP_RECOVERY_TRANSITIONS,
  },
  {
    subjectType: "investor",
    moduleName: "client_reviews",
    blueprintName: "Client review cycle",
    description: "Quarterly/half-yearly/yearly review — due → scheduled → in progress → complete.",
    stages: REVIEW_STAGES,
    transitions: REVIEW_TRANSITIONS,
  },
];
