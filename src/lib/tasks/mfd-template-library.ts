/**
 * MFD Task Template Library — a researched, ready-to-use set of Standard
 * Operating Procedures for an Indian Mutual Fund Distributor's day-to-day
 * financial + service work. Each entry is a MAIN task with the exact sub-tasks
 * (checklist) needed to execute it end-to-end so a team member can pick it up
 * and run it without confusion.
 *
 * The admin installs these into the tenant's `task_templates` (one click); the
 * team then applies a template from the New Task form and DELEGATES individual
 * sub-tasks to teammates (each delegate is notified and can open the task).
 *
 * Sub-tasks are ordered as the real operational flow (cut-off timing, KYC/UCC/
 * mandate prerequisites, platform execution on BSE Star MF / NSE NMF II, RTA
 * (CAMS/KFintech) confirmation, client communication, CRM record + filing).
 *
 * `taskType` maps to the CRM's fixed enum (follow_up | review_meeting |
 * collect_document | kyc_renewal | custom); the financial transactions use
 * "custom".
 */

export type MfdTaskTemplate = {
  /** Stable key — used to detect "already installed" and for idempotent installs. */
  key: string;
  name: string;
  description: string;
  taskType: "follow_up" | "review_meeting" | "collect_document" | "kyc_renewal" | "custom";
  department:
    | "sales"
    | "operations"
    | "back_office"
    | "compliance"
    | "marketing"
    | "advisory"
    | "support"
    | "leadership"
    | "other";
  priority: "low" | "normal" | "high" | "urgent";
  dueOffsetDays: number;
  /** Grouping for the picker UI. */
  group: "Transactions" | "Systematic Plans" | "Onboarding & KYC" | "Servicing" | "Advisory";
  subtasks: string[];
};

export const MFD_TASK_TEMPLATE_LIBRARY: MfdTaskTemplate[] = [
  // ─────────────────────────── Transactions ───────────────────────────
  {
    key: "lumpsum_purchase",
    name: "Lumpsum / One-time Purchase",
    description: "Execute a one-time (fresh or additional) mutual fund purchase for a client, before cut-off, with suitability + payment confirmation.",
    taskType: "custom",
    department: "operations",
    priority: "high",
    dueOffsetDays: 1,
    group: "Transactions",
    subtasks: [
      "Confirm scheme, amount and mode (fresh folio vs additional purchase) with the client",
      "Verify client KYC is valid and folio / UCC is active",
      "Confirm scheme suitability against the client's risk profile and record the client's go-ahead",
      "Collect payment instruction (net-banking / UPI / cheque / RTGS) — check the cut-off (2:30 PM liquid, 3:00 PM other schemes) for same-day NAV",
      "Place the purchase order on BSE Star MF / NSE NMF II before cut-off",
      "Confirm payment realisation / mandate debit success",
      "Share order confirmation + expected units-allotment date with the client",
      "Record the transaction in the CRM and reconcile units on allotment",
      "File payment proof + order confirmation in the client's documents",
    ],
  },
  {
    key: "additional_purchase",
    name: "Additional Purchase (existing folio)",
    description: "Top-up an existing folio for a client — quick execution before cut-off.",
    taskType: "custom",
    department: "operations",
    priority: "normal",
    dueOffsetDays: 1,
    group: "Transactions",
    subtasks: [
      "Confirm folio, scheme and top-up amount with the client",
      "Verify KYC valid and folio active",
      "Reconfirm suitability and record the client's approval",
      "Collect payment before the applicable cut-off",
      "Place the additional-purchase order on the platform",
      "Confirm units allotment and update the CRM holding",
    ],
  },
  {
    key: "redemption",
    name: "Redemption (full / partial)",
    description: "Process a client redemption with exit-load, lock-in and tax checks, then confirm proceeds.",
    taskType: "custom",
    department: "operations",
    priority: "high",
    dueOffsetDays: 1,
    group: "Transactions",
    subtasks: [
      "Confirm scheme, units/amount, redemption type (full/partial) and the bank account for credit",
      "Check exit load and holding period; flag STCG/LTCG tax impact to the client",
      "Verify there is no lien / pledge / lock-in (e.g. ELSS 3-year) on the units",
      "Obtain the client's authorised redemption request (signed form / online authorisation)",
      "Place the redemption before cut-off; note the T+2/T+3 settlement date",
      "Confirm redemption proceeds are credited to the registered bank account",
      "Update CRM holdings and notify the client with the realised amount",
      "Advise on reinvestment / tax-harvesting where relevant",
    ],
  },
  {
    key: "switch",
    name: "Switch (within same AMC)",
    description: "Move a client's investment from one scheme to another in the same AMC, with tax + load checks.",
    taskType: "custom",
    department: "operations",
    priority: "normal",
    dueOffsetDays: 1,
    group: "Transactions",
    subtasks: [
      "Confirm source scheme, target scheme (same AMC) and amount/units",
      "Check exit load on the source and confirm suitability of the target scheme",
      "Explain that a switch is a redemption + purchase → capital-gains tax may apply",
      "Get the client's approval and place the switch order before cut-off",
      "Confirm switch-out NAV and switch-in units allotment",
      "Update CRM holdings for both schemes and inform the client",
    ],
  },
  {
    key: "nfo_investment",
    name: "NFO Investment",
    description: "Invest a client in a New Fund Offer within the subscription window.",
    taskType: "custom",
    department: "operations",
    priority: "normal",
    dueOffsetDays: 2,
    group: "Transactions",
    subtasks: [
      "Share the NFO note and confirm suitability + the client's interest",
      "Verify KYC / UCC is active",
      "Collect application + payment within the NFO window (note the NFO close date)",
      "Place the NFO order on the platform before the NFO closes",
      "Confirm allotment (units at face value) after the NFO",
      "Record in the CRM and set a post-listing review reminder",
    ],
  },

  // ─────────────────────────── Systematic Plans ───────────────────────────
  {
    key: "sip_registration",
    name: "New SIP Registration",
    description: "Register a fresh Systematic Investment Plan end-to-end — suitability, mandate, platform registration and confirmation.",
    taskType: "custom",
    department: "operations",
    priority: "high",
    dueOffsetDays: 2,
    group: "Systematic Plans",
    subtasks: [
      "Confirm scheme, SIP amount, frequency (monthly/quarterly), SIP date and tenure with the client",
      "Verify client KYC is valid and folio / UCC is active (create UCC if the client is new)",
      "Check scheme suitability against the client's risk profile",
      "Confirm an active bank mandate (e-NACH / eMandate) covers the SIP amount — register one if not active",
      "Fill the SIP registration on BSE Star MF / NSE NMF II",
      "Check the first-installment date against mandate activation lead time (T+21/30)",
      "Send the SIP confirmation + mandate approval link to the client (WhatsApp/email)",
      "Record the SIP in the CRM (folio, scheme, amount, date) and set a first-debit reminder",
      "File the signed form / confirmation in the client's documents",
    ],
  },
  {
    key: "sip_modification",
    name: "SIP Modification (pause / stop / change)",
    description: "Pause, stop or change the amount/date of an existing SIP, honouring platform notice periods.",
    taskType: "custom",
    department: "operations",
    priority: "normal",
    dueOffsetDays: 1,
    group: "Systematic Plans",
    subtasks: [
      "Confirm the client's exact request (pause N months / stop / change amount or date)",
      "Check the platform cut-off / notice period before the next debit",
      "For an amount increase, verify the mandate limit covers it — re-register the mandate if needed",
      "Submit the modification request on the platform",
      "Confirm the effective date and update the CRM SIP record",
      "Notify the client with the confirmation and next-debit details",
    ],
  },
  {
    key: "swp_setup",
    name: "SWP (Systematic Withdrawal Plan) Setup",
    description: "Set up a regular withdrawal for a client with corpus-longevity and tax guidance.",
    taskType: "custom",
    department: "advisory",
    priority: "normal",
    dueOffsetDays: 2,
    group: "Systematic Plans",
    subtasks: [
      "Confirm scheme, withdrawal amount, frequency, start date and payout bank",
      "Verify sufficient corpus and discuss depletion / return assumptions with the client",
      "Flag that each withdrawal is treated as a redemption for tax",
      "Collect the signed SWP form / register online",
      "Register the SWP on the platform and set a first-payout reminder",
      "Record the SWP in the CRM and schedule a periodic corpus-longevity review",
    ],
  },
  {
    key: "stp_setup",
    name: "STP (Systematic Transfer Plan) Setup",
    description: "Stagger a lumpsum into equity via a Systematic Transfer Plan from a liquid/debt source.",
    taskType: "custom",
    department: "operations",
    priority: "normal",
    dueOffsetDays: 2,
    group: "Systematic Plans",
    subtasks: [
      "Confirm source scheme (usually liquid/debt), target scheme, transfer amount, frequency and tenure",
      "Verify the source folio has sufficient balance",
      "Explain that each transfer is a redemption from the source → tax may apply",
      "Collect the signed STP form / register online",
      "Set up the STP on the platform and confirm the first transfer date",
      "Record the STP in the CRM and set a completion / review reminder",
    ],
  },

  // ─────────────────────────── Onboarding & KYC ───────────────────────────
  {
    key: "client_onboarding",
    name: "New Client Onboarding (KYC → UCC → Mandate)",
    description: "Take a new client from documents to investment-ready: KYC, nominee, UCC creation, mandate and risk profiling.",
    taskType: "collect_document",
    department: "operations",
    priority: "high",
    dueOffsetDays: 3,
    group: "Onboarding & KYC",
    subtasks: [
      "Collect KYC documents: PAN, Aadhaar, photograph, cancelled cheque / bank proof, address proof",
      "Verify PAN–Aadhaar link and KYC status on CVL / CAMS-KRA",
      "Complete / upload KYC (online or physical) if the client is not KYC-registered",
      "Capture nominee details (or a signed nomination opt-out declaration)",
      "Create the UCC (Unique Client Code) on BSE Star MF / NSE NMF II",
      "Register an e-NACH / eMandate for future SIPs and purchases",
      "Complete risk profiling and record the suitability outcome",
      "Send the client a welcome message + 'account ready' confirmation",
      "File all documents in the client record",
    ],
  },
  {
    key: "rekyc_modification",
    name: "Re-KYC / KYC Modification",
    description: "Update a client's KYC (address / bank / contact) or refresh an expired KYC with the KRA.",
    taskType: "kyc_renewal",
    department: "compliance",
    priority: "high",
    dueOffsetDays: 3,
    group: "Onboarding & KYC",
    subtasks: [
      "Identify what is changing (address / bank / mobile / email / KYC expired)",
      "Collect the updated proof documents",
      "Submit the KYC modification to the KRA / CAMS-KRA",
      "Track the KYC status until it shows 'Validated / Registered'",
      "Update the details on all folios / UCC and in the CRM",
      "Confirm to the client once validated",
    ],
  },
  {
    key: "mandate_registration",
    name: "Bank Mandate (e-NACH / eMandate) Registration",
    description: "Register an auto-debit mandate so SIPs and purchases can be executed without manual payment.",
    taskType: "custom",
    department: "operations",
    priority: "high",
    dueOffsetDays: 2,
    group: "Onboarding & KYC",
    subtasks: [
      "Confirm the bank account for the mandate and the maximum debit amount (cover the largest expected SIP)",
      "Initiate e-NACH (net-banking / debit-card) or a physical NACH form",
      "Send the mandate approval / authentication link to the client",
      "Track the mandate status until 'Approved / Active' (T+21/30 for physical)",
      "Link the active mandate to any pending SIPs / purchases",
      "Update the CRM mandate status and notify the client",
    ],
  },

  // ─────────────────────────── Servicing ───────────────────────────
  {
    key: "nominee_update",
    name: "Nominee Registration / Update",
    description: "Add or update nominee(s) across a client's folios with the RTA.",
    taskType: "custom",
    department: "compliance",
    priority: "normal",
    dueOffsetDays: 3,
    group: "Servicing",
    subtasks: [
      "Confirm nominee name(s), relationship, DOB and % allocation (or a nomination opt-out)",
      "Collect the signed nomination declaration — capture guardian details if the nominee is a minor",
      "Submit the nomination update to the RTA (CAMS / KFintech) for all folios",
      "Confirm the nomination is reflected and update the CRM nominee fields",
      "Inform the client that the nomination is recorded",
    ],
  },
  {
    key: "folio_consolidation",
    name: "Folio Consolidation / Common Account Statement",
    description: "Pull the client's full holdings (CAS) and consolidate duplicate folios.",
    taskType: "custom",
    department: "back_office",
    priority: "low",
    dueOffsetDays: 5,
    group: "Servicing",
    subtasks: [
      "Pull the Common Account Statement (CAS) from CAMS / KFintech and list all folios across AMCs",
      "Identify duplicate folios per AMC eligible for consolidation",
      "Submit the folio-consolidation request to the RTA",
      "Verify the consolidated folio and updated holdings",
      "Update the CRM and share the consolidated statement with the client",
    ],
  },
  {
    key: "transaction_failure_followup",
    name: "Failed Transaction / SIP Bounce Follow-up",
    description: "Recover a rejected SIP installment or failed purchase and prevent recurrence.",
    taskType: "follow_up",
    department: "operations",
    priority: "high",
    dueOffsetDays: 1,
    group: "Servicing",
    subtasks: [
      "Identify the failure reason (insufficient balance / mandate inactive / KYC / technical)",
      "Contact the client to arrange funds or fix the underlying issue",
      "Re-present the debit / re-place the order, or register/repair the mandate as needed",
      "Confirm the successful debit / allotment",
      "Update the CRM and note steps taken to avoid a repeat",
    ],
  },

  // ─────────────────────────── Advisory ───────────────────────────
  {
    key: "portfolio_review",
    name: "Portfolio Review Meeting",
    description: "Prepare, conduct and follow up a periodic portfolio review with the client.",
    taskType: "review_meeting",
    department: "advisory",
    priority: "normal",
    dueOffsetDays: 7,
    group: "Advisory",
    subtasks: [
      "Pull the latest portfolio valuation, XIRR and asset allocation",
      "Check goal progress and any rebalancing need vs the client's risk profile",
      "Review SIP health, dormant folios and KYC / nominee gaps",
      "Prepare the review deck / talking points",
      "Schedule and confirm the meeting slot with the client",
      "Conduct the review and capture agreed action points",
      "Send the meeting summary + action plan to the client",
      "Log the outcomes and set the next review date in the CRM",
    ],
  },
];
