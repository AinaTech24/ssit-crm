/**
 * Stage-action catalog — full SOP version.
 *
 * One entry per stage in LEAD_TO_CLIENT_STAGES. Each entry is the list of
 * primary buttons rendered on the blueprint bar for that stage.
 *
 * Click flow:
 *   1. UI calls /blueprint/can-advance?to=<targetStage> first
 *   2. Satisfied → fire `behaviour`
 *   3. Not satisfied → show inline checklist with direct CTAs
 *
 * Tones map to button colours:
 *   primary   = filled brand (the recommended action)
 *   secondary = outline grey (alternates)
 *   success   = filled emerald (positive terminal)
 *   danger    = outlined rose (negative branches: lost, reject)
 */

export type StageActionBehaviour =
  | { kind: "open_dialog"; dialog: DialogKind }
  | { kind: "navigate"; hrefPattern: string }
  | { kind: "advance_only" }
  | { kind: "call_api"; endpoint: string; body?: Record<string, unknown>; afterStage?: string };

export type DialogKind =
  | "log_call"
  | "log_past_meeting"
  | "schedule_meeting"
  | "send_risk_profile"
  | "capture_risk_profile_manually"
  | "send_doc_checklist"
  | "capture_approval"
  | "won_lead_product"
  | "mark_lost";

export type StageAction = {
  key: string;
  label: string;
  tone: "primary" | "secondary" | "danger" | "success";
  targetStage: string;
  hint?: string;
  behaviour: StageActionBehaviour;
  /** If set, this action only shows when the lead's pipeline is one of these
   *  (mf | insurance | general). Used to branch Won-Lead onboarding by product. */
  pipelines?: string[];
};

export const STAGE_ACTIONS: Record<string, StageAction[]> = {
  // ──────────────────────────────────────────────── LEAD PHASE ──

  // 1. New Lead Created — 4-way fork on the very first action.
  new: [
    {
      key: "call_done",
      label: "Call Done",
      tone: "primary",
      targetStage: "call_done",
      hint: "Log the call outcome — RM had a meaningful first conversation.",
      behaviour: { kind: "open_dialog", dialog: "log_call" },
    },
    {
      key: "call_back_later",
      label: "Call Back Later",
      tone: "secondary",
      targetStage: "call_back_later",
      hint: "Lead asked to reach out at a specific time — added to tomorrow's queue.",
      behaviour: { kind: "advance_only" },
    },
    {
      key: "call_not_connected",
      label: "Call Not Connected",
      tone: "secondary",
      targetStage: "call_not_connected",
      hint: "No answer / busy — auto-resurface tomorrow.",
      behaviour: { kind: "advance_only" },
    },
    {
      key: "contact_in_future",
      label: "Contact in Future",
      tone: "secondary",
      targetStage: "contact_in_future",
      hint: "Long-term nurture — resurface in 30 / 60 / 90 days.",
      behaviour: { kind: "advance_only" },
    },
  ],

  // 2. Call Done — schedule, log existing, or kill.
  call_done: [
    {
      key: "schedule_meeting",
      label: "Schedule Meeting",
      tone: "primary",
      targetStage: "meeting_scheduled",
      hint: "Opens the meeting form pre-filled with this lead.",
      behaviour: { kind: "open_dialog", dialog: "schedule_meeting" },
    },
    {
      key: "meeting_pending",
      label: "Meeting Tentative",
      tone: "secondary",
      targetStage: "meeting_pending",
      hint: "Booked but client hasn't confirmed yet.",
      behaviour: { kind: "advance_only" },
    },
    {
      key: "not_qualified",
      label: "Not Qualified",
      tone: "danger",
      targetStage: "not_qualified",
      hint: "Lead isn't a fit — close as lost.",
      behaviour: { kind: "advance_only" },
    },
  ],

  // 3. Call Back Later — loop options
  call_back_later: [
    {
      key: "reached",
      label: "Reached Successfully",
      tone: "primary",
      targetStage: "call_done",
      hint: "Got hold of the lead — log the call.",
      behaviour: { kind: "open_dialog", dialog: "log_call" },
    },
    {
      key: "still_no_answer",
      label: "Still No Answer",
      tone: "secondary",
      targetStage: "call_not_connected",
      hint: "Move to Not Connected; try again tomorrow.",
      behaviour: { kind: "advance_only" },
    },
    {
      key: "defer",
      label: "Defer Long-term",
      tone: "secondary",
      targetStage: "contact_in_future",
      hint: "Park for 30+ days.",
      behaviour: { kind: "advance_only" },
    },
  ],

  // 4. Call Not Connected — same loop, different defaults
  call_not_connected: [
    {
      key: "reached",
      label: "Eventually Reached",
      tone: "primary",
      targetStage: "call_done",
      hint: "Finally got through — log the conversation.",
      behaviour: { kind: "open_dialog", dialog: "log_call" },
    },
    {
      key: "schedule_callback",
      label: "Retry Tomorrow",
      tone: "secondary",
      targetStage: "call_back_later",
      hint: "Lead asked to be called at a better time.",
      behaviour: { kind: "advance_only" },
    },
    {
      key: "long_term",
      label: "Long-term Nurture",
      tone: "secondary",
      targetStage: "contact_in_future",
      hint: "Move to drip campaign.",
      behaviour: { kind: "advance_only" },
    },
  ],

  // 5. Contact in Future — long-term loop
  contact_in_future: [
    {
      key: "resurfaced",
      label: "Reached / Resurfaced",
      tone: "primary",
      targetStage: "call_done",
      hint: "Lead replied or RM got back in touch.",
      behaviour: { kind: "open_dialog", dialog: "log_call" },
    },
    {
      key: "confirmed_lost",
      label: "Confirmed Not Interested",
      tone: "danger",
      targetStage: "not_qualified",
      hint: "Permanently close — explicit rejection.",
      behaviour: { kind: "advance_only" },
    },
  ],

  // 6. Meeting Scheduled
  meeting_scheduled: [
    {
      key: "meeting_done",
      label: "Meeting Done",
      tone: "primary",
      targetStage: "meeting_done",
      hint: "Mark the meeting as completed and capture outcome.",
      behaviour: { kind: "open_dialog", dialog: "log_past_meeting" },
    },
    {
      key: "reschedule",
      label: "Reschedule",
      tone: "secondary",
      targetStage: "meeting_scheduled",
      hint: "Move to a different date/time.",
      behaviour: { kind: "open_dialog", dialog: "schedule_meeting" },
    },
    {
      key: "pending",
      label: "Awaiting Confirmation",
      tone: "secondary",
      targetStage: "meeting_pending",
      hint: "Client hasn't confirmed; nudge them.",
      behaviour: { kind: "advance_only" },
    },
    {
      key: "no_show",
      label: "Client No-show",
      tone: "danger",
      targetStage: "contact_in_future",
      hint: "Client didn't turn up — move to nurture and set a re-engage reminder.",
      behaviour: { kind: "advance_only" },
    },
  ],

  // 7. Meeting Pending
  meeting_pending: [
    {
      key: "meeting_done",
      label: "Meeting Done",
      tone: "primary",
      targetStage: "meeting_done",
      hint: "Meeting happened — capture outcome.",
      behaviour: { kind: "open_dialog", dialog: "log_past_meeting" },
    },
    {
      key: "confirmed",
      label: "Confirmed / Rescheduled",
      tone: "secondary",
      targetStage: "meeting_scheduled",
      hint: "Back to a confirmed slot.",
      behaviour: { kind: "open_dialog", dialog: "schedule_meeting" },
    },
    {
      key: "no_show",
      label: "Client No-show",
      tone: "danger",
      targetStage: "contact_in_future",
      hint: "Client didn't turn up — move to nurture and set a re-engage reminder.",
      behaviour: { kind: "advance_only" },
    },
  ],

  // 8. Meeting Done — qualify or kill
  meeting_done: [
    {
      key: "won_lead",
      label: "Qualified — Won Lead",
      tone: "success",
      targetStage: "won_lead",
      hint: "Pick which product(s) the client is investing in — the onboarding flow adapts to it.",
      // Opens the product-interest dialog; on save it records the product, sets
      // the pipeline and advances to Won Lead (then the right onboarding branch).
      behaviour: { kind: "open_dialog", dialog: "won_lead_product" },
    },
    {
      key: "not_qualified",
      label: "Not a Fit",
      tone: "danger",
      targetStage: "not_qualified",
      hint: "Close lead as not qualified.",
      behaviour: { kind: "advance_only" },
    },
  ],

  // 9. Won Lead — boundary; conversion happens here. Two paths into
  // onboarding mirror the reference SOP:
  //   - Request Documents  → kick off the doc-collection flow
  //   - Documents Received → docs already on file, skip the request
  won_lead: [
    // ── MF / general onboarding ──
    {
      key: "request_docs",
      label: "Request Documents",
      tone: "primary",
      targetStage: "request_documents",
      hint: "Mint a doc-collection link and send it to the client.",
      behaviour: { kind: "open_dialog", dialog: "send_doc_checklist" },
      pipelines: ["mf", "general"],
    },
    {
      key: "docs_already_received",
      label: "Documents Already Received",
      tone: "secondary",
      targetStage: "documents_received",
      hint: "Client gave docs in-person — skip the request step.",
      behaviour: { kind: "advance_only" },
      pipelines: ["mf", "general"],
    },
    // ── Insurance onboarding ──
    {
      key: "start_insurance",
      label: "Start Insurance Onboarding",
      tone: "primary",
      targetStage: "insurance_needs_analysis",
      hint: "Begin the protection journey: needs analysis → quote → proposal → underwriting → policy.",
      behaviour: { kind: "advance_only" },
      pipelines: ["insurance"],
    },
  ],

  // ──────────────────────────────────── INSURANCE ONBOARDING ──
  insurance_needs_analysis: [
    {
      key: "quote",
      label: "Share Quote",
      tone: "primary",
      targetStage: "insurance_quote",
      hint: "Protection gap assessed — share premium illustrations.",
      behaviour: { kind: "advance_only" },
    },
  ],
  insurance_quote: [
    {
      key: "proposal",
      label: "Proposal Filled",
      tone: "primary",
      targetStage: "insurance_proposal",
      hint: "Client accepted — fill the proposal form + collect KYC/medicals.",
      behaviour: { kind: "advance_only" },
    },
    {
      key: "dropped",
      label: "Client Dropped",
      tone: "danger",
      targetStage: "insurance_lost",
      hint: "Client decided not to proceed.",
      behaviour: { kind: "advance_only" },
    },
  ],
  insurance_proposal: [
    {
      key: "underwriting",
      label: "Submit to Insurer",
      tone: "primary",
      targetStage: "insurance_underwriting",
      hint: "Proposal submitted — underwriting / medicals in progress.",
      behaviour: { kind: "advance_only" },
    },
  ],
  insurance_underwriting: [
    {
      key: "issued",
      label: "Policy Issued",
      tone: "success",
      targetStage: "insurance_policy_issued",
      hint: "Insurer issued the policy — client is onboarded.",
      behaviour: { kind: "advance_only" },
    },
    {
      key: "declined",
      label: "Declined / Not Proceeded",
      tone: "danger",
      targetStage: "insurance_lost",
      hint: "Underwriting declined or client backed out.",
      behaviour: { kind: "advance_only" },
    },
  ],
  insurance_policy_issued: [],
  insurance_lost: [
    {
      key: "reopen",
      label: "Reopen",
      tone: "secondary",
      targetStage: "insurance_needs_analysis",
      hint: "Revisit — client is interested again.",
      behaviour: { kind: "advance_only" },
    },
  ],

  // 10. Not Qualified — terminal
  not_qualified: [
    {
      key: "reopen",
      label: "Reopen Lead",
      tone: "secondary",
      targetStage: "call_done",
      hint: "Reconsider this lead — restart the conversation.",
      behaviour: { kind: "open_dialog", dialog: "log_call" },
    },
  ],

  // ────────────────────────────────────────────── CLIENT PHASE ──

  // 11. Request Documents
  request_documents: [
    {
      key: "send_checklist",
      label: "Send Doc Checklist",
      tone: "primary",
      targetStage: "documents_pending",
      hint: "One click — emails AND WhatsApps the client a secure upload link.",
      behaviour: { kind: "call_api", endpoint: "/api/leads/{id}/send-doc-checklist", afterStage: "documents_pending" },
    },
    {
      key: "docs_received",
      label: "Documents Already Received",
      tone: "secondary",
      targetStage: "documents_received",
      hint: "Skip the link — docs were given in person.",
      behaviour: { kind: "advance_only" },
    },
  ],

  // 12. Documents Pending
  documents_pending: [
    {
      key: "docs_received",
      label: "Documents Received",
      tone: "primary",
      targetStage: "documents_received",
      hint: "Confirm receipt — kicks off KYC.",
      behaviour: { kind: "advance_only" },
    },
    {
      key: "resend",
      label: "Resend Link",
      tone: "secondary",
      targetStage: "documents_pending",
      hint: "Re-send the upload link via email + WhatsApp.",
      behaviour: { kind: "call_api", endpoint: "/api/leads/{id}/send-doc-checklist" },
    },
  ],

  // 13. Documents Received — 3-way KYC fork
  documents_received: [
    {
      key: "kyc_validated",
      label: "Existing KYC Validated",
      tone: "primary",
      targetStage: "kyc_validated",
      hint: "KRA already has this PAN — straight to UCC.",
      behaviour: { kind: "advance_only" },
    },
    {
      key: "kyc_registered",
      label: "Register Fresh KYC",
      tone: "secondary",
      targetStage: "kyc_registered",
      hint: "Submit a new KYC application to the KRA.",
      behaviour: { kind: "advance_only" },
    },
    {
      key: "kyc_pending",
      label: "KYC Verification Pending",
      tone: "secondary",
      targetStage: "kyc_pending",
      hint: "Need IPV / e-KYC verification.",
      behaviour: { kind: "advance_only" },
    },
  ],

  // 14. KYC Validated — create UCC or mark already-active.
  kyc_validated: [
    {
      key: "ucc_create",
      label: "Create UCC",
      tone: "primary",
      targetStage: "ucc_create",
      hint: "Generate BSE/NSE Unique Client Code.",
      behaviour: { kind: "advance_only" },
    },
    {
      key: "ucc_already",
      label: "UCC Already Active",
      tone: "secondary",
      targetStage: "ucc_activated",
      hint: "Client already has an active UCC from a prior platform.",
      behaviour: { kind: "advance_only" },
    },
  ],

  // 15. KYC Registered
  kyc_registered: [
    {
      key: "validated",
      label: "KYC Validated",
      tone: "primary",
      targetStage: "kyc_validated",
      hint: "KRA has cleared it — move on.",
      behaviour: { kind: "advance_only" },
    },
    {
      key: "modify",
      label: "Needs Modification",
      tone: "secondary",
      targetStage: "modify_kyc",
      hint: "Address / bank / nominee correction required.",
      behaviour: { kind: "advance_only" },
    },
  ],

  // 16. KYC Pending — physical vs online
  kyc_pending: [
    {
      key: "physical",
      label: "Physical KYC (IPV)",
      tone: "secondary",
      targetStage: "physical_kyc",
      hint: "Schedule offline in-person verification.",
      behaviour: { kind: "advance_only" },
    },
    {
      key: "online",
      label: "Online KYC (Aadhaar/e-KYC)",
      tone: "primary",
      targetStage: "online_kyc",
      hint: "Faster route via Digilocker / Aadhaar OTP.",
      behaviour: { kind: "advance_only" },
    },
  ],

  // 17. Modify KYC
  modify_kyc: [
    {
      key: "validated",
      label: "Modification Complete",
      tone: "primary",
      targetStage: "kyc_validated",
      hint: "KRA accepted the corrected record.",
      behaviour: { kind: "advance_only" },
    },
  ],

  // 18. Physical KYC
  physical_kyc: [
    {
      key: "validated",
      label: "IPV Done — KYC Validated",
      tone: "primary",
      targetStage: "kyc_validated",
      hint: "In-person verification recorded.",
      behaviour: { kind: "advance_only" },
    },
  ],

  // 19. Online KYC
  online_kyc: [
    {
      key: "validated",
      label: "e-KYC Done — KYC Validated",
      tone: "primary",
      targetStage: "kyc_validated",
      hint: "Aadhaar / Digilocker flow completed.",
      behaviour: { kind: "advance_only" },
    },
  ],

  // 20. UCC Create
  ucc_create: [
    {
      key: "activated",
      label: "UCC Activated",
      tone: "primary",
      targetStage: "ucc_activated",
      hint: "Exchange returned an active code.",
      behaviour: { kind: "advance_only" },
    },
  ],

  // 21. UCC Activated — register mandate, mark already-active, or
  // record an upfront rejection (skipping create).
  ucc_activated: [
    {
      key: "mandate",
      label: "Register Mandate",
      tone: "primary",
      targetStage: "mandate_create",
      hint: "Submit NACH / e-mandate to the bank.",
      behaviour: { kind: "advance_only" },
    },
    {
      key: "mandate_already",
      label: "Mandate Already Active",
      tone: "secondary",
      targetStage: "mandate_activated",
      hint: "Client already has an active mandate (e.g. via MFU).",
      behaviour: { kind: "advance_only" },
    },
    {
      key: "mandate_rejected",
      label: "Record Bank Rejection",
      tone: "danger",
      targetStage: "mandate_reject",
      hint: "Mandate was rejected by the bank — flag for retry.",
      behaviour: { kind: "advance_only" },
    },
  ],

  // 22. Mandate Create
  mandate_create: [
    {
      key: "activated",
      label: "Mandate Activated",
      tone: "success",
      targetStage: "mandate_activated",
      hint: "Bank confirmed — first SIP can debit.",
      behaviour: { kind: "advance_only" },
    },
    {
      key: "rejected",
      label: "Bank Rejected",
      tone: "danger",
      targetStage: "mandate_reject",
      hint: "Mandate failed — fix data and retry.",
      behaviour: { kind: "advance_only" },
    },
  ],

  // 23. Mandate Activated
  mandate_activated: [
    {
      key: "place_order",
      label: "Make First Investment",
      tone: "primary",
      targetStage: "make_transaction",
      hint: "Submit purchase order to BSE Star / NSE NMF.",
      behaviour: { kind: "navigate", hrefPattern: "/dashboard/business-entries/new?investorId={id}" },
    },
  ],

  // 24. Mandate Rejected — retry loop
  mandate_reject: [
    {
      key: "retry",
      label: "Retry Mandate",
      tone: "primary",
      targetStage: "mandate_create",
      hint: "Correct data and resubmit registration.",
      behaviour: { kind: "advance_only" },
    },
  ],

  // 25. Make Transaction
  make_transaction: [
    {
      key: "successful",
      label: "Order Successful",
      tone: "success",
      targetStage: "transaction_successful",
      hint: "Units allotted by the AMC.",
      behaviour: { kind: "advance_only" },
    },
    {
      key: "failed",
      label: "Order Failed",
      tone: "danger",
      targetStage: "transaction_failed",
      hint: "Payment / order issue — retry.",
      behaviour: { kind: "advance_only" },
    },
  ],

  // 26. Transaction Successful
  transaction_successful: [
    {
      key: "family",
      label: "Map Family",
      tone: "primary",
      targetStage: "family_mapping",
      hint: "Link spouse / parents / children for household view.",
      behaviour: { kind: "navigate", hrefPattern: "/dashboard/families/new?investorId={id}" },
    },
  ],

  // 27. Transaction Failed — retry
  transaction_failed: [
    {
      key: "retry",
      label: "Retry Transaction",
      tone: "primary",
      targetStage: "make_transaction",
      hint: "Resolve the issue and resubmit the order.",
      behaviour: { kind: "navigate", hrefPattern: "/dashboard/business-entries/new?investorId={id}" },
    },
  ],

  // 28. Family Mapping
  family_mapping: [
    {
      key: "next",
      label: "Update Client Information",
      tone: "primary",
      targetStage: "update_information",
      hint: "Enrich master record: goals, income, occupation, nominee.",
      behaviour: { kind: "navigate", hrefPattern: "/dashboard/investors/{id}" },
    },
  ],

  // 29. Update Information
  update_information: [
    {
      key: "active",
      label: "Mark as Active Client",
      tone: "success",
      targetStage: "add_in_review_sheet",
      hint: "Onboarding complete — added to the quarterly review sheet.",
      behaviour: { kind: "advance_only" },
    },
  ],

  // 30. Active Client — terminal, no buttons
  add_in_review_sheet: [],
};
