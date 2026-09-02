/**
 * Predefined Workflow Rules — a starter library every MFD sees and can activate.
 *
 * These are NOT seeded per tenant. The Rule Library page renders this catalog;
 * "Add to my rules" copies the chosen template into the tenant's workflow_rules
 * (created DISABLED so the MFD reviews it — and picks their own message template
 * for comms actions — before turning it on).
 *
 * Pure data only (no DB/server imports) so both the server page and the activate
 * API can import it.
 */

import type { WorkflowRuleInput } from "./types";

export interface PredefinedRule {
  key: string;
  title: string;
  description: string;
  category: "SIP" | "Leads" | "Clients" | "Service";
  /** Comms actions need an approved message template the MFD picks after adding. */
  needsTemplate: boolean;
  rule: WorkflowRuleInput;
}

const base = {
  criteriaPattern: null as string | null,
  scheduledActions: [] as WorkflowRuleInput["scheduledActions"],
  branches: [] as WorkflowRuleInput["branches"],
  enabled: false, // always added disabled — MFD reviews + enables
  executionOrder: 100,
};

export const PREDEFINED_RULES: PredefinedRule[] = [
  {
    key: "lead_welcome_email",
    title: "Welcome email to a new lead",
    description:
      "When a lead is created, email them a thank-you for connecting. If the lead came from a client referral, the email also thanks the referring client by name. Email templates are created for you automatically.",
    category: "Leads",
    needsTemplate: false, // both email templates are auto-provisioned on add
    rule: {
      ...base,
      module: "leads",
      name: "Welcome email to new lead",
      description: "Thank a new lead for connecting (names the referrer if any).",
      triggerType: "record_action",
      triggerConfig: { when: "create", fields: [], repeat: false },
      // Branch 0 (main criteria): referred by a client → referral-aware template.
      criteriaRows: [{ field: "referred_by_name", operator: "is_not_empty" }],
      instantActions: [
        { type: "send_email", label: "Email the lead (referred)", config: { templateKey: "lead_welcome_referral", category: "transactional", recipient: "subject" } },
      ],
      // Branch 1 (catch-all): no referral → plain welcome.
      branches: [
        {
          name: "No referral",
          criteriaPattern: null,
          criteriaRows: [],
          instantActions: [
            { type: "send_email", label: "Email the lead", config: { templateKey: "lead_welcome", category: "transactional", recipient: "subject" } },
          ],
          scheduledActions: [],
        },
      ],
    },
  },
  {
    key: "won_lead_mf_risk_profile",
    title: "Won Lead (Mutual Funds) → send risk profile form",
    description:
      "When a lead is marked Won with Mutual Funds as the primary product, email the client a private link to complete their risk profile. Template + link auto-created.",
    category: "Leads",
    needsTemplate: false,
    rule: {
      ...base,
      module: "leads",
      name: "Won Lead (MF) — risk profile request",
      description: "On a won MF lead, email the client a risk-profile form link.",
      triggerType: "record_action",
      // Fires when the lead's stage edits to 'won_lead' (the won flow emits lead.updated).
      triggerConfig: { when: "edit", editMode: "specific", fields: [], fieldConditions: [{ field: "stage", operator: "is", value: "won_lead" }], repeat: false },
      // …only for the Mutual Funds branch.
      criteriaRows: [{ field: "pipeline", operator: "is", value: "mf" }],
      instantActions: [
        {
          type: "send_email",
          label: "Email the client a risk-profile link",
          config: { templateKey: "risk_profile_request", category: "transactional", recipient: "subject", shareLink: "risk_profile" },
        },
      ],
    },
  },
  {
    key: "client_doc_checklist",
    title: "New client → request onboarding documents",
    description:
      "When a client is created (onboarding starts), email them a document checklist with a secure upload link. Gated to KYC-pending clients. Template + link auto-created. Note: don't also use the manual 'Send Doc Checklist' button for the same client, or they get it twice.",
    category: "Service",
    needsTemplate: false,
    rule: {
      ...base,
      module: "investors",
      name: "Onboarding document request",
      description: "Email a new (KYC-pending) client the onboarding document checklist + upload link.",
      triggerType: "record_action",
      triggerConfig: { when: "create", fields: [], repeat: false },
      criteriaRows: [{ field: "kyc_status", operator: "is", value: "pending" }],
      instantActions: [
        {
          type: "send_email",
          label: "Email the client a document upload link",
          config: { templateKey: "doc_checklist", category: "transactional", recipient: "subject", shareLink: "document_collection" },
        },
      ],
    },
  },
  {
    key: "meeting_scheduled_confirmation",
    title: "Meeting scheduled → confirm to client",
    description:
      "When a meeting is created with status Scheduled, email the client a confirmation naming the RM and the meeting time. Template auto-created.",
    category: "Service",
    needsTemplate: false,
    rule: {
      ...base,
      module: "review_meetings",
      name: "Meeting scheduled confirmation",
      description: "Confirm a newly-scheduled meeting to the client.",
      triggerType: "record_action",
      triggerConfig: { when: "create", fields: [], repeat: false },
      criteriaRows: [{ field: "status", operator: "is", value: "scheduled" }],
      instantActions: [{ type: "send_email", label: "Email the client", config: { templateKey: "meeting_scheduled", category: "transactional", recipient: "subject" } }],
    },
  },
  {
    key: "meeting_reminder",
    title: "Meeting reminder (if reminder set)",
    description:
      "1 day before a scheduled meeting that has a reminder set, email the client a reminder naming the RM and time. Template auto-created. Remove the 'Reminder set' condition to remind every scheduled meeting.",
    category: "Service",
    needsTemplate: false,
    rule: {
      ...base,
      module: "review_meetings",
      name: "Meeting reminder",
      description: "Remind the client 1 day before a scheduled meeting (when a reminder is set).",
      triggerType: "date_field",
      triggerConfig: { field: "meeting_date", when: "before", offset: 1, unit: "day", recurrence: "once", time: "09:00" },
      criteriaRows: [
        { field: "status", operator: "is", value: "scheduled" },
        { field: "reminder_task_id", operator: "is_not_empty" },
      ],
      instantActions: [{ type: "send_email", label: "Email the client", config: { templateKey: "meeting_reminder", category: "utility", recipient: "subject" } }],
    },
  },
  {
    key: "meeting_minutes_thankyou",
    title: "Meeting completed → AI minutes + thank-you",
    description:
      "When a meeting is marked Completed and the Discussion points (agenda) box isn't empty, email the client a thank-you (naming the RM) with AI-written minutes of meeting generated from the agenda. Template auto-created.",
    category: "Service",
    needsTemplate: false,
    rule: {
      ...base,
      module: "review_meetings",
      name: "Meeting minutes + thank-you",
      description: "On meeting completion, email the client AI-written minutes of meeting.",
      triggerType: "record_action",
      // Fire when status is edited to 'completed'.
      triggerConfig: { when: "edit", editMode: "specific", fields: [], fieldConditions: [{ field: "status", operator: "is", value: "completed" }], repeat: false },
      // …only if the agenda box has content to summarise.
      criteriaRows: [{ field: "discussion_points", operator: "is_not_empty" }],
      instantActions: [
        {
          type: "send_email",
          label: "Email the client minutes of meeting",
          config: { templateKey: "meeting_minutes", category: "transactional", recipient: "subject", aiMinutesFrom: "discussion_points" },
        },
      ],
    },
  },
  {
    key: "business_entry_confirmation",
    title: "Business entry confirmed → email client confirmation",
    description:
      "When a business entry is Confirmed (saved as Confirmed, or a draft later marked Confirmed), email the client a transaction confirmation with the amount, AMC, and date. Template auto-created. Remove the 'Confirmed' condition to fire on every entry (incl. drafts).",
    category: "Service",
    needsTemplate: false,
    rule: {
      ...base,
      module: "business_entries",
      name: "Business entry confirmation",
      description: "Email the client a transaction confirmation when a business entry is confirmed.",
      triggerType: "record_action",
      triggerConfig: { when: "create_or_edit", fields: [], repeat: false },
      criteriaRows: [{ field: "status", operator: "is", value: "confirmed" }],
      instantActions: [
        { type: "send_email", label: "Email the client", config: { templateKey: "business_confirmation", category: "transactional", recipient: "subject" } },
      ],
    },
  },
  {
    key: "new_client_welcome_email",
    title: "New client → welcome email",
    description:
      "As soon as a client is created, email them a warm welcome from your firm. Template auto-created.",
    category: "Clients",
    needsTemplate: false,
    rule: {
      ...base,
      module: "investors",
      name: "New client welcome email",
      description: "Email every new client a welcome message.",
      triggerType: "record_action",
      triggerConfig: { when: "create", fields: [], repeat: false },
      criteriaRows: [],
      instantActions: [
        { type: "send_email", label: "Email the client", config: { templateKey: "client_welcome", category: "transactional", recipient: "subject" } },
      ],
    },
  },
  {
    key: "kyc_expiry_reminder",
    title: "KYC expiring → remind the client",
    description:
      "30 days before a client's KYC expires, email them to complete re-KYC so their investments stay active. Template auto-created.",
    category: "Clients",
    needsTemplate: false,
    rule: {
      ...base,
      module: "investors",
      name: "KYC expiry reminder",
      description: "Email the client 30 days before KYC expiry.",
      triggerType: "date_field",
      triggerConfig: { field: "kyc_expires_at", when: "before", offset: 30, unit: "day", recurrence: "once", time: "09:00" },
      criteriaRows: [{ field: "status", operator: "is", value: "active" }],
      instantActions: [
        { type: "send_email", label: "Email the client", config: { templateKey: "kyc_expiry", category: "utility", recipient: "subject" } },
      ],
    },
  },
  {
    key: "onboarding_anniversary",
    title: "Client anniversary → thank-you email",
    description:
      "Every year on the anniversary of a client joining, email them a thank-you. Recurs yearly off the onboarding date. Template auto-created.",
    category: "Clients",
    needsTemplate: false,
    rule: {
      ...base,
      module: "investors",
      name: "Client anniversary",
      description: "Email a thank-you on the client's onboarding anniversary.",
      triggerType: "date_field",
      triggerConfig: { field: "onboarded_at", when: "on", offset: 0, unit: "day", recurrence: "every_year", time: "09:00" },
      criteriaRows: [{ field: "status", operator: "is", value: "active" }],
      instantActions: [
        { type: "send_email", label: "Email the client", config: { templateKey: "onboarding_anniversary", category: "transactional", recipient: "subject" } },
      ],
    },
  },
  {
    key: "dormant_client_reengage",
    title: "Dormant client → re-engagement email",
    description:
      "When a client hasn't transacted in 180 days, email them to reconnect and review their portfolio. Marketing message — needs the client's marketing consent. Template auto-created.",
    category: "Clients",
    needsTemplate: false,
    rule: {
      ...base,
      module: "investors",
      name: "Dormant client re-engagement",
      description: "Email a re-engagement nudge after 180 days of no transactions.",
      triggerType: "date_field",
      triggerConfig: { field: "last_transaction_at", when: "after", offset: 180, unit: "day", recurrence: "once", time: "09:00" },
      criteriaRows: [{ field: "status", operator: "is", value: "active" }],
      instantActions: [
        { type: "send_email", label: "Email the client", config: { templateKey: "dormant_reengage", category: "marketing", recipient: "subject" } },
      ],
    },
  },
  {
    key: "review_meeting_due",
    title: "Review due → create RM task",
    description:
      "On a client's next-review date, create a task for their RM to schedule the review meeting. No message template needed — works immediately.",
    category: "Clients",
    needsTemplate: false,
    rule: {
      ...base,
      module: "investors",
      name: "Review meeting due",
      description: "Create an RM task on the client's next-review date.",
      triggerType: "date_field",
      triggerConfig: { field: "next_review_at", when: "on", offset: 0, unit: "day", recurrence: "once", time: "09:00" },
      criteriaRows: [{ field: "status", operator: "is", value: "active" }],
      instantActions: [
        { type: "create_task", label: "Create RM review task", config: { title: "Schedule periodic review with client", taskType: "review", priority: "normal", assignee: "subject.rm_id", department: "rm" } },
      ],
    },
  },
  {
    key: "sip_ending_soon",
    title: "SIP ending soon → email client",
    description:
      "30 days before an active SIP's end date, email the client to review whether to renew or step it up. Template auto-created.",
    category: "SIP",
    needsTemplate: false,
    rule: {
      ...base,
      module: "sips",
      name: "SIP ending soon",
      description: "Email the client 30 days before a SIP ends.",
      triggerType: "date_field",
      triggerConfig: { field: "end_date", when: "before", offset: 30, unit: "day", recurrence: "once", time: "09:00" },
      criteriaRows: [{ field: "status", operator: "is", value: "active" }],
      instantActions: [
        { type: "send_email", label: "Email the client", config: { templateKey: "sip_ending", category: "utility", recipient: "subject" } },
      ],
    },
  },
  {
    key: "sip_stepup_nudge",
    title: "SIP anniversary → step-up nudge",
    description:
      "Every year on a SIP's start-date anniversary, email the client suggesting an annual step-up. Marketing message — needs the client's marketing consent. Template auto-created.",
    category: "SIP",
    needsTemplate: false,
    rule: {
      ...base,
      module: "sips",
      name: "Annual SIP step-up nudge",
      description: "Email a step-up suggestion on the SIP's yearly anniversary.",
      triggerType: "date_field",
      triggerConfig: { field: "start_date", when: "on", offset: 0, unit: "day", recurrence: "every_year", time: "09:00" },
      criteriaRows: [{ field: "status", operator: "is", value: "active" }],
      instantActions: [
        { type: "send_email", label: "Email the client", config: { templateKey: "sip_stepup", category: "marketing", recipient: "subject" } },
      ],
    },
  },
  {
    key: "insurance_premium_renewal",
    title: "Insurance premium due → remind client",
    description:
      "7 days before a policy's next premium due date, email the client to pay and keep their cover active. Template auto-created. " +
      "NOTE: the \"Insurance premium reminder\" recipe already nudges via WhatsApp at 15/7/1 days — enable only ONE of the two so the client isn't messaged twice at the 7-day mark.",
    category: "Clients",
    needsTemplate: false,
    rule: {
      ...base,
      module: "insurance",
      name: "Insurance premium renewal reminder",
      description: "Email the client 7 days before a premium is due.",
      triggerType: "date_field",
      triggerConfig: { field: "next_premium_due_date", when: "before", offset: 7, unit: "day", recurrence: "once", time: "09:00" },
      criteriaRows: [{ field: "status", operator: "is", value: "active" }],
      instantActions: [
        { type: "send_email", label: "Email the client", config: { templateKey: "premium_renewal", category: "utility", recipient: "subject" } },
      ],
    },
  },
  {
    key: "policy_maturity_heads_up",
    title: "Policy maturing → email client",
    description:
      "30 days before a policy matures, email the client to plan reinvesting the proceeds. Template auto-created.",
    category: "Clients",
    needsTemplate: false,
    rule: {
      ...base,
      module: "insurance",
      name: "Policy maturity heads-up",
      description: "Email the client 30 days before a policy matures.",
      triggerType: "date_field",
      triggerConfig: { field: "maturity_date", when: "before", offset: 30, unit: "day", recurrence: "once", time: "09:00" },
      criteriaRows: [{ field: "status", operator: "is", value: "active" }],
      instantActions: [
        { type: "send_email", label: "Email the client", config: { templateKey: "policy_maturity", category: "utility", recipient: "subject" } },
      ],
    },
  },
  {
    key: "goal_target_approaching",
    title: "Goal approaching → review email",
    description:
      "90 days before a financial goal's target date, email the client to review progress. Template auto-created.",
    category: "Clients",
    needsTemplate: false,
    rule: {
      ...base,
      module: "goals",
      name: "Goal target approaching",
      description: "Email the client 90 days before a goal's target date.",
      triggerType: "date_field",
      triggerConfig: { field: "target_date", when: "before", offset: 90, unit: "day", recurrence: "once", time: "09:00" },
      criteriaRows: [],
      instantActions: [
        { type: "send_email", label: "Email the client", config: { templateKey: "goal_review", category: "utility", recipient: "subject" } },
      ],
    },
  },
  {
    key: "lead_followup_due",
    title: "Lead follow-up due → create owner task",
    description:
      "On a lead's next-follow-up date, create a task for the lead owner to follow up. No message template needed — works immediately.",
    category: "Leads",
    needsTemplate: false,
    rule: {
      ...base,
      module: "leads",
      name: "Lead follow-up due",
      description: "Create an owner task on the lead's next-follow-up date.",
      triggerType: "date_field",
      triggerConfig: { field: "next_follow_up_at", when: "on", offset: 0, unit: "day", recurrence: "once", time: "09:00" },
      criteriaRows: [],
      instantActions: [
        { type: "create_task", label: "Create follow-up task", config: { title: "Follow up with lead", taskType: "follow_up", priority: "high", assignee: "subject.owner_id", department: "sales" } },
      ],
    },
  },
  {
    key: "stale_lead_nurture",
    title: "Stale lead → re-engagement email",
    description:
      "When a new lead has had no activity for 14 days, email them a gentle nudge to start their journey. Marketing message — needs consent. Template auto-created.",
    category: "Leads",
    needsTemplate: false,
    rule: {
      ...base,
      module: "leads",
      name: "Stale lead re-engagement",
      description: "Email a nurture nudge after 14 days of no activity on a new lead.",
      triggerType: "date_field",
      triggerConfig: { field: "last_activity_at", when: "after", offset: 14, unit: "day", recurrence: "once", time: "09:00" },
      criteriaRows: [{ field: "stage", operator: "is", value: "new" }],
      instantActions: [
        { type: "send_email", label: "Email the lead", config: { templateKey: "stale_lead_nurture", category: "marketing", recipient: "subject" } },
      ],
    },
  },
  {
    key: "sip_installment_reminder",
    title: "SIP installment reminder",
    description:
      "2 days before each active SIP's installment date, WhatsApp the client a reminder. Recurs every month off the SIP's next-installment date.",
    category: "SIP",
    needsTemplate: true,
    rule: {
      ...base,
      module: "sips",
      name: "SIP installment reminder",
      description: "Remind the client 2 days before each SIP debit.",
      triggerType: "date_field",
      triggerConfig: { field: "next_installment_at", when: "before", offset: 2, unit: "day", recurrence: "every_month", time: "09:00" },
      criteriaRows: [{ field: "status", operator: "is", value: "active" }],
      instantActions: [{ type: "send_whatsapp", label: "WhatsApp the client", config: { templateKey: "", category: "utility", recipient: "subject" } }],
    },
  },
  {
    key: "referral_thank_you",
    title: "Thank the referring client",
    description:
      "When a new lead is created from a client referral, email the referring client a thank-you that names the lead they referred. The email template is created for you automatically.",
    category: "Leads",
    needsTemplate: false, // referrer_thank_you template is auto-provisioned on add
    rule: {
      ...base,
      module: "leads",
      name: "Referral thank-you",
      description: "Email the referring client when a referred lead is created.",
      triggerType: "record_action",
      triggerConfig: { when: "create", fields: [], repeat: false },
      criteriaRows: [{ field: "referred_by_name", operator: "is_not_empty" }],
      instantActions: [{ type: "send_email", label: "Email the referring client", config: { templateKey: "referrer_thank_you", category: "transactional", recipient: "referrer" } }],
    },
  },
  {
    key: "new_lead_welcome",
    title: "Welcome a new lead",
    description: "As soon as a lead is created, WhatsApp them a welcome message so first contact is instant.",
    category: "Leads",
    needsTemplate: true,
    rule: {
      ...base,
      module: "leads",
      name: "New lead welcome",
      description: "WhatsApp a welcome to every new lead.",
      triggerType: "record_action",
      triggerConfig: { when: "create", fields: [], repeat: false },
      criteriaRows: [],
      instantActions: [{ type: "send_whatsapp", label: "WhatsApp the lead", config: { templateKey: "", category: "utility", recipient: "subject" } }],
    },
  },
  {
    key: "client_birthday_wish",
    title: "Client birthday email",
    description: "On each active client's birthday, email them a Happy Birthday wish. Recurs every year off the client's date of birth. Template auto-created.",
    category: "Clients",
    needsTemplate: false,
    rule: {
      ...base,
      module: "investors",
      name: "Client birthday wish",
      description: "Email a Happy Birthday greeting on the client's birthday.",
      triggerType: "date_field",
      triggerConfig: { field: "date_of_birth", when: "on", offset: 0, unit: "day", recurrence: "every_year", time: "09:00" },
      criteriaRows: [{ field: "status", operator: "is", value: "active" }],
      instantActions: [{ type: "send_email", label: "Email the client", config: { templateKey: "birthday_wish", category: "marketing", recipient: "subject" } }],
    },
  },
  {
    key: "sip_rejection_followup",
    title: "SIP rejection → RM follow-up task",
    description: "When a SIP rejection is recorded, create a high-priority follow-up task for the client's RM. No message template needed — works immediately.",
    category: "Service",
    needsTemplate: false,
    rule: {
      ...base,
      module: "sip_rejections",
      name: "SIP rejection follow-up",
      description: "Create an RM task to recover a rejected SIP.",
      triggerType: "record_action",
      triggerConfig: { when: "create", fields: [], repeat: false },
      criteriaRows: [],
      instantActions: [{ type: "create_task", label: "Create RM task", config: { title: "Follow up on rejected SIP", taskType: "follow_up", priority: "high", assignee: "subject.rm_id", department: "operations" } }],
    },
  },
];

export function getPredefinedRule(key: string): PredefinedRule | undefined {
  return PREDEFINED_RULES.find((r) => r.key === key);
}
