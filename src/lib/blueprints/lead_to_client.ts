/**
 * Lead → Client SOP — full branching workflow.
 *
 * Redesigned from the previous linear 15-stage journey to a real
 * state-graph that mirrors how an MFD firm actually operates:
 *
 *   LEAD MODULE (stages 1-10) — owns the discovery + qualification phase
 *     1. New Lead Created                 (root)
 *     2. Call Done                        (first contact made)
 *     3. Call Back Later                  (snooze, RM will retry)
 *     4. Call Not Connected               (no answer; circle back)
 *     5. Contact in Future                (long-term nurture)
 *     6. Meeting Scheduled                (appointment confirmed)
 *     7. Meeting Pending                  (awaiting client confirm)
 *     8. Meeting Done                     (meeting held + outcome captured)
 *     9. Won Lead                         (qualified; ready to convert)
 *    10. Not Qualified                    (dead-end, lost)
 *
 *   CLIENT MODULE (stages 11-30) — owns the onboarding + activation
 *    11. Request Documents               (doc-collection link sent)
 *    12. Documents Pending               (waiting on client)
 *    13. Documents Received              (uploads complete)
 *    14. KYC Validated                   (KRA returns OK)
 *    15. KYC Registered                  (initial KYC capture)
 *    16. KYC Pending                     (KRA verifying)
 *    17. Modify KYC                      (data tweak needed)
 *    18. Physical KYC                    (offline verification path)
 *    19. Online KYC                      (e-KYC via Aadhaar)
 *    20. UCC Create                      (BSE/NSE code creation in progress)
 *    21. UCC Activated                   (exchange code live)
 *    22. Mandate Create                  (SIP mandate registration in progress)
 *    23. Mandate Activated               (NACH mandate live)
 *    24. Mandate Rejected                (re-do — bank failure)
 *    25. Make Transaction                (first investment kick-off)
 *    26. Transaction Successful          (units allotted)
 *    27. Transaction Failed              (re-do — payment issue)
 *    28. Family Mapping                  (linked to family / household)
 *    29. Update Information              (client master enriched)
 *    30. Active Client (in Review Sheet) (terminal — in review cycle)
 *
 * Branching rules:
 *   - From the root (`new`), 4 branches: Call Done / Call Back Later /
 *     Call Not Connected / Contact in Future
 *   - From Meeting Done: Won Lead OR Not Qualified
 *   - From KYC branches: 3 paths (Validated / Registered / Pending)
 *   - From Mandate: Activated OR Rejected (retry to Create)
 *   - From Transaction: Successful OR Failed (retry to Make Transaction)
 *   - "Won Lead" is the lead → client cut-over point (boundary).
 */

export interface SeedStage {
  key: string;
  name: string;
  description?: string;
  order: number;
  ownerRole: "sales" | "back_office" | "operations" | "compliance" | "owner";
  requiredFields: string[];
  slaDays?: number;
  allowedActions: string[];
  automationsOnEnter?: string[];
  automationsOnExit?: string[];
  /** Visual marker for the stepper: `terminal_success` / `terminal_failure` /
   *  `loop` (call-back loops) / default linear. */
  flavour?: "default" | "loop" | "terminal_success" | "terminal_failure";
}

export const LEAD_TO_CLIENT_BLUEPRINT_NAME = "Lead → Client SOP";

/** Boundary: stages 1-10 = lead module, 11-30 = client module. */
export const LEAD_PHASE_LAST_ORDER = 10;

export const LEAD_TO_CLIENT_STAGES: SeedStage[] = [
  // ────────────────────────────────────────────── LEAD PHASE ──
  {
    key: "new",
    name: "New Lead Created",
    description: "Lead just landed in the system. RM should make first contact.",
    order: 1,
    ownerRole: "sales",
    requiredFields: ["name", "phone", "source", "ownerId"],
    slaDays: 1,
    allowedActions: ["call_done", "call_back_later", "call_not_connected", "contact_in_future"],
    automationsOnEnter: ["lead_welcome"],
  },
  {
    key: "call_done",
    name: "Call Done",
    description: "First call completed. RM has spoken to the lead.",
    order: 2,
    ownerRole: "sales",
    requiredFields: ["lastContactAt"],
    slaDays: 2,
    allowedActions: ["schedule_meeting", "meeting_already_done", "mark_not_qualified"],
  },
  {
    key: "call_back_later",
    name: "Call Back Later",
    description: "Lead asked to call back at a specific time. Tomorrow's call queue.",
    order: 3,
    ownerRole: "sales",
    requiredFields: [],
    slaDays: 2,
    allowedActions: ["call_done", "call_not_connected", "contact_in_future"],
    flavour: "loop",
  },
  {
    key: "call_not_connected",
    name: "Call Not Connected",
    description: "No answer / number busy. RM will retry tomorrow.",
    order: 4,
    ownerRole: "sales",
    requiredFields: [],
    slaDays: 1,
    allowedActions: ["call_done", "call_back_later", "contact_in_future"],
    flavour: "loop",
  },
  {
    key: "contact_in_future",
    name: "Contact in Future",
    description: "Long-term nurture. Auto-resurface in 30/60/90 days.",
    order: 5,
    ownerRole: "sales",
    requiredFields: [],
    slaDays: 30,
    allowedActions: ["call_done", "mark_not_qualified"],
    flavour: "loop",
  },
  {
    key: "meeting_scheduled",
    name: "Meeting Scheduled",
    description: "Appointment booked. Reminder fires the day before.",
    order: 6,
    ownerRole: "sales",
    requiredFields: [],
    slaDays: 3,
    allowedActions: ["meeting_done", "reschedule_meeting", "meeting_pending"],
  },
  {
    key: "meeting_pending",
    name: "Meeting Pending",
    description: "Meeting booked but client hasn't confirmed.",
    order: 7,
    ownerRole: "sales",
    requiredFields: [],
    slaDays: 1,
    allowedActions: ["meeting_done", "reschedule_meeting", "cancel_meeting"],
    flavour: "loop",
  },
  {
    key: "meeting_done",
    name: "Meeting Done",
    description: "Meeting held. Capture outcome and decide next step.",
    order: 8,
    ownerRole: "sales",
    requiredFields: [],
    slaDays: 1,
    allowedActions: ["mark_won_lead", "mark_not_qualified"],
  },
  {
    key: "won_lead",
    name: "Won Lead",
    description: "Qualified lead. Ready to convert into a client.",
    order: 9,
    ownerRole: "sales",
    requiredFields: [],
    slaDays: 2,
    allowedActions: ["convert_to_client", "request_documents"],
    automationsOnEnter: ["won_lead_celebration"],
  },
  {
    key: "not_qualified",
    name: "Not Qualified",
    description: "Lead is not a fit. Closed-lost.",
    order: 10,
    ownerRole: "sales",
    requiredFields: [],
    allowedActions: ["reopen_lead"],
    flavour: "terminal_failure",
  },

  // ──────────────────────────────────────────── CLIENT PHASE ──
  {
    key: "request_documents",
    name: "Request Documents",
    description: "KYC + onboarding docs requested from the client.",
    order: 11,
    ownerRole: "back_office",
    requiredFields: [],
    slaDays: 1,
    allowedActions: ["docs_received", "docs_pending"],
    automationsOnEnter: ["send_doc_checklist"],
  },
  {
    key: "documents_pending",
    name: "Documents Pending",
    description: "Reminders going out. Waiting on client uploads.",
    order: 12,
    ownerRole: "back_office",
    requiredFields: [],
    slaDays: 7,
    allowedActions: ["docs_received", "resend_doc_checklist"],
    flavour: "loop",
  },
  {
    key: "documents_received",
    name: "Documents Received",
    description: "All KYC docs in. Run KYC workflow next.",
    order: 13,
    ownerRole: "back_office",
    requiredFields: [],
    slaDays: 1,
    allowedActions: ["kyc_validated", "kyc_registered", "kyc_pending"],
  },
  {
    key: "kyc_validated",
    name: "KYC Validated",
    description: "KRA returned validated. Move to UCC creation.",
    order: 14,
    ownerRole: "compliance",
    requiredFields: [],
    slaDays: 1,
    allowedActions: ["ucc_create"],
  },
  {
    key: "kyc_registered",
    name: "KYC Registered",
    description: "Fresh KYC registered with KRA. Awaiting validation.",
    order: 15,
    ownerRole: "compliance",
    requiredFields: [],
    slaDays: 3,
    allowedActions: ["kyc_validated", "modify_kyc"],
  },
  {
    key: "kyc_pending",
    name: "KYC Pending",
    description: "Client picks Physical or Online KYC route.",
    order: 16,
    ownerRole: "compliance",
    requiredFields: [],
    slaDays: 2,
    allowedActions: ["physical_kyc", "online_kyc"],
  },
  {
    key: "modify_kyc",
    name: "Modify KYC",
    description: "Data correction in flight (address / bank / nominee).",
    order: 17,
    ownerRole: "compliance",
    requiredFields: [],
    slaDays: 3,
    allowedActions: ["kyc_validated"],
    flavour: "loop",
  },
  {
    key: "physical_kyc",
    name: "Physical KYC",
    description: "Offline IPV being scheduled / done.",
    order: 18,
    ownerRole: "compliance",
    requiredFields: [],
    slaDays: 5,
    allowedActions: ["kyc_validated"],
  },
  {
    key: "online_kyc",
    name: "Online KYC",
    description: "e-KYC via Aadhaar OTP / Digilocker.",
    order: 19,
    ownerRole: "compliance",
    requiredFields: [],
    slaDays: 1,
    allowedActions: ["kyc_validated"],
  },
  {
    key: "ucc_create",
    name: "UCC Create",
    description: "BSE/NSE Unique Client Code creation in progress.",
    order: 20,
    ownerRole: "back_office",
    requiredFields: [],
    slaDays: 2,
    allowedActions: ["ucc_activated"],
  },
  {
    key: "ucc_activated",
    name: "UCC Activated",
    description: "Exchange UCC live. Set up SIP mandate next.",
    order: 21,
    ownerRole: "back_office",
    requiredFields: [],
    slaDays: 1,
    allowedActions: ["mandate_create"],
  },
  {
    key: "mandate_create",
    name: "Mandate Create",
    description: "NACH / e-mandate registration submitted.",
    order: 22,
    ownerRole: "back_office",
    requiredFields: [],
    slaDays: 3,
    allowedActions: ["mandate_activated", "mandate_reject"],
  },
  {
    key: "mandate_activated",
    name: "Mandate Activated",
    description: "Bank confirmed. SIP can debit on the scheduled date.",
    order: 23,
    ownerRole: "back_office",
    requiredFields: [],
    slaDays: 1,
    allowedActions: ["make_transaction"],
  },
  {
    key: "mandate_reject",
    name: "Mandate Rejected",
    description: "Bank rejected. Fix data and retry registration.",
    order: 24,
    ownerRole: "back_office",
    requiredFields: [],
    slaDays: 2,
    allowedActions: ["mandate_create"],
    flavour: "terminal_failure",
  },
  {
    key: "make_transaction",
    name: "Make Transaction",
    description: "First investment being placed on BSE Star / NSE NMF.",
    order: 25,
    ownerRole: "operations",
    requiredFields: [],
    slaDays: 1,
    allowedActions: ["transaction_successful", "transaction_failed"],
  },
  {
    key: "transaction_successful",
    name: "Transaction Successful",
    description: "Units allotted. Client is officially active.",
    order: 26,
    ownerRole: "operations",
    requiredFields: [],
    slaDays: 1,
    allowedActions: ["family_mapping"],
  },
  {
    key: "transaction_failed",
    name: "Transaction Failed",
    description: "Payment / order failure. Re-attempt.",
    order: 27,
    ownerRole: "operations",
    requiredFields: [],
    slaDays: 1,
    allowedActions: ["make_transaction"],
    flavour: "terminal_failure",
  },
  {
    key: "family_mapping",
    name: "Family Mapping",
    description: "Link to spouse / parents / children for household view.",
    order: 28,
    ownerRole: "sales",
    requiredFields: [],
    slaDays: 7,
    allowedActions: ["update_information"],
  },
  {
    key: "update_information",
    name: "Update Information",
    description: "Master record enriched: goals, occupation, income, nominee.",
    order: 29,
    ownerRole: "sales",
    requiredFields: [],
    slaDays: 3,
    allowedActions: ["add_in_review_sheet"],
  },
  {
    key: "add_in_review_sheet",
    name: "Active Client",
    description: "Onboarding complete. Added to the quarterly review sheet.",
    order: 30,
    ownerRole: "sales",
    requiredFields: [],
    allowedActions: [],
    automationsOnEnter: ["client_review_cadence_init"],
    flavour: "terminal_success",
  },

  // ───────────────────────── INSURANCE ONBOARDING BRANCH ──
  // Parallel onboarding journey for insurance-led clients. Forks from "Won
  // Lead" when the client's primary product is Insurance (leads.pipeline =
  // "insurance"). Rendered instead of the MF onboarding (request_documents …)
  // when the lead is on the insurance branch — see PRODUCT_BRANCH below.
  {
    key: "insurance_needs_analysis",
    name: "Needs Analysis",
    description: "Assess the client's protection gap, dependents, liabilities and goals.",
    order: 31,
    ownerRole: "sales",
    requiredFields: [],
    slaDays: 2,
    allowedActions: ["insurance_quote"],
  },
  {
    key: "insurance_quote",
    name: "Quote Shared",
    description: "Illustrations / premium quotes shared for the recommended cover.",
    order: 32,
    ownerRole: "sales",
    requiredFields: [],
    slaDays: 3,
    allowedActions: ["insurance_proposal", "insurance_lost"],
  },
  {
    key: "insurance_proposal",
    name: "Proposal Filled",
    description: "Proposal form completed; KYC + medicals collected.",
    order: 33,
    ownerRole: "operations",
    requiredFields: [],
    slaDays: 2,
    allowedActions: ["insurance_underwriting"],
  },
  {
    key: "insurance_underwriting",
    name: "Underwriting",
    description: "Submitted to the insurer; underwriting / medicals in progress.",
    order: 34,
    ownerRole: "operations",
    requiredFields: [],
    slaDays: 10,
    allowedActions: ["insurance_policy_issued", "insurance_lost"],
  },
  {
    key: "insurance_policy_issued",
    name: "Policy Issued",
    description: "Policy issued and in force — client onboarded on insurance.",
    order: 35,
    ownerRole: "operations",
    requiredFields: [],
    allowedActions: [],
    flavour: "terminal_success",
  },
  {
    key: "insurance_lost",
    name: "Not Proceeded",
    description: "Client did not proceed / proposal declined.",
    order: 36,
    ownerRole: "sales",
    requiredFields: [],
    allowedActions: ["insurance_needs_analysis"],
    flavour: "terminal_failure",
  },
];

/** Onboarding stage keys per product branch — drives journey-bar filtering. */
export const MF_ONBOARDING_KEYS = [
  "request_documents", "documents_pending", "documents_received",
  "kyc_validated", "kyc_registered", "kyc_pending", "modify_kyc", "physical_kyc", "online_kyc",
  "ucc_create", "ucc_activated", "mandate_create", "mandate_activated", "mandate_reject",
  "make_transaction", "transaction_successful", "transaction_failed",
  "family_mapping", "update_information", "add_in_review_sheet",
] as const;

export const INSURANCE_ONBOARDING_KEYS = [
  "insurance_needs_analysis", "insurance_quote", "insurance_proposal",
  "insurance_underwriting", "insurance_policy_issued", "insurance_lost",
] as const;

/** Entry stage for the insurance onboarding branch (from Won Lead). */
export const INSURANCE_ENTRY_STAGE = "insurance_needs_analysis";

/**
 * Products the firm can onboard a client into. The PRIMARY product chosen on
 * "Won Lead" decides which onboarding branch (pipeline) the journey takes.
 */
export const LEAD_PRODUCTS = [
  { value: "mutual_funds", label: "Mutual Funds", pipeline: "mf" },
  { value: "insurance", label: "Insurance", pipeline: "insurance" },
  { value: "stocks_pms_aif", label: "Stocks / PMS / AIF", pipeline: "general" },
  { value: "nps", label: "NPS", pipeline: "general" },
  { value: "fd_bonds", label: "FD / Bonds", pipeline: "general" },
  { value: "other", label: "Other", pipeline: "general" },
] as const;

export type LeadProduct = (typeof LEAD_PRODUCTS)[number]["value"];

/** Map a primary product to its sales pipeline (mf | insurance | general). */
export function productToPipeline(primary: string): "mf" | "insurance" | "general" {
  return LEAD_PRODUCTS.find((p) => p.value === primary)?.pipeline ?? "mf";
}

/** Which onboarding branch a stage belongs to (null = shared / lead phase). */
export function onboardingBranchOf(stageKey: string): "mf" | "insurance" | null {
  if ((INSURANCE_ONBOARDING_KEYS as readonly string[]).includes(stageKey)) return "insurance";
  if ((MF_ONBOARDING_KEYS as readonly string[]).includes(stageKey)) return "mf";
  return null;
}

/**
 * Disposition of an instance once it reaches a given stage.
 *
 *   - `completed` — the success terminal (Active Client). Freeze the instance.
 *   - `lost`      — a lead-phase dead-end (Not Qualified). Closed-lost.
 *   - `in_progress` — everything else, INCLUDING the client-phase
 *     "terminal_failure" stages (Mandate Rejected, Transaction Failed) which
 *     are really *retry* states with forward transitions back into the flow,
 *     so they must NOT be frozen.
 *
 * Replaces the old `stageOrder === LEAD_TO_CLIENT_STAGES.length` check, which
 * only ever marked stage 30 terminal and left lost leads stuck "in_progress".
 */
export function stageDisposition(stageKey: string): "completed" | "lost" | "in_progress" {
  const s = LEAD_TO_CLIENT_STAGES.find((x) => x.key === stageKey);
  if (!s) return "in_progress";
  if (s.flavour === "terminal_success") return "completed";
  if (s.flavour === "terminal_failure" && s.order <= LEAD_PHASE_LAST_ORDER) return "lost";
  // The insurance branch's "Not Proceeded" is a genuine closed-lost terminal
  // (unlike the MF retry-failure stages), so close the journey out.
  if (stageKey === "insurance_lost") return "lost";
  return "in_progress";
}

/**
 * Branching transition graph. Each row: from → to.
 * Backwards transitions (reopen, retry) included explicitly so the
 * engine accepts them without systemBypass.
 */
export const LEAD_TO_CLIENT_TRANSITIONS: Array<{
  from: string;
  to: string;
  name: string;
  allowedRoles?: string[];
}> = [
  // ─── New Lead → 4 branches ─────────────────────────────────────
  { from: "new", to: "call_done", name: "Call Done" },
  { from: "new", to: "call_back_later", name: "Call Back Later" },
  { from: "new", to: "call_not_connected", name: "Call Not Connected" },
  { from: "new", to: "contact_in_future", name: "Contact in Future" },

  // ─── Call Done → Meeting decision ──────────────────────────────
  { from: "call_done", to: "meeting_scheduled", name: "Schedule Meeting" },
  { from: "call_done", to: "meeting_pending", name: "Meeting Tentative" },
  { from: "call_done", to: "not_qualified", name: "Not Qualified" },

  // ─── Call Back Later / Not Connected loops ─────────────────────
  { from: "call_back_later", to: "call_done", name: "Reached on Retry" },
  { from: "call_back_later", to: "call_not_connected", name: "Still No Answer" },
  { from: "call_back_later", to: "contact_in_future", name: "Defer Long-term" },
  { from: "call_not_connected", to: "call_done", name: "Eventually Reached" },
  { from: "call_not_connected", to: "call_back_later", name: "Retry Tomorrow" },
  { from: "call_not_connected", to: "contact_in_future", name: "Long-term Nurture" },
  { from: "contact_in_future", to: "call_done", name: "Resurfaced / Reached" },
  { from: "contact_in_future", to: "not_qualified", name: "Confirmed Not Interested" },

  // ─── Meeting flow ──────────────────────────────────────────────
  { from: "meeting_scheduled", to: "meeting_done", name: "Meeting Completed" },
  { from: "meeting_scheduled", to: "meeting_pending", name: "Awaiting Confirmation" },
  // Client no-show — drop back into long-term nurture (with a re-engage reminder)
  // instead of forcing a premature won/lost or leaving the meeting "scheduled".
  { from: "meeting_scheduled", to: "contact_in_future", name: "Client No-show" },
  { from: "meeting_pending", to: "meeting_done", name: "Meeting Completed" },
  { from: "meeting_pending", to: "meeting_scheduled", name: "Confirmed / Rescheduled" },
  { from: "meeting_pending", to: "contact_in_future", name: "Client No-show" },
  { from: "meeting_done", to: "won_lead", name: "Qualified — Win" },
  { from: "meeting_done", to: "not_qualified", name: "Not a Fit" },
  // MFD sales usually take 2-3 meetings — allow booking a follow-up without
  // forcing a premature won/lost call.
  { from: "meeting_done", to: "meeting_scheduled", name: "Schedule Follow-up Meeting" },

  // ─── Not Qualified reopen (rare) ───────────────────────────────
  { from: "not_qualified", to: "call_done", name: "Reopen Lead" },

  // ─── Won Lead → Onboarding kickoff ─────────────────────────────
  // Two paths matching the reference SOP: request docs OR mark already received.
  { from: "won_lead", to: "request_documents", name: "Request Documents" },
  { from: "won_lead", to: "documents_received", name: "Documents Already Received" },

  // ─── Document collection ───────────────────────────────────────
  { from: "request_documents", to: "documents_pending", name: "Waiting on Client" },
  { from: "request_documents", to: "documents_received", name: "Docs Received" },
  { from: "documents_pending", to: "documents_received", name: "Docs Received" },

  // ─── KYC paths (3-way branch) ──────────────────────────────────
  { from: "documents_received", to: "kyc_validated", name: "Existing KYC Validated" },
  { from: "documents_received", to: "kyc_registered", name: "Fresh KYC Registered" },
  { from: "documents_received", to: "kyc_pending", name: "KYC Verification Pending" },
  { from: "kyc_registered", to: "kyc_validated", name: "Validation Complete" },
  { from: "kyc_registered", to: "modify_kyc", name: "Needs Modification" },
  { from: "kyc_pending", to: "physical_kyc", name: "Physical Route" },
  { from: "kyc_pending", to: "online_kyc", name: "Online Route" },
  { from: "modify_kyc", to: "kyc_validated", name: "Modification Done" },
  { from: "physical_kyc", to: "kyc_validated", name: "IPV Complete" },
  { from: "online_kyc", to: "kyc_validated", name: "e-KYC Complete" },

  // ─── UCC — normal + skip path ──────────────────────────────────
  { from: "kyc_validated", to: "ucc_create", name: "Create UCC" },
  { from: "kyc_validated", to: "ucc_activated", name: "UCC Already Active" },
  { from: "ucc_create", to: "ucc_activated", name: "UCC Active" },

  // ─── Mandate — normal + skip path + direct rejection ───────────
  { from: "ucc_activated", to: "mandate_create", name: "Register Mandate" },
  { from: "ucc_activated", to: "mandate_activated", name: "Mandate Already Active" },
  { from: "ucc_activated", to: "mandate_reject", name: "Record Bank Rejection" },
  { from: "mandate_create", to: "mandate_activated", name: "Mandate Active" },
  { from: "mandate_create", to: "mandate_reject", name: "Bank Rejected" },
  { from: "mandate_reject", to: "mandate_create", name: "Retry Mandate" },

  // ─── Transaction ───────────────────────────────────────────────
  { from: "mandate_activated", to: "make_transaction", name: "Place First Order" },
  { from: "make_transaction", to: "transaction_successful", name: "Order Successful" },
  { from: "make_transaction", to: "transaction_failed", name: "Order Failed" },
  { from: "transaction_failed", to: "make_transaction", name: "Retry Order" },

  // ─── Post-investment ───────────────────────────────────────────
  { from: "transaction_successful", to: "family_mapping", name: "Map Family" },
  { from: "family_mapping", to: "update_information", name: "Enrich Master" },
  { from: "update_information", to: "add_in_review_sheet", name: "Add to Review" },

  // ─── Won Lead → Insurance onboarding branch ────────────────────
  { from: "won_lead", to: "insurance_needs_analysis", name: "Start Insurance Onboarding" },
  { from: "insurance_needs_analysis", to: "insurance_quote", name: "Share Quote" },
  { from: "insurance_quote", to: "insurance_proposal", name: "Proposal Filled" },
  { from: "insurance_quote", to: "insurance_lost", name: "Dropped" },
  { from: "insurance_proposal", to: "insurance_underwriting", name: "Submit to Insurer" },
  { from: "insurance_underwriting", to: "insurance_policy_issued", name: "Policy Issued" },
  { from: "insurance_underwriting", to: "insurance_lost", name: "Declined" },
  { from: "insurance_lost", to: "insurance_needs_analysis", name: "Reopen" },
];
