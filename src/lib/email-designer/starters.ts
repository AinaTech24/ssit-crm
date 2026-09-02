/**
 * Starter email templates — a "pre-designed gallery" (Zoho-style) the user can
 * pick from when creating a new email template, then customise in the designer.
 *
 * Each starter is a full EmailDesignerBody (designer mode). Blocks carry stable
 * placeholder ids; `applyStarter()` re-ids them so they never collide. Merge
 * fields ({{investor.name}}, {{tenant.displayName}}, …) resolve at send time.
 */

import type { EmailDesignerBody, EmailBlock } from "./types";

export type StarterTemplate = {
  key: string;
  name: string;
  description: string;
  /** "transactional" | "utility" | "marketing" — sensible default category. */
  category: "transactional" | "utility" | "marketing";
  /** "client" (default) — sent to investors/leads; "internal" — sent to team/owner. */
  audience?: "client" | "internal";
  body: EmailDesignerBody;
};

/** Footer for internal/team emails — no ARN/address/unsubscribe, just a notice. */
const INTERNAL_FOOTER = {
  includeArn: false,
  includeAddress: false,
  includeUnsubscribe: false,
  customText: "Internal communication — for team use only. Please do not forward to clients.",
};

const AMFI_DISCLAIMER =
  "Mutual fund investments are subject to market risks. Read all scheme related documents carefully. Past performance is not indicative of future returns.";

const INSURANCE_DISCLAIMER =
  "Insurance is the subject matter of solicitation. For full details of benefits, exclusions and terms, please refer to your policy document and consult your advisor before deciding.";

/** Standard advisor sign-off used across investor-facing templates. */
const SIGNOFF =
  "Warm regards,<br>{{investor.rm_name}}<br>{{tenant.displayName}}";

/** Tiny id helper for the static starter blocks (re-id'd on apply). */
let _n = 0;
const b = (block: Omit<EmailBlock, "id">): EmailBlock => ({ id: `s${++_n}`, ...(block as any) });

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    key: "welcome",
    name: "Welcome / Onboarding",
    description: "Warm welcome for a newly onboarded client.",
    category: "transactional",
    body: {
      subject: "Welcome to {{tenant.displayName}}, {{investor.name}} 🎉",
      preheader: "We're delighted to have you on board.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "Welcome, {{investor.name}}!", subtitle: "Your wealth journey with us starts today.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>Thank you for trusting <b>{{tenant.displayName}}</b> with your investments. Your dedicated relationship manager, {{investor.rm_name}}, is here to help you reach your goals.", align: "left" } as any),
        b({ type: "button", label: "Visit our website", url: "{{tenant.websiteUrl}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "divider", thickness: 1, color: "#e5e7eb" } as any),
        b({ type: "text", html: "Have a question? Just reply to this email — we're always happy to help.", align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },
  {
    key: "sip_confirmation",
    name: "SIP Confirmation",
    description: "Confirm a newly registered or processed SIP.",
    category: "transactional",
    body: {
      subject: "Your SIP is confirmed ✅",
      preheader: "Details of your SIP registration.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "SIP Confirmed", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Hi {{investor.name}},<br><br>Your SIP has been set up successfully. Here are the details:", align: "left" } as any),
        b({ type: "data_table", caption: "", rows: [
          { label: "Scheme", value: "{{transaction.scheme_name}}" },
          { label: "Amount", value: "₹{{transaction.amount}}" },
          { label: "Folio", value: "{{transaction.folio_number}}" },
          { label: "Date", value: "{{transaction.transaction_date}}" },
        ] } as any),
        b({ type: "text", html: "Consistency is the key to long-term wealth. We'll keep you posted on every installment.", align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },
  {
    key: "goal_review",
    name: "Goal Review Nudge",
    description: "Invite the client to review progress on a financial goal.",
    category: "utility",
    body: {
      subject: "Let's review your goal, {{investor.name}}",
      preheader: "A quick check-in on your financial goal.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "How's your goal tracking?", subtitle: "A short review keeps you on course.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Hi {{investor.name}},<br><br>It's a good time to review your goal and make sure your investments are still on track. A few minutes now can make a big difference later.", align: "left" } as any),
        b({ type: "button", label: "Book a review call", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "quote", text: "The best time to plant a tree was 20 years ago. The second best time is now.", author: "" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },
  {
    key: "newsletter",
    name: "Monthly Newsletter",
    description: "Market commentary + a call to action for marketing sends.",
    category: "marketing",
    body: {
      subject: "{{tenant.displayName}} — This Month in Markets",
      preheader: "Your monthly market round-up.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "This Month in Markets", subtitle: "What moved, and what it means for you.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "heading", text: "Market snapshot", level: "h3", align: "left" } as any),
        b({ type: "text", html: "Hi {{investor.name}},<br><br>Here's a quick look at how the markets performed this month and what we're watching going forward.", align: "left" } as any),
        b({ type: "button", label: "Read the full update", url: "{{tenant.websiteUrl}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "divider", thickness: 1, color: "#e5e7eb" } as any),
        b({ type: "social", links: { website: "{{tenant.websiteUrl}}", linkedin: "", facebook: "", instagram: "", youtube: "", twitter: "" } } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },
  {
    key: "review_meeting",
    name: "Portfolio Review Invite",
    description: "Invite a client to schedule a portfolio review meeting.",
    category: "utility",
    body: {
      subject: "Time for your portfolio review, {{investor.name}}",
      preheader: "Let's make sure your plan is on track.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Your portfolio review is due", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Hi {{investor.name}},<br><br>It's been a while since we reviewed your portfolio together. A periodic review helps us rebalance, harvest tax-free gains, and keep you aligned with your goals.", align: "left" } as any),
        b({ type: "button", label: "Pick a time", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: "Warm regards,<br>{{investor.rm_name}}<br>{{tenant.displayName}}", align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },
  {
    key: "festival_greeting",
    name: "Festival / Greeting",
    description: "A simple, warm festival or birthday greeting.",
    category: "marketing",
    body: {
      subject: "Warm wishes from {{tenant.displayName}} ✨",
      preheader: "Wishing you joy and prosperity.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "Warm wishes, {{investor.name}}", subtitle: "May this season bring you health, happiness and prosperity.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "From all of us at <b>{{tenant.displayName}}</b> — thank you for your continued trust. We look forward to growing your wealth, together.", align: "center" } as any),
        b({ type: "spacer", height: 16 } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: false },
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  //  Lifecycle templates (lead → onboarding → transacting → servicing)
  // ───────────────────────────────────────────────────────────────────────

  // 1) New lead — first-touch thank-you
  {
    key: "lead_welcome",
    name: "Lead — Thank You (First Touch)",
    description: "Sent the first time a lead reaches out — thanks them for taking the first step.",
    category: "transactional",
    body: {
      subject: "Thank you for taking the first step, {{lead.name}} 🙏",
      preheader: "We've received your enquiry and we're here to help.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "Thank you for taking the first step!", subtitle: "Your journey to smarter investing begins here.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Dear {{lead.name}},<br><br>Thank you for showing interest in <b>{{tenant.displayName}}</b>. Reaching out is the most important step toward your financial goals — and we're honoured you chose to take it with us.<br><br>One of our advisors will connect with you shortly to understand your goals and craft a plan tailored to you. In the meantime, feel free to simply reply to this email with any questions.", align: "left" } as any),
        b({ type: "button", label: "Explore our services", url: "{{tenant.websiteUrl}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: "Warm regards,<br>Team {{tenant.displayName}}", align: "left" } as any),
        b({ type: "divider", thickness: 1, color: "#e5e7eb" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  // 2) Referral — thank-you to the referrer
  {
    key: "referral_thanks",
    name: "Referral — Thank You to Referrer",
    description: "Thanks an existing client for referring a friend or family member.",
    category: "utility",
    body: {
      subject: "Thank you for your referral, {{investor.first_name}}! 🤝",
      preheader: "Your trust means the world to us.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "Thank you for referring us!", subtitle: "There's no greater compliment than a referral.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>Thank you for referring your friend to <b>{{tenant.displayName}}</b>. Recommending us to the people you care about is the highest compliment we can receive, and we don't take it lightly.<br><br>We promise to look after everyone you send our way with the same dedication and care we bring to your own portfolio. Your trust inspires us to keep raising the bar.", align: "left" } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "divider", thickness: 1, color: "#e5e7eb" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  // 3) Risk profiling — form request
  {
    key: "risk_profile_request",
    name: "Risk Profile — Form Request",
    description: "Invites the client to complete their risk-profiling questionnaire.",
    category: "utility",
    body: {
      subject: "Let's understand your risk profile, {{investor.first_name}}",
      preheader: "A quick 5-minute form to personalise your plan.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Help us tailor your investments", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>Before we recommend any investment, it's important we understand your comfort with risk, your goals, and your time horizon. This helps us build a portfolio that's right for <i>you</i> — never a one-size-fits-all plan.<br><br>Please take 5 minutes to complete your risk-profiling form using the button below. It's quick, simple, and completely confidential.", align: "left" } as any),
        b({ type: "button", label: "Fill Risk Profile Form", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: true } as any),
        b({ type: "text", html: "If any question is unclear, just reply to this email or call your advisor — we're happy to help.<br><br>" + SIGNOFF, align: "left" } as any),
        b({ type: "divider", thickness: 1, color: "#e5e7eb" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  // 4) Risk profiling — result
  {
    key: "risk_profile_result",
    name: "Risk Profile — Your Result",
    description: "Shares the client's risk-profile outcome and recommended approach.",
    category: "utility",
    body: {
      subject: "Your risk profile result is ready, {{investor.first_name}}",
      preheader: "Here's what your risk profile tells us.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "Your Risk Profile is Ready", subtitle: "Here's what it means for your investment strategy.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>Thank you for completing your risk profiling. Based on your responses, we've prepared a summary of your profile and the investment approach we recommend. Your advisor will walk you through your risk category, a suggested equity-debt mix, and the best way to get started.", align: "left" } as any),
        b({ type: "text", html: "This is a starting point — we'll fine-tune your portfolio together as your goals evolve. Your advisor will walk you through the details and answer any questions.", align: "left" } as any),
        b({ type: "button", label: "Discuss with your advisor", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  // 5) Onboarding — documents request
  {
    key: "documents_onboarding",
    name: "Onboarding — Documents Request",
    description: "Lists the KYC / onboarding documents needed to open the account.",
    category: "transactional",
    body: {
      subject: "A few documents to get you started, {{investor.first_name}}",
      preheader: "Let's complete your onboarding.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Let's complete your onboarding", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>Welcome aboard! To set up your account and begin investing, we'll need a few standard documents. Please keep the following ready:", align: "left" } as any),
        b({ type: "data_table", caption: "Documents required", rows: [
          { label: "PAN Card", value: "Mandatory" },
          { label: "Aadhaar Card", value: "For KYC" },
          { label: "Cancelled Cheque / Bank Proof", value: "For mandate" },
          { label: "Passport-size Photograph", value: "1 recent" },
          { label: "Address Proof", value: "If different from Aadhaar" },
        ] } as any),
        b({ type: "text", html: "You can upload these securely via your client portal, or simply reply to this email with scanned copies. Once received, we'll have you ready to invest within 24–48 hours.", align: "left" } as any),
        b({ type: "button", label: "Upload documents", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "divider", thickness: 1, color: "#e5e7eb" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  // 6) Proposal — send (with attachment)
  {
    key: "proposal_send",
    name: "Proposal — Send (with attachment)",
    description: "Covers the personalised proposal PDF you attach when sending.",
    category: "utility",
    body: {
      subject: "Your personalised investment proposal, {{investor.first_name}}",
      preheader: "Crafted around your goals — please find it attached.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "Your Investment Proposal", subtitle: "Personalised for your goals and risk profile.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>Thank you for the opportunity to plan your investments. Based on our discussion and your risk profile, we've prepared a personalised proposal — <b>attached to this email as a PDF</b>.<br><br>The proposal covers your recommended scheme mix, expected outcomes, and how each investment maps to your goals. Please review it at your convenience.", align: "left" } as any),
        b({ type: "text", html: "We'd love to walk you through it and answer any questions. Shall we schedule a quick call?", align: "left" } as any),
        b({ type: "button", label: "Book a discussion", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "divider", thickness: 1, color: "#e5e7eb" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  // 7) Proposal — approved, thank-you
  {
    key: "proposal_approved",
    name: "Proposal — Approved, Thank You",
    description: "Sent after a client approves their proposal; sets next-step expectations.",
    category: "transactional",
    body: {
      subject: "Thank you for approving your proposal! 🎉",
      preheader: "Let's put your plan into action.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "Thank you, {{investor.first_name}}!", subtitle: "Your proposal is approved — let's get started.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>Wonderful news — thank you for approving your investment proposal! We're excited to begin this journey with you.<br><br><b>Here's what happens next:</b><br>• We'll complete any pending paperwork and mandates<br>• Your first transactions will be initiated as per the plan<br>• You'll receive a confirmation for every investment<br><br>Sit back — we'll take it from here and keep you informed at every step.", align: "left" } as any),
        b({ type: "button", label: "View your plan", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "divider", thickness: 1, color: "#e5e7eb" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  // 8) Transaction — confirmation + thank-you for the business
  {
    key: "transaction_confirmation",
    name: "Transaction — Confirmation & Thank You",
    description: "Confirms a new transaction and thanks the client for their business.",
    category: "transactional",
    body: {
      subject: "Transaction confirmed — thank you for your business! ✅",
      preheader: "Here are your transaction details.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Transaction Confirmed", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>Thank you for your continued trust in <b>{{tenant.displayName}}</b>. We're pleased to confirm your recent transaction:", align: "left" } as any),
        b({ type: "data_table", caption: "Transaction details", rows: [
          { label: "Scheme", value: "{{transaction.scheme_name}}" },
          { label: "Type", value: "{{transaction.type}}" },
          { label: "Amount", value: "₹{{transaction.amount}}" },
          { label: "Folio", value: "{{transaction.folio_number}}" },
          { label: "Date", value: "{{transaction.transaction_date}}" },
        ] } as any),
        b({ type: "text", html: "Every investment is a step closer to your goals — thank you for letting us be part of your journey. You can track this and all your investments anytime on your portal.", align: "left" } as any),
        b({ type: "button", label: "View portfolio", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  // 9) Welcome — to the family
  {
    key: "family_welcome",
    name: "Welcome — To the Family",
    description: "Warm welcome to a newly onboarded client as part of the firm's family.",
    category: "transactional",
    body: {
      subject: "Welcome to the {{tenant.displayName}} family, {{investor.first_name}}! 🎉",
      preheader: "We're delighted to have you with us.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "Welcome to the {{tenant.displayName}} family!", subtitle: "We're honoured to be part of your financial journey.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>It's our absolute pleasure to welcome you to the <b>{{tenant.displayName}}</b> family. You're now part of a community we serve with care, discipline, and a genuine commitment to your financial well-being.<br><br><b>Being part of our family means:</b><br>• A dedicated advisor who knows your goals<br>• Transparent, jargon-free guidance<br>• Proactive reviews and timely nudges<br>• Support whenever you need it", align: "left" } as any),
        b({ type: "text", html: "Your relationship manager, {{investor.rm_name}}, will be your point of contact for anything you need. Welcome aboard — here's to growing your wealth, together. 🌱", align: "left" } as any),
        b({ type: "button", label: "Visit your portal", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "quote", text: "Alone we can do so little; together we can do so much.", author: "" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  // 10) SIP — upcoming installment reminder
  {
    key: "sip_reminder",
    name: "SIP — Installment Reminder",
    description: "Reminds the client to keep funds ready before an upcoming SIP debit.",
    category: "utility",
    body: {
      subject: "Your SIP is due soon, {{investor.first_name}}",
      preheader: "A friendly reminder to keep your investments on track.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Your SIP installment is coming up", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>This is a gentle reminder that your upcoming SIP installment is due soon. Please ensure sufficient balance in your bank account so the investment goes through smoothly.", align: "left" } as any),
        b({ type: "data_table", caption: "SIP details", rows: [
          { label: "Scheme", value: "{{transaction.scheme_name}}" },
          { label: "Amount", value: "₹{{transaction.amount}}" },
          { label: "Folio", value: "{{transaction.folio_number}}" },
          { label: "Due date", value: "{{transaction.transaction_date}}" },
        ] } as any),
        b({ type: "text", html: "Staying consistent with your SIPs is one of the most powerful things you can do for long-term wealth. Keep it up! 💪<br><br>If you'd like to pause, modify, or top-up this SIP, just reply to this email.", align: "left" } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  // 11) SIP — rejection / failed installment
  {
    key: "sip_rejection",
    name: "SIP — Rejection / Failed Installment",
    description: "Explains a failed SIP debit and how to get back on track.",
    category: "transactional",
    body: {
      subject: "Action needed: your SIP couldn't be processed",
      preheader: "Let's get your SIP back on track — it's easily fixed.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Your SIP installment was not processed", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>We wanted to let you know that your recent SIP installment could not be processed. There's nothing to worry about — these things happen, and it's easily fixed.", align: "left" } as any),
        b({ type: "data_table", caption: "Details", rows: [
          { label: "Scheme", value: "{{transaction.scheme_name}}" },
          { label: "Amount", value: "₹{{transaction.amount}}" },
          { label: "Folio", value: "{{transaction.folio_number}}" },
          { label: "Reason", value: "{{transaction.rejection_reason}}" },
        ] } as any),
        b({ type: "text", html: "<b>What you can do:</b><br>• Ensure sufficient balance in your bank account<br>• Check that your bank mandate (NACH) is active<br>• Reply to this email and we'll help you resolve it<br><br>Missing one installment won't derail your goals, but staying consistent matters. We'll make sure the next one goes through smoothly.", align: "left" } as any),
        b({ type: "button", label: "Talk to your advisor", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  // 12) Insurance — renewal reminder
  {
    key: "insurance_renewal",
    name: "Insurance — Renewal Reminder",
    description: "Reminds the client to renew a policy before it lapses.",
    category: "utility",
    body: {
      subject: "Your insurance policy is due for renewal",
      preheader: "Don't let your protection lapse.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "Time to renew your policy", subtitle: "Keep your family's protection unbroken.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>This is a reminder that your insurance policy is due for renewal soon. Renewing on time ensures your coverage — and your family's financial safety net — stays uninterrupted. Reply to this email and we'll share your policy number, sum assured, premium due and exact due date.", align: "left" } as any),
        b({ type: "text", html: "A lapsed policy can mean losing your coverage and benefits — and sometimes a fresh medical check on renewal. Let's avoid that. Reply to this email or call us, and we'll help you renew in minutes.", align: "left" } as any),
        b({ type: "button", label: "Renew now", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "text", html: INSURANCE_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  // 13) Insurance — claim status update
  {
    key: "claim_status",
    name: "Insurance — Claim Status Update",
    description: "Empathetic update on the progress of an insurance claim.",
    category: "transactional",
    body: {
      subject: "Update on your claim, {{investor.first_name}}",
      preheader: "Here's the latest status of your claim.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Your claim status update", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>We understand that a claim often comes at a difficult time, and we're here to support you through it. We're actively working with the insurer on your claim and will keep you posted at every stage.", align: "left" } as any),
        b({ type: "data_table", caption: "Claim status", rows: [
          { label: "Last Updated", value: "{{system.today}}" },
        ] } as any),
        b({ type: "text", html: "We're personally following up with the insurer to ensure your claim is processed as quickly as possible. If you need anything or have questions, please don't hesitate to reach out — we're with you every step of the way.", align: "left" } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "text", html: INSURANCE_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  //  Suggested additions (high-value MFD touchpoints)
  // ───────────────────────────────────────────────────────────────────────

  // 14) KYC / Re-KYC reminder
  {
    key: "kyc_renewal",
    name: "KYC — Re-KYC Reminder",
    description: "Suggested: prompts the client to update KYC so investments stay active.",
    category: "utility",
    body: {
      subject: "Action needed: complete your KYC, {{investor.first_name}}",
      preheader: "A quick step to keep your investments active.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Keep your KYC up to date", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>To keep your investments active and compliant, your KYC details need to be updated/re-verified. This is a quick, regulator-mandated step that also helps protect your account.", align: "left" } as any),
        b({ type: "data_table", caption: "Your KYC", rows: [
          { label: "PAN", value: "{{investor.pan}}" },
          { label: "Status", value: "Update required" },
        ] } as any),
        b({ type: "button", label: "Complete KYC", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: "It only takes a few minutes. Reply to this email if you'd like us to assist you through it.<br><br>" + SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  // 15) Birthday wish
  {
    key: "birthday",
    name: "Birthday Wish",
    description: "Suggested: a warm, personal birthday greeting that strengthens the relationship.",
    category: "marketing",
    body: {
      subject: "Happy Birthday, {{investor.first_name}}! 🎂",
      preheader: "Wishing you health, happiness and prosperity.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "Happy Birthday, {{investor.first_name}}! 🎉", subtitle: "Wishing you a year of health, happiness and prosperity.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>On your special day, all of us at <b>{{tenant.displayName}}</b> wish you joy, good health, and continued success. Thank you for being a valued part of our family — here's to many more milestones, together. 🎁", align: "center" } as any),
        b({ type: "spacer", height: 16 } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: false },
    },
  },

  // 16) Annual portfolio statement
  {
    key: "annual_statement",
    name: "Annual Portfolio Statement",
    description: "Suggested: year-end portfolio snapshot + an invite to the annual review.",
    category: "utility",
    body: {
      subject: "Your annual portfolio statement, {{investor.first_name}}",
      preheader: "Your year in review — and what's next.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Your year in review", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>As another financial year wraps up, here's a snapshot of your investment journey with <b>{{tenant.displayName}}</b>. Your detailed statement — with your total invested, current value, gains and XIRR — is attached for your records.", align: "left" } as any),
        b({ type: "text", html: "We're proud of the progress you've made and excited for the year ahead. Let's schedule your annual review to plan the next chapter together.", align: "left" } as any),
        b({ type: "button", label: "Book annual review", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  //  Meetings & relationship touchpoints
  // ───────────────────────────────────────────────────────────────────────

  // Meeting scheduled / confirmation
  {
    key: "meeting_scheduled",
    name: "Meeting — Scheduled / Confirmation",
    description: "Confirms a newly scheduled meeting with date, time and mode.",
    category: "utility",
    body: {
      subject: "Your meeting is scheduled, {{investor.first_name}}",
      preheader: "Confirming the details of our upcoming meeting.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Your meeting is confirmed", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>Thank you — your meeting with {{investor.rm_name}} is confirmed. The date, time, and joining details are in the calendar invite that accompanies this email.", align: "left" } as any),
        b({ type: "text", html: "Please let us know if you'd like to reschedule. We look forward to speaking with you.", align: "left" } as any),
        b({ type: "button", label: "Add to calendar", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  // Meeting reminder (suggested)
  {
    key: "meeting_reminder",
    name: "Meeting — Reminder",
    description: "Suggested: a day-before reminder of the upcoming meeting.",
    category: "utility",
    body: {
      subject: "Reminder: our meeting is coming up, {{investor.first_name}}",
      preheader: "A quick reminder about our upcoming meeting.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "A reminder about our meeting", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>Just a friendly reminder of our upcoming meeting. The date, time, and joining details are in the original calendar invite.", align: "left" } as any),
        b({ type: "text", html: "If anything has changed on your end, just reply and we'll happily reschedule. See you soon!", align: "left" } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  // Minutes of meeting + thank you
  {
    key: "meeting_minutes",
    name: "Meeting — Minutes & Thank You",
    description: "Post-meeting summary, agreed next steps, and a thank-you for their time.",
    category: "utility",
    body: {
      subject: "Thank you for your time — here's a summary",
      preheader: "Minutes of our meeting and the agreed next steps.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Thank you for your time", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>It was a pleasure meeting with you. Thank you for your time. Here's a quick summary of what we discussed and the next steps we agreed on.", align: "left" } as any),
        b({ type: "text", html: "<b>Next steps / action items:</b><br>We've noted the key points, the decisions we reached, and who will action each item and by when. We'll follow up on these and keep you updated on progress.", align: "left" } as any),
        b({ type: "text", html: "If I've missed anything or you have questions, just reply to this email. Looking forward to moving ahead together.", align: "left" } as any),
        b({ type: "button", label: "View your portal", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  // Follow-up
  {
    key: "follow_up",
    name: "Follow-Up",
    description: "A gentle, no-pressure follow-up after a call, proposal or no response.",
    category: "utility",
    body: {
      subject: "Just following up, {{investor.first_name}}",
      preheader: "Checking in — did you get a chance to review?",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Just following up", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>I wanted to gently follow up on our recent conversation. Have you had a chance to think it over? I'm happy to answer any questions or walk you through anything that would help you decide.", align: "left" } as any),
        b({ type: "text", html: "There's no pressure at all — I'm simply here to help you move forward whenever you're ready.", align: "left" } as any),
        b({ type: "button", label: "Book a quick call", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  // Re-engagement / we miss you (suggested)
  {
    key: "reengagement",
    name: "Re-engagement / We Miss You",
    description: "Suggested: reconnect with a dormant client and invite a review.",
    category: "marketing",
    body: {
      subject: "We'd love to reconnect, {{investor.first_name}}",
      preheader: "It's been a while — let's get your plan back on track.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "We miss you, {{investor.first_name}}!", subtitle: "Let's pick up where we left off.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>It's been a while since we last connected, and we wanted to check in. A lot can change — markets, your goals, your life — and a quick review makes sure your investments still fit where you're headed.", align: "left" } as any),
        b({ type: "text", html: "Whenever you're ready, we're here. Let's reconnect and get your plan back on track.", align: "left" } as any),
        b({ type: "button", label: "Schedule a review", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  //  Client — transactions & servicing
  // ───────────────────────────────────────────────────────────────────────

  {
    key: "account_activated",
    name: "Account Activated — Ready to Invest",
    description: "KYC done and account live — the client can start investing.",
    category: "transactional",
    body: {
      subject: "You're all set to invest, {{investor.first_name}} ✅",
      preheader: "Your account is active.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "Your account is active!", subtitle: "Everything's set — let's start building your wealth.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>Great news — your KYC is complete and your account with <b>{{tenant.displayName}}</b> is now active. You're ready to start investing.", align: "left" } as any),
        b({ type: "button", label: "Start investing", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  {
    key: "mandate_registration",
    name: "Mandate (NACH) Registration",
    description: "Asks the client to set up the auto-debit (e-NACH) mandate for SIPs.",
    category: "transactional",
    body: {
      subject: "Set up your auto-debit mandate, {{investor.first_name}}",
      preheader: "A one-time setup so your SIPs run on autopilot.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Set up your auto-debit (NACH) mandate", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>To make your SIPs effortless, please register your bank mandate (e-NACH). It's a one-time, secure setup that lets your installments run automatically — no manual transfers needed.", align: "left" } as any),
        b({ type: "button", label: "Register mandate", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: "It takes just 2 minutes with your net-banking or debit card. Reply to this email if you'd like help.<br><br>" + SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  {
    key: "redemption_confirmation",
    name: "Redemption Confirmed",
    description: "Confirms a processed redemption with amount and credit timeline.",
    category: "transactional",
    body: {
      subject: "Your redemption is confirmed",
      preheader: "Details of your redemption request.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Redemption confirmed", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>We've processed your redemption. Here are the details:", align: "left" } as any),
        b({ type: "data_table", caption: "Redemption details", rows: [
          { label: "Scheme", value: "{{transaction.scheme_name}}" },
          { label: "Amount", value: "₹{{transaction.amount}}" },
          { label: "Folio", value: "{{transaction.folio_number}}" },
          { label: "Date", value: "{{transaction.transaction_date}}" },
          { label: "Credit by", value: "Within the standard T+2 to T+3 working days" },
        ] } as any),
        b({ type: "text", html: "The proceeds will reach your registered bank account within the standard settlement period. If you redeemed for a specific need, we're here if you'd like to discuss alternatives for the future.", align: "left" } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  {
    key: "switch_stp_swp",
    name: "Switch / STP / SWP Confirmed",
    description: "Confirms a switch, STP or SWP transaction.",
    category: "transactional",
    body: {
      subject: "Your transaction is confirmed, {{investor.first_name}}",
      preheader: "Details of your switch / STP / SWP.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Transaction confirmed", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>We're pleased to confirm your recent transaction:", align: "left" } as any),
        b({ type: "data_table", caption: "Details", rows: [
          { label: "Scheme", value: "{{transaction.scheme_name}}" },
          { label: "Type", value: "{{transaction.type}}" },
          { label: "Amount / Units", value: "₹{{transaction.amount}}" },
          { label: "Folio", value: "{{transaction.folio_number}}" },
          { label: "Date", value: "{{transaction.transaction_date}}" },
        ] } as any),
        b({ type: "text", html: "This change keeps your portfolio aligned with your plan. You can track everything on your portal anytime.", align: "left" } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  {
    key: "sip_stepup",
    name: "SIP Step-Up / Top-Up Nudge",
    description: "Encourages the client to increase their SIP as income grows.",
    category: "utility",
    body: {
      subject: "A small step today, a big difference tomorrow",
      preheader: "Consider stepping up your SIP.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "Grow your SIP, grow your future", subtitle: "Even a small increase compounds into a lot.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>As your income grows, increasing your SIP — even by 10% a year — can dramatically boost your long-term corpus thanks to compounding. It's one of the simplest, most powerful moves you can make.", align: "left" } as any),
        b({ type: "button", label: "Step up my SIP", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "quote", text: "Do not save what is left after spending, but spend what is left after saving.", author: "Warren Buffett" } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  {
    key: "sip_maturity",
    name: "SIP Tenure Complete",
    description: "Notifies the client their SIP series has completed and suggests next steps.",
    category: "utility",
    body: {
      subject: "Your SIP has completed its tenure, {{investor.first_name}}",
      preheader: "Let's plan the next step for your investment.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Your SIP has completed its tenure", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>Congratulations on completing your SIP journey for {{transaction.scheme_name}}! Your discipline has paid off. Now is a great time to decide the next step — renew the SIP, let it stay invested, or align it to a new goal.", align: "left" } as any),
        b({ type: "button", label: "Plan next step", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  {
    key: "dividend_payout",
    name: "Dividend / IDCW Payout",
    description: "Informs the client of a dividend / IDCW credit.",
    category: "transactional",
    body: {
      subject: "A payout has been credited to you 💰",
      preheader: "Details of your dividend / IDCW.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Payout credited", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>A dividend / IDCW payout has been credited for your investment:", align: "left" } as any),
        b({ type: "data_table", caption: "Payout details", rows: [
          { label: "Scheme", value: "{{transaction.scheme_name}}" },
          { label: "Amount", value: "₹{{transaction.amount}}" },
          { label: "Folio", value: "{{transaction.folio_number}}" },
          { label: "Date", value: "{{transaction.transaction_date}}" },
        ] } as any),
        b({ type: "text", html: "If you'd like to reinvest this payout to keep compounding, we're happy to help.", align: "left" } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  {
    key: "capital_gains_statement",
    name: "Capital Gains / Tax Statement",
    description: "Shares the capital-gains statement at tax time (attach the PDF when sending).",
    category: "utility",
    body: {
      subject: "Your capital gains statement, {{investor.first_name}}",
      preheader: "Everything you need for your tax filing.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Your capital gains statement", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>As the financial year closes, please find your capital gains statement <b>attached</b> for your tax filing. It summarises your realised short-term and long-term gains across schemes for the financial year.", align: "left" } as any),
        b({ type: "text", html: "If your CA needs anything else, just reply — we'll send it across. Happy to help you plan for tax efficiency next year too.", align: "left" } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  {
    key: "elss_80c",
    name: "ELSS / 80C Last Call",
    description: "Jan–Mar reminder to invest in ELSS and save tax under Section 80C.",
    category: "utility",
    body: {
      subject: "Save tax before 31st March, {{investor.first_name}}",
      preheader: "A little planning now can save you up to ₹46,800.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "Last call to save tax", subtitle: "Invest in ELSS under Section 80C before 31st March.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>The financial year is closing soon. Investing in ELSS (tax-saving mutual funds) under Section 80C can help you save up to ₹46,800 in tax — while growing your wealth with the shortest lock-in (3 years) among 80C options.", align: "left" } as any),
        b({ type: "button", label: "Invest in ELSS", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  {
    key: "quarterly_statement",
    name: "Quarterly Portfolio Statement",
    description: "Periodic portfolio snapshot every quarter.",
    category: "utility",
    body: {
      subject: "Your quarterly portfolio update, {{investor.first_name}}",
      preheader: "How your investments performed this quarter.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Your quarter in review", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>Here's a snapshot of your portfolio this quarter — your invested amount, current value, gains and XIRR. Your detailed statement is attached.", align: "left" } as any),
        b({ type: "button", label: "View full portfolio", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  {
    key: "market_volatility",
    name: "Market Volatility — Stay the Course",
    description: "Reassures clients during a sharp market move; discourages panic.",
    category: "utility",
    body: {
      subject: "A note on the markets, {{investor.first_name}}",
      preheader: "Volatility is normal — your plan is built for it.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "A calm word about the markets", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>You may have seen the markets move sharply. We wanted to reach out personally: this kind of volatility is a normal part of investing, and your plan was built with exactly these moments in mind.", align: "left" } as any),
        b({ type: "text", html: "History shows that staying invested through ups and downs — and continuing your SIPs — is what builds wealth. Reacting to short-term noise rarely helps. We're watching closely and will reach out if any action is genuinely warranted.", align: "left" } as any),
        b({ type: "quote", text: "The stock market is a device for transferring money from the impatient to the patient.", author: "Warren Buffett" } as any),
        b({ type: "text", html: "If you'd like to talk it through, we're just a call away.<br><br>" + SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  {
    key: "rebalancing",
    name: "Rebalancing Recommendation",
    description: "Flags portfolio drift and recommends a rebalance.",
    category: "utility",
    body: {
      subject: "Time to rebalance your portfolio, {{investor.first_name}}",
      preheader: "A small adjustment to keep you on track.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "A quick portfolio tune-up", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>Markets move, and over time your portfolio can drift from its target mix. Our review suggests it's a good time to rebalance — trimming what's grown heavy and topping up what's light — to keep your risk aligned with your goals. Your advisor will share the exact current and target allocation and the switches or STP we'd recommend.", align: "left" } as any),
        b({ type: "button", label: "Discuss rebalancing", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  {
    key: "goal_milestone",
    name: "Goal Milestone Achieved 🎯",
    description: "Celebrates the client hitting a goal milestone.",
    category: "marketing",
    body: {
      subject: "You hit a milestone, {{investor.first_name}}! 🎯",
      preheader: "Your goal is on track — let's celebrate.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "Milestone achieved! 🎯", subtitle: "Your discipline is paying off.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>Wonderful news — you've reached an important milestone on your goal. Every SIP, every contribution has brought you closer, and it shows. Keep going — the best is yet to come!", align: "left" } as any),
        b({ type: "button", label: "See your progress", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  {
    key: "nfo_alert",
    name: "New Fund Opportunity (NFO)",
    description: "Introduces a relevant NFO / new opportunity.",
    category: "marketing",
    body: {
      subject: "A new opportunity worth a look, {{investor.first_name}}",
      preheader: "A new fund that may fit your goals.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "A new opportunity", subtitle: "A new fund is now open.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>A new fund has opened, and based on your goals it may be worth a look. We'll share the fund category, who it's ideal for, and the closing date when we speak.", align: "left" } as any),
        b({ type: "text", html: "NFOs aren't for everyone — let's check if it genuinely fits your plan before deciding.", align: "left" } as any),
        b({ type: "button", label: "Discuss this NFO", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  {
    key: "nominee_update",
    name: "Nominee — Add / Update",
    description: "Reminds the client to add or update their nominee (regulatory).",
    category: "utility",
    body: {
      subject: "Please add / update your nominee, {{investor.first_name}}",
      preheader: "A quick step to protect your loved ones.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Protect your loved ones — add a nominee", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>Adding (or updating) a nominee ensures your investments smoothly reach the people you care about, without legal hurdles. It's a regulator-recommended, 2-minute step — and an important one.", align: "left" } as any),
        b({ type: "button", label: "Update nominee", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: "Reply to this email if you'd like us to assist.<br><br>" + SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  {
    key: "investment_anniversary",
    name: "Investing Anniversary 🎉",
    description: "Celebrates the client's anniversary of investing with the firm.",
    category: "marketing",
    body: {
      subject: "Happy investing anniversary, {{investor.first_name}}! 🎉",
      preheader: "Thank you for growing with us.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "Happy investing anniversary! 🎉", subtitle: "Thank you for trusting us with your journey.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>It's been another year of investing together — thank you for your trust in <b>{{tenant.displayName}}</b>. We're proud of the progress you've made and excited for the road ahead. Here's to many more years of growing your wealth, together. 🌱", align: "center" } as any),
        b({ type: "spacer", height: 12 } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  {
    key: "wedding_anniversary",
    name: "Wedding Anniversary Wish",
    description: "A warm anniversary greeting for the client.",
    category: "marketing",
    body: {
      subject: "Happy Anniversary, {{investor.first_name}}! 💐",
      preheader: "Wishing you many more happy years together.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "Happy Anniversary! 💐", subtitle: "Wishing you love, laughter and togetherness.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>On your special day, all of us at <b>{{tenant.displayName}}</b> send our warmest wishes to you and your partner. May the years ahead be filled with happiness, health and prosperity. 🎉", align: "center" } as any),
        b({ type: "spacer", height: 12 } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: false },
    },
  },

  {
    key: "referral_request",
    name: "Referral Request (the Ask)",
    description: "Invites a happy client to refer friends and family.",
    category: "marketing",
    body: {
      subject: "Know someone we can help, {{investor.first_name}}?",
      preheader: "The best compliment you can give us is a referral.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "Help a friend invest smarter", subtitle: "A referral is the kindest compliment.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>We're so glad to have you with us. If you know a friend, family member or colleague who could benefit from a thoughtful, goal-based approach to investing, we'd be honoured by an introduction.<br><br>We'll take care of them with the same dedication we bring to your portfolio.", align: "left" } as any),
        b({ type: "button", label: "Refer someone", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  {
    key: "feedback_nps",
    name: "Feedback / NPS Survey",
    description: "Asks the client for quick feedback after a service interaction.",
    category: "utility",
    body: {
      subject: "How are we doing, {{investor.first_name}}?",
      preheader: "Two minutes to help us serve you better.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "We'd love your feedback", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>Your experience matters to us. Could you spare two minutes to tell us how we're doing? Your honest feedback helps us serve you — and every client — better.", align: "left" } as any),
        b({ type: "button", label: "Share feedback", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: "Thank you — it genuinely helps.<br><br>" + SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  {
    key: "complaint_ack",
    name: "Complaint Acknowledgement",
    description: "Acknowledges a client concern and sets resolution expectations.",
    category: "transactional",
    body: {
      subject: "We've received your concern, {{investor.first_name}}",
      preheader: "We're on it — here's what happens next.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "We've received your concern", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Dear {{investor.name}},<br><br>Thank you for bringing this to our attention, and we're sorry for any inconvenience. We take your concern seriously and have logged it for prompt resolution.", align: "left" } as any),
        b({ type: "data_table", caption: "Your request", rows: [
          { label: "Reference", value: "your ticket" },
          { label: "Logged on", value: "{{system.today}}" },
          { label: "Expected resolution", value: "shortly" },
        ] } as any),
        b({ type: "text", html: "A member of our team will follow up personally. If you need anything in the meantime, just reply to this email.", align: "left" } as any),
        b({ type: "text", html: SIGNOFF, align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  //  Lead — nurture & events
  // ───────────────────────────────────────────────────────────────────────

  {
    key: "lead_nurture",
    name: "Lead — Nurture (Educational)",
    description: "Educational value email to warm a lead who hasn't converted yet.",
    category: "marketing",
    body: {
      subject: "Smart investing starts with a plan, {{lead.name}}",
      preheader: "A few ideas to help you get started.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "Investing made simple", subtitle: "Small, steady steps build real wealth.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Hi {{lead.name}},<br><br>Getting started with investing can feel overwhelming — but it doesn't have to be. A few timeless principles do most of the heavy lifting:<br><br>• <b>Start early</b> — time is your biggest ally<br>• <b>Invest regularly</b> — SIPs turn discipline into wealth<br>• <b>Stay invested</b> — patience beats timing the market<br>• <b>Match goals to investments</b> — every rupee with a purpose", align: "left" } as any),
        b({ type: "text", html: "When you're ready, we'll help you put these into a simple, personalised plan.", align: "left" } as any),
        b({ type: "button", label: "Talk to an advisor", url: "{{tenant.websiteUrl}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: "Warm regards,<br>Team {{tenant.displayName}}", align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  {
    key: "webinar_invite",
    name: "Webinar / Event Invite",
    description: "Invites leads/clients to a webinar or event.",
    category: "marketing",
    body: {
      subject: "You're invited to our upcoming webinar",
      preheader: "Join us for a free session.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "You're Invited", subtitle: "A free, practical session — you're invited.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Hi {{lead.name}},<br><br>We're hosting a free webinar and would love for you to join. Bring your questions — it's interactive and practical. See the invite for the date, time and venue.", align: "left" } as any),
        b({ type: "button", label: "Reserve my seat", url: "{{tenant.websiteUrl}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: "Warm regards,<br>Team {{tenant.displayName}}", align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  {
    key: "webinar_reminder",
    name: "Webinar / Event Reminder",
    description: "Day-before reminder for a registered webinar/event.",
    category: "utility",
    body: {
      subject: "Reminder: our webinar is tomorrow",
      preheader: "See you there!",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Your session is almost here", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Hi {{lead.name}},<br><br>Just a quick reminder about our upcoming webinar — we're looking forward to seeing you. The date, time and join link are in your original invite.", align: "left" } as any),
        b({ type: "button", label: "Join the session", url: "{{tenant.websiteUrl}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: "Warm regards,<br>Team {{tenant.displayName}}", align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  {
    key: "webinar_recap",
    name: "Webinar — Thank You + Recording",
    description: "Post-event thank-you with the recording and a next-step CTA.",
    category: "marketing",
    body: {
      subject: "Thanks for joining — here's the recording",
      preheader: "Catch up and take the next step.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Thank you for joining us", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Hi {{lead.name}},<br><br>Thank you for attending our webinar! We hope you found it useful. As promised, here's the recording and key resources — and if you'd like a personalised plan based on what we covered, we're here to help.", align: "left" } as any),
        b({ type: "button", label: "Watch the recording", url: "{{tenant.websiteUrl}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: "Warm regards,<br>Team {{tenant.displayName}}", align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  {
    key: "free_consultation",
    name: "Free Consultation Offer",
    description: "Offers a lead a free, no-obligation consultation.",
    category: "marketing",
    body: {
      subject: "A free, no-obligation chat about your goals?",
      preheader: "30 minutes that could shape your financial future.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "Let's talk about your goals", subtitle: "A free, no-obligation consultation.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Hi {{lead.name}},<br><br>Whether you're just starting out or want a second opinion on your existing investments, we'd be happy to offer a free, no-strings-attached consultation. No jargon, no pressure — just clear, honest guidance.", align: "left" } as any),
        b({ type: "button", label: "Book my free session", url: "{{tenant.websiteUrl}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: "Warm regards,<br>Team {{tenant.displayName}}", align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  {
    key: "lead_magnet_delivery",
    name: "Lead Magnet Delivery",
    description: "Delivers a requested guide / calculator result to a lead.",
    category: "transactional",
    body: {
      subject: "Here's what you requested, {{lead.name}}",
      preheader: "As requested — and a next step if you want it.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Here's what you asked for", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Hi {{lead.name}},<br><br>Thanks for your interest! As requested, here's the guide you asked for. We hope it's helpful. If you'd like us to walk you through what it means for your goals, just reply — we're happy to help.", align: "left" } as any),
        b({ type: "button", label: "Get your guide", url: "{{tenant.websiteUrl}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: "Warm regards,<br>Team {{tenant.displayName}}", align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  {
    key: "lead_cold_reengage",
    name: "Lead — Still Interested?",
    description: "Re-engages a stalled / cold lead.",
    category: "marketing",
    body: {
      subject: "Still thinking it over, {{lead.name}}?",
      preheader: "No rush — we're here whenever you're ready.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Still thinking it over?", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Hi {{lead.name}},<br><br>We know life gets busy, so we wanted to gently check in. If you're still exploring your investment options, we'd love to help — at your pace, no pressure.<br><br>Is there a question holding you back? Just hit reply and we'll do our best to make things clear.", align: "left" } as any),
        b({ type: "button", label: "Let's talk", url: "{{tenant.websiteUrl}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: "Warm regards,<br>Team {{tenant.displayName}}", align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  {
    key: "lead_lost_graceful",
    name: "Lead — Door's Always Open",
    description: "A graceful close for a lost lead that keeps the relationship warm.",
    category: "utility",
    body: {
      subject: "The door's always open, {{lead.name}}",
      preheader: "Whenever the time is right, we're here.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Whenever you're ready", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Hi {{lead.name}},<br><br>We completely understand that now may not be the right time — and that's perfectly okay. We won't crowd your inbox.<br><br>Whenever you'd like a thoughtful, honest partner for your financial journey, our door is always open. We'd be glad to help.", align: "left" } as any),
        b({ type: "text", html: "Wishing you all the best,<br>Team {{tenant.displayName}}", align: "left" } as any),
        b({ type: "text", html: AMFI_DISCLAIMER, align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  //  Partner / Sub-distributor
  // ───────────────────────────────────────────────────────────────────────

  {
    key: "partner_welcome",
    name: "Partner — Welcome Aboard",
    description: "Welcomes a new sub-distributor / partner.",
    category: "transactional",
    body: {
      subject: "Welcome aboard, partner! 🤝",
      preheader: "Let's grow together.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "Welcome to the {{tenant.displayName}} network!", subtitle: "We're excited to grow together.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Dear Partner,<br><br>Welcome to the <b>{{tenant.displayName}}</b> partner network! We're delighted to have you on board. You now have the tools, support and back-office to grow your business with confidence. We'll share your partner code, your dedicated point of contact, and your portal access separately.", align: "left" } as any),
        b({ type: "button", label: "Access partner portal", url: "{{tenant.websiteUrl}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: "Warm regards,<br>Team {{tenant.displayName}}", align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  {
    key: "partner_commission_statement",
    name: "Partner — Commission Statement",
    description: "Shares a sub-distributor's commission / brokerage statement.",
    category: "utility",
    body: {
      subject: "Your commission statement is ready",
      preheader: "Your earnings summary is ready.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Your commission statement", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Dear Partner,<br><br>Here's your commission summary for the latest period. The detailed statement — with your gross brokerage, adjustments, net payable and payout date — is attached.", align: "left" } as any),
        b({ type: "text", html: "If anything looks off, just reply and we'll review it right away.<br><br>Warm regards,<br>Team {{tenant.displayName}}", align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  {
    key: "partner_business_update",
    name: "Partner — Business Update",
    description: "Periodic business / performance update for a partner.",
    category: "utility",
    body: {
      subject: "Your latest business update",
      preheader: "How your book is doing.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Your business update", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Dear Partner,<br><br>Here's a snapshot of your business with <b>{{tenant.displayName}}</b> this period — your AUM, net sales, active SIPs and new clients. The detailed breakdown is attached.", align: "left" } as any),
        b({ type: "text", html: "Let's connect to plan the next quarter and how we can support your growth.<br><br>Warm regards,<br>Team {{tenant.displayName}}", align: "left" } as any),
      ],
      footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  TEAM & INTERNAL — alerts, status, reports (sent to staff, not clients)
  // ═══════════════════════════════════════════════════════════════════════

  // ── Alerts ──────────────────────────────────────────────────────────────

  // New lead assigned (→ RM)
  {
    key: "alert_lead_assigned",
    name: "Alert — New Lead Assigned",
    description: "To an RM: a new lead has been assigned and needs a first call.",
    category: "transactional",
    audience: "internal",
    body: {
      subject: "🔔 New lead assigned to you — {{lead.name}}",
      preheader: "A new lead is waiting for your first call.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "New lead assigned to you", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Hi there,<br><br>A new lead has been assigned to you in <b>{{tenant.displayName}}</b>. Reaching out within the first hour gives the best chance of conversion.", align: "left" } as any),
        b({ type: "data_table", caption: "Lead details", rows: [
          { label: "Name", value: "{{lead.name}}" },
          { label: "Phone", value: "{{lead.phone}}" },
          { label: "Source", value: "{{lead.source}}" },
          { label: "Assigned", value: "{{system.today}}" },
        ] } as any),
        b({ type: "text", html: "<b>Next step:</b> Call the lead, log the outcome, and set a follow-up task.", align: "left" } as any),
        b({ type: "button", label: "Open lead", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
      ],
      footer: { ...INTERNAL_FOOTER },
    },
  },

  // Tasks due today (→ team member)
  {
    key: "alert_task_due",
    name: "Alert — Tasks Due Today",
    description: "To a team member: a reminder of calls, follow-ups and meetings due today.",
    category: "transactional",
    audience: "internal",
    body: {
      subject: "⏰ You have tasks due today",
      preheader: "A quick look at what needs your attention.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Tasks due today", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Hi there,<br><br>You have calls, follow-ups and meetings due today, plus any overdue items. Clearing these keeps your pipeline moving. Open your task list to see the full picture.", align: "left" } as any),
        b({ type: "button", label: "Open my tasks", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
      ],
      footer: { ...INTERNAL_FOOTER },
    },
  },

  // Client SIP rejected (→ RM / ops)
  {
    key: "alert_sip_rejection_internal",
    name: "Alert — Client SIP Rejected",
    description: "To an RM/ops: a client's SIP failed and needs prompt follow-up.",
    category: "transactional",
    audience: "internal",
    body: {
      subject: "⚠️ Client SIP rejected — action needed",
      preheader: "A client's SIP failed and needs follow-up.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Client SIP rejected", level: "h2", align: "left" } as any),
        b({ type: "text", html: "A SIP for one of your clients was rejected and needs prompt follow-up to avoid a missed installment.", align: "left" } as any),
        b({ type: "data_table", caption: "Details", rows: [
          { label: "Client", value: "{{investor.name}}" },
          { label: "Scheme", value: "{{transaction.scheme_name}}" },
          { label: "Amount", value: "₹{{transaction.amount}}" },
          { label: "Reason", value: "{{transaction.rejection_reason}}" },
          { label: "Folio", value: "{{transaction.folio_number}}" },
        ] } as any),
        b({ type: "text", html: "<b>Action:</b> Contact the client, resolve the cause (balance / mandate), and re-initiate.", align: "left" } as any),
        b({ type: "button", label: "Open client", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
      ],
      footer: { ...INTERNAL_FOOTER },
    },
  },

  // KYC / documents expiring (→ compliance / ops)
  {
    key: "alert_kyc_expiry",
    name: "Alert — KYC / Documents Expiring",
    description: "To compliance/ops: documents nearing expiry that need renewal.",
    category: "transactional",
    audience: "internal",
    body: {
      subject: "🛡️ KYC / documents expiring soon",
      preheader: "Compliance items that need attention.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Documents expiring within 30 days", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Hi there,<br><br>Some compliance documents are nearing expiry and need renewal to stay audit-ready. Open the Compliance Center to see exactly which documents are expiring, who they belong to, and their renewal status.", align: "left" } as any),
        b({ type: "button", label: "Open Compliance Center", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
      ],
      footer: { ...INTERNAL_FOOTER },
    },
  },

  // Large redemption requested (→ owner / RM)
  {
    key: "alert_redemption",
    name: "Alert — Large Redemption Requested",
    description: "To owner/RM: a significant redemption — a retention opportunity.",
    category: "transactional",
    audience: "internal",
    body: {
      subject: "🚨 Large redemption requested — {{investor.name}}",
      preheader: "A retention opportunity needs your attention.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Large redemption alert", level: "h2", align: "left" } as any),
        b({ type: "text", html: "A significant redemption has been requested. This is a key moment for a retention conversation.", align: "left" } as any),
        b({ type: "data_table", caption: "Details", rows: [
          { label: "Client", value: "{{investor.name}}" },
          { label: "Scheme", value: "{{transaction.scheme_name}}" },
          { label: "Amount", value: "₹{{transaction.amount}}" },
          { label: "Folio", value: "{{transaction.folio_number}}" },
          { label: "Requested", value: "{{system.today}}" },
        ] } as any),
        b({ type: "text", html: "<b>Action:</b> Reach out today — understand the reason and offer alternatives (STP, partial redemption, goal review).", align: "left" } as any),
        b({ type: "button", label: "Open client", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
      ],
      footer: { ...INTERNAL_FOOTER },
    },
  },

  // Client escalation / complaint (→ owner / branch head)
  {
    key: "alert_escalation",
    name: "Alert — Client Escalation / Complaint",
    description: "To owner/branch head: a complaint has been logged and needs leadership attention.",
    category: "transactional",
    audience: "internal",
    body: {
      subject: "🚩 Client escalation / complaint logged",
      preheader: "A complaint needs leadership attention.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Client escalation logged", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Hi there,<br><br>A client escalation has been raised and needs prompt attention to protect the relationship and stay compliant. Open the Compliance Center to see who raised it, the client involved, the severity, and a summary.", align: "left" } as any),
        b({ type: "data_table", caption: "Escalation", rows: [
          { label: "Logged", value: "{{system.today}}" },
        ] } as any),
        b({ type: "text", html: "<b>Action:</b> Assign an owner, acknowledge to the client within 24h, and track to resolution.", align: "left" } as any),
        b({ type: "button", label: "Open Compliance Center", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
      ],
      footer: { ...INTERNAL_FOOTER },
    },
  },

  // ── Status ──────────────────────────────────────────────────────────────

  // Your day at a glance (daily standup → team member)
  {
    key: "status_my_day",
    name: "Status — Your Day at a Glance",
    description: "Daily standup to a team member: today's tasks, meetings and follow-ups.",
    category: "transactional",
    audience: "internal",
    body: {
      subject: "☀️ Your day at a glance — {{system.today}}",
      preheader: "Today's tasks, meetings and follow-ups.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "Good morning!", subtitle: "Here's your day at a glance.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Open your dashboard to see today's meetings, calls due, follow-ups, new leads and SIPs due.", align: "left" } as any),
        b({ type: "text", html: "Have a productive day — tackle the time-sensitive items first, and log every interaction as you go.", align: "left" } as any),
        b({ type: "button", label: "Open dashboard", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
      ],
      footer: { ...INTERNAL_FOOTER },
    },
  },

  // New business won (→ team + owner)
  {
    key: "status_deal_won",
    name: "Status — New Business Won 🎉",
    description: "Celebratory note to the team/owner when a new deal closes.",
    category: "transactional",
    audience: "internal",
    body: {
      subject: "🎉 New business won — way to go, team!",
      preheader: "Celebrating a new win for the team.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "New business won! 🎉", subtitle: "Another client's journey begins.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "data_table", caption: "The win", rows: [
          { label: "Closed", value: "{{system.today}}" },
        ] } as any),
        b({ type: "text", html: "Great work! Wins like this move the whole firm forward. 🙌 Let's make onboarding smooth so the client feels welcomed from day one.", align: "left" } as any),
      ],
      footer: { ...INTERNAL_FOOTER },
    },
  },

  // Onboarding pipeline status (→ ops / owner)
  {
    key: "status_onboarding",
    name: "Status — Onboarding Pipeline",
    description: "To ops/owner: where each new client stands in onboarding.",
    category: "transactional",
    audience: "internal",
    body: {
      subject: "📋 Onboarding pipeline — status update",
      preheader: "Where each new client stands.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Onboarding pipeline", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Hi team,<br><br>Here's the current status of clients in onboarding — how many have documents pending, are in KYC, need a mandate set up, and are ready to invest. Let's clear blockers so everyone starts investing quickly.", align: "left" } as any),
        b({ type: "button", label: "Open onboarding", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
      ],
      footer: { ...INTERNAL_FOOTER },
    },
  },

  // ── Reports ─────────────────────────────────────────────────────────────

  // Daily business summary (→ owner)
  {
    key: "report_daily_business",
    name: "Report — Daily Business Summary",
    description: "To the owner: yesterday's sales, SIPs, redemptions and new business.",
    category: "transactional",
    audience: "internal",
    body: {
      subject: "📊 Daily business summary — {{system.today}}",
      preheader: "Yesterday's numbers at a glance.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Daily business summary", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Hi there,<br><br>Here's how <b>{{tenant.displayName}}</b> performed yesterday. Open the dashboard for gross sales, new SIPs, redemptions, net flows, new leads and new clients.", align: "left" } as any),
        b({ type: "button", label: "Open dashboard", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
      ],
      footer: { ...INTERNAL_FOOTER },
    },
  },

  // Weekly team performance (→ owner / branch head)
  {
    key: "report_weekly_team",
    name: "Report — Weekly Team Performance",
    description: "To owner/branch head: per-team activity and conversion for the week.",
    category: "transactional",
    audience: "internal",
    body: {
      subject: "📈 Weekly team performance",
      preheader: "Team performance for the week.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Weekly team performance", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Hi there,<br><br>A summary of how the team performed this week — calls made, meetings held, leads converted, new SIPs and the top performer. Open the team dashboard for the full breakdown, and use it to coach, recognise, and unblock.", align: "left" } as any),
        b({ type: "text", html: "<b>Tip:</b> Recognise the top performer publicly, and have a quick 1:1 with anyone trending down.", align: "left" } as any),
        b({ type: "button", label: "Open team dashboard", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
      ],
      footer: { ...INTERNAL_FOOTER },
    },
  },

  // Monthly business review / MIS (→ owner)
  {
    key: "report_monthly_mis",
    name: "Report — Monthly Business Review (MIS)",
    description: "To the owner: consolidated AUM, flows, SIP book and revenue for the month.",
    category: "transactional",
    audience: "internal",
    body: {
      subject: "🗂️ Monthly business review (MIS)",
      preheader: "Your month in numbers.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "Monthly Business Review", subtitle: "Your firm at a glance.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Hi there,<br><br>Here's the consolidated MIS for <b>{{tenant.displayName}}</b> — total AUM, net AUM change, the monthly SIP book, active SIPs, new clients, redemptions and estimated revenue. Open the dashboard for the full report.", align: "left" } as any),
        b({ type: "text", html: "Let's review wins, gaps, and next month's focus in the leadership meeting.", align: "left" } as any),
        b({ type: "button", label: "Open dashboard", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
      ],
      footer: { ...INTERNAL_FOOTER },
    },
  },

  // ── Team / Employee (HR & ops) ──────────────────────────────────────────

  {
    key: "employee_welcome",
    name: "Employee — Welcome to the Team",
    description: "Onboarding welcome for a new team member.",
    category: "transactional",
    audience: "internal",
    body: {
      subject: "Welcome to {{tenant.displayName}}! 🎉",
      preheader: "We're thrilled to have you on the team.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "Welcome to the team!", subtitle: "We're excited to have you with us.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Hi there,<br><br>A very warm welcome to <b>{{tenant.displayName}}</b>! We're delighted to have you join us. Your manager will share your role, who you report to, and your onboarding buddy to help you settle in.", align: "left" } as any),
        b({ type: "data_table", caption: "Your first days", rows: [
          { label: "Start date", value: "{{system.today}}" },
        ] } as any),
        b({ type: "text", html: "Your manager will help you settle in. Don't hesitate to ask questions — we're all here to help you succeed. Welcome aboard! 🙌", align: "left" } as any),
        b({ type: "button", label: "Open the CRM", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
      ],
      footer: { ...INTERNAL_FOOTER },
    },
  },

  {
    key: "leave_approved",
    name: "Employee — Leave Approved",
    description: "Notifies a team member that their leave request is approved.",
    category: "transactional",
    audience: "internal",
    body: {
      subject: "✅ Your leave is approved",
      preheader: "Your time off is confirmed.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Your leave is approved", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Hi there,<br><br>Good news — your leave request has been approved. The approved leave type, dates and approver are recorded in the CRM for your reference. Enjoy your time off!", align: "left" } as any),
        b({ type: "text", html: "Please hand over any pending work before you head out. See you when you're back!", align: "left" } as any),
      ],
      footer: { ...INTERNAL_FOOTER },
    },
  },

  {
    key: "leave_rejected",
    name: "Employee — Leave Update (Declined)",
    description: "Tactfully informs a team member that leave can't be approved as requested.",
    category: "transactional",
    audience: "internal",
    body: {
      subject: "Update on your leave request",
      preheader: "Let's find an alternative that works.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "About your leave request", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Hi there,<br><br>Thanks for your request. Unfortunately we're unable to approve it for the dates you requested, usually due to workload or overlapping leave. We'd love to find an alternative that works for you and the team.", align: "left" } as any),
        b({ type: "text", html: "Please reach out to your manager to pick alternate dates — we'll do our best to accommodate.", align: "left" } as any),
      ],
      footer: { ...INTERNAL_FOOTER },
    },
  },

  {
    key: "work_anniversary",
    name: "Employee — Work Anniversary 🎉",
    description: "Celebrates a team member's work anniversary.",
    category: "transactional",
    audience: "internal",
    body: {
      subject: "Happy work anniversary! 🎉",
      preheader: "Thank you for everything you do.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "Happy work anniversary! 🎉", subtitle: "Another year, and counting.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Hi there,<br><br>Today marks another year with <b>{{tenant.displayName}}</b>! Thank you for your dedication, energy and the difference you make every day. We're grateful to have you on the team. Here's to many more! 🥂", align: "center" } as any),
        b({ type: "spacer", height: 12 } as any),
      ],
      footer: { ...INTERNAL_FOOTER },
    },
  },

  {
    key: "target_assigned",
    name: "Employee — Targets Assigned",
    description: "Communicates a team member's targets for the period.",
    category: "transactional",
    audience: "internal",
    body: {
      subject: "Your targets for the period",
      preheader: "Let's make it a great quarter.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Your targets for the period", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Hi there,<br><br>Here are your targets for the period — your net sales, new SIPs, new clients and meetings goals. Open the dashboard for the full details. We believe you've got this — and we're here to support you every step of the way.", align: "left" } as any),
        b({ type: "text", html: "Let's break these into weekly milestones in our next 1:1. You've got this! 💪", align: "left" } as any),
        b({ type: "button", label: "Open dashboard", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
      ],
      footer: { ...INTERNAL_FOOTER },
    },
  },

  {
    key: "cert_expiry",
    name: "Employee — NISM / EUIN Renewal Due",
    description: "Reminds a team member to renew their NISM / EUIN certification.",
    category: "transactional",
    audience: "internal",
    body: {
      subject: "Action: your NISM / EUIN renewal is due",
      preheader: "Renew on time to keep transacting.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Certification renewal due", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Hi there,<br><br>Your NISM / EUIN certification is approaching its expiry date. Please renew on time — an expired NISM/EUIN can pause your ability to transact and affect compliance.", align: "left" } as any),
        b({ type: "text", html: "Please complete CPE / renewal before the due date and share the updated certificate with compliance.", align: "left" } as any),
      ],
      footer: { ...INTERNAL_FOOTER },
    },
  },

  {
    key: "kudos",
    name: "Employee — Kudos / Recognition 👏",
    description: "A recognition note to celebrate great work.",
    category: "transactional",
    audience: "internal",
    body: {
      subject: "Kudos to you! 👏",
      preheader: "Recognising a job well done.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "Kudos! 👏", subtitle: "Outstanding work — and it didn't go unnoticed.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Hi there,<br><br>We wanted to take a moment to recognise your recent great work. It made a real difference, and we're proud to have you on the team. Keep shining! 🌟", align: "left" } as any),
        b({ type: "spacer", height: 12 } as any),
      ],
      footer: { ...INTERNAL_FOOTER },
    },
  },

  {
    key: "task_reassigned",
    name: "Employee — Task Reassigned",
    description: "Notifies a team member that a task has been handed to them.",
    category: "transactional",
    audience: "internal",
    body: {
      subject: "A task has been reassigned to you",
      preheader: "Here's what's been handed over.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "A task is now yours", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Hi there,<br><br>A task has been reassigned to you. Open the task to see its title, the client or lead it relates to, the due date, and who reassigned it — then pick it up at the earliest.", align: "left" } as any),
        b({ type: "button", label: "Open task", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
      ],
      footer: { ...INTERNAL_FOOTER },
    },
  },

  // ── Owner / Management ──────────────────────────────────────────────────

  {
    key: "subscription_trial_ending",
    name: "Owner — Subscription / Trial Ending",
    description: "Reminds the owner their CRM trial or subscription is about to end.",
    category: "transactional",
    audience: "internal",
    body: {
      subject: "Your {{tenant.displayName}} CRM trial ends soon",
      preheader: "Keep your automations running — upgrade in a click.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Your trial is ending soon", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Hi there,<br><br>Your CRM trial is ending shortly. To keep your workflows, messaging and reports running without interruption, please upgrade your plan. Open the CRM to see your current plan, its end date, and your client count.", align: "left" } as any),
        b({ type: "button", label: "Upgrade now", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
        b({ type: "text", html: "Questions about plans? Just reply — we're happy to help you choose the right fit.", align: "left" } as any),
      ],
      footer: { ...INTERNAL_FOOTER },
    },
  },

  {
    key: "churn_risk_digest",
    name: "Owner — Churn-Risk Digest",
    description: "Surfaces clients at risk of churning, for proactive retention.",
    category: "transactional",
    audience: "internal",
    body: {
      subject: "⚠️ Churn-risk digest — {{system.today}}",
      preheader: "Clients worth a proactive call this week.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Clients at risk this week", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Hi there,<br><br>The Churn-risk Radar has flagged clients for proactive attention. Open it to see how many are high and medium risk, the top driver, and the AUM at risk. A timely call often saves the relationship.", align: "left" } as any),
        b({ type: "button", label: "Open Churn-risk Radar", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
      ],
      footer: { ...INTERNAL_FOOTER },
    },
  },

  {
    key: "crosssell_digest",
    name: "Owner — Cross-Sell Opportunities",
    description: "Highlights upsell / cross-sell opportunities across the book.",
    category: "transactional",
    audience: "internal",
    body: {
      subject: "💡 Cross-sell opportunities — {{system.today}}",
      preheader: "Where your next conversations are hiding.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Opportunities in your book", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Hi there,<br><br>The Cross-sell Radar has surfaced opportunities to deepen relationships and grow AUM — SIP top-up candidates, insurance gaps, idle savings to deploy, and the estimated AUM upside. Open the radar for the full list.", align: "left" } as any),
        b({ type: "button", label: "Open Cross-sell Radar", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
      ],
      footer: { ...INTERNAL_FOOTER },
    },
  },

  {
    key: "aum_milestone",
    name: "Owner — Milestone Reached 🏆",
    description: "Celebrates an AUM or client-count milestone for the firm.",
    category: "transactional",
    audience: "internal",
    body: {
      subject: "🏆 Milestone reached — congratulations team!",
      preheader: "A moment worth celebrating.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "hero", title: "Milestone reached! 🏆", subtitle: "A moment worth celebrating.", imageUrl: "", imageAlt: "", align: "center" } as any),
        b({ type: "text", html: "Hi there,<br><br>Huge congratulations — <b>{{tenant.displayName}}</b> has crossed an important milestone. This reflects the trust of every client and the hard work of the whole team. Onwards and upwards! 🚀", align: "left" } as any),
        b({ type: "button", label: "View dashboard", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
      ],
      footer: { ...INTERNAL_FOOTER },
    },
  },

  {
    key: "ddq_drop_alert",
    name: "Owner — Compliance Readiness Drop",
    description: "Alerts the owner when DDQ / compliance readiness falls.",
    category: "transactional",
    audience: "internal",
    body: {
      subject: "🛡️ Compliance readiness needs attention",
      preheader: "Your DDQ score has dropped.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Compliance readiness dropped", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Hi there,<br><br>Your DDQ / compliance readiness score has fallen. Open DDQ Readiness to see your current score, the change, and the top gaps to close. Staying audit-ready protects the firm — let's close the gaps before they grow.", align: "left" } as any),
        b({ type: "button", label: "Open DDQ Readiness", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
      ],
      footer: { ...INTERNAL_FOOTER },
    },
  },

  {
    key: "commission_recon",
    name: "Owner — Commission Reconciliation",
    description: "Summarises brokerage reconciliation — expected vs received.",
    category: "transactional",
    audience: "internal",
    body: {
      subject: "📑 Commission reconciliation",
      preheader: "Expected vs received, and what's outstanding.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Commission reconciliation", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Hi there,<br><br>Here's the latest brokerage reconciliation. Open the report to see expected versus received brokerage, the variance, and any unmatched entries. Flagged variances are worth a closer look.", align: "left" } as any),
        b({ type: "button", label: "Open Commission Reconciliation", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
      ],
      footer: { ...INTERNAL_FOOTER },
    },
  },

  {
    key: "circular_digest",
    name: "Owner — Regulatory Circular Digest",
    description: "Weekly digest of relevant SEBI / AMFI circulars.",
    category: "transactional",
    audience: "internal",
    body: {
      subject: "🗞️ This week's regulatory circulars",
      preheader: "What changed, and what to action.",
      mode: "designer",
      blocks: [
        b({ type: "logo" } as any),
        b({ type: "heading", text: "Regulatory circular digest", level: "h2", align: "left" } as any),
        b({ type: "text", html: "Hi there,<br><br>Here's a quick digest of the latest SEBI / AMFI circulars relevant to your practice. Open the Circular Digest to see how many are new, how many need action, and a summary of the key change, along with suggested actions.", align: "left" } as any),
        b({ type: "button", label: "Open Circular Digest", url: "{{system.dashboard_url}}", align: "center", style: "solid", fullWidth: false } as any),
      ],
      footer: { ...INTERNAL_FOOTER },
    },
  },
];

/** Return a fresh copy of a starter body with freshly-generated block ids. */
export function applyStarter(key: string): EmailDesignerBody | null {
  const s = STARTER_TEMPLATES.find((t) => t.key === key);
  if (!s) return null;
  const stamp = Date.now();
  return {
    ...s.body,
    blocks: s.body.blocks.map((blk, i) => ({ ...blk, id: `b${stamp}-${i}` })),
    footer: { ...s.body.footer },
  };
}
