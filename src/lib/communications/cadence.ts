/**
 * Client Communication Cadence — adopted from Network FP "5.5 Client
 * Communication Checklist".
 *
 * The firm's standard touchpoint policy: what gets communicated, how
 * often, on which channel — plus response-time SLAs and the compliance
 * rule. This is the SOP the firm's workflows/automations should honour
 * and the artifact a DDQ reviewer wants to see.
 *
 * Pure data — rendered by the cadence reference page. No DB.
 */

export type CadenceRow = {
  purpose: string;
  frequency: string;
  channel: string;
  /** Maps to an existing recipe/workflow category where one applies. */
  automatable: boolean;
  note?: string;
};

export const COMMUNICATION_MATRIX: CadenceRow[] = [
  {
    purpose: "Transaction confirmations",
    frequency: "Real-time",
    channel: "Email",
    automatable: true,
    note: "Auto-fired on every successful purchase/redemption/SIP.",
  },
  {
    purpose: "Portfolio reporting",
    frequency: "Monthly",
    channel: "Email / WhatsApp",
    automatable: true,
    note: "Monthly statement / CAS summary.",
  },
  {
    purpose: "Portfolio review meetings",
    frequency: "Half-yearly or annual (by tier)",
    channel: "In-person / Virtual",
    automatable: false,
    note: "Cadence per service tier — A quarterly, B half-yearly, C annual.",
  },
  {
    purpose: "Birthday / anniversary wishes",
    frequency: "Annually",
    channel: "WhatsApp",
    automatable: true,
    note: "Greeting recipe keyed off DOB / onboarding date.",
  },
  {
    purpose: "Market updates",
    frequency: "Weekly / Monthly / Quarterly",
    channel: "Email / WhatsApp channel",
    automatable: true,
    note: "Plus event-triggered notes on significant market moves.",
  },
  {
    purpose: "Regulatory / compliance alerts",
    frequency: "As needed",
    channel: "Email / WhatsApp channel",
    automatable: true,
    note: "KYC renewal, nominee, FATCA, re-KYC reminders.",
  },
  {
    purpose: "Feedback surveys",
    frequency: "Annual",
    channel: "Email / WhatsApp",
    automatable: true,
    note: "CSAT + NPS pulse to track service quality.",
  },
];

export type ResponseSla = {
  trigger: string;
  target: string;
};

export const RESPONSE_TIMELINES: ResponseSla[] = [
  { trigger: "Acknowledge client emails / requests", target: "within 24 hours" },
  { trigger: "Resolve client complaints / issues", target: "within 3–5 working days" },
  { trigger: "Proactive update during significant market events", target: "within 48 hours" },
];

export const KEY_FOCUS_AREAS: string[] = [
  "Portfolio reporting",
  "Minutes of meeting (MoM)",
  "Reminders",
  "Greetings & wishes",
  "Goal progress",
  "Market updates",
  "Goal-based communication",
];

export const TAILORING_NOTE =
  "Categorise clients and draft different communications per group — e.g. HNI, Affluent, Retail, mass communication — so each segment gets relevant, right-sized touchpoints.";

export const COMPLIANCE_NOTE =
  "Display your name and the AMFI tagline in a clear, legible font on all forms of communication. Every outbound passes the compliance gate before send.";
