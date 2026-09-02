/**
 * Starter message templates — vendor-provided, compliance-reviewed defaults that
 * predefined Workflow Rules reference. They're auto-provisioned per tenant when
 * a rule that uses them is activated (see ensureStarterTemplate), so an MFD can
 * turn a rule on without first hand-authoring a template.
 *
 * Pure data (no DB imports). Email bodies use the EmailTemplateBody shape the
 * email renderer understands ({subject, blocks:[{type,...}], textFallback}).
 * Tokens: {{tenant_display_name}} / {{tenant_arn}} etc. are auto-injected from
 * the tenant; record fields (e.g. {{name}}, {{referred_by_name}}) are passed by
 * the workflow-rules send action.
 */

type StarterVar = {
  key: string;
  type: "string" | "number" | "currency" | "date" | "boolean" | "url";
  source?: string;
  required?: boolean;
  fallback?: unknown;
  format?: string;
};

export interface StarterTemplate {
  key: string;
  channel: "email" | "whatsapp" | "sms";
  category: "transactional" | "utility" | "marketing" | "authentication";
  name: string;
  description?: string;
  /** EmailTemplateBody for email; channel-specific otherwise. */
  body: Record<string, unknown>;
  variables: StarterVar[];
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    key: "lead_welcome",
    channel: "email",
    category: "transactional",
    name: "Lead welcome — thank you for connecting",
    description: "Sent to a new lead with no referral.",
    body: {
      subject: "Thank you for connecting with {{tenant_display_name}}",
      blocks: [
        { type: "header", title: "Thank you for connecting 🙏" },
        {
          type: "text",
          content:
            "Hi {{name}},\n\nThank you for connecting with {{tenant_display_name}}. We're glad to have the chance to help you with your investments.\n\nOne of our advisors will reach out to you shortly to understand your goals. If you have any questions in the meantime, just reply to this email.\n\nWarm regards,\n{{tenant_display_name}}",
        },
      ],
      textFallback:
        "Hi {{name}}, thank you for connecting with {{tenant_display_name}}. One of our advisors will reach out to you shortly.",
    },
    variables: [{ key: "name", type: "string", source: "lead.name", fallback: "there" }],
  },
  {
    key: "lead_welcome_referral",
    channel: "email",
    category: "transactional",
    name: "Lead welcome — referred by a client",
    description: "Sent to a new lead who came from a client referral; names the referrer.",
    body: {
      subject: "Thank you for connecting with {{tenant_display_name}}",
      blocks: [
        { type: "header", title: "Thank you for connecting 🙏" },
        {
          type: "text",
          content:
            "Hi {{name}},\n\nThank you for connecting with {{tenant_display_name}} — and a special thank-you to {{referred_by_name}}, who referred you to us. We're grateful for the introduction.\n\nOne of our advisors will reach out shortly to understand your goals. Feel free to reply to this email anytime.\n\nWarm regards,\n{{tenant_display_name}}",
        },
      ],
      textFallback:
        "Hi {{name}}, thank you for connecting with {{tenant_display_name}} — and thanks to {{referred_by_name}} for referring you. An advisor will reach out shortly.",
    },
    variables: [
      { key: "name", type: "string", source: "lead.name", fallback: "there" },
      { key: "referred_by_name", type: "string", source: "lead.referred_by_name" },
    ],
  },
  {
    key: "referrer_thank_you",
    channel: "email",
    category: "transactional",
    name: "Referral thank-you (to the referring client)",
    description: "Sent to the existing client who referred a new lead. Greets the client; names the lead they referred.",
    body: {
      // Recipient is the REFERRING CLIENT (an investor), so {{client_name}}
      // resolves from the investor; {{referred_lead_name}} is the new lead's name.
      subject: "Thank you for the referral, {{client_name}}!",
      blocks: [
        { type: "header", title: "Thank you for your referral 🙏" },
        {
          type: "text",
          content:
            "Hi {{client_name}},\n\nThank you so much for referring {{referred_lead_name}} to {{tenant_display_name}}. Referrals from valued clients like you mean the world to us — we'll take great care of them.\n\nWith gratitude,\n{{tenant_display_name}}",
        },
      ],
      textFallback:
        "Hi {{client_name}}, thank you for referring {{referred_lead_name}} to {{tenant_display_name}}. We truly appreciate it.",
    },
    variables: [{ key: "client_name", type: "string", source: "investor.name", fallback: "there" }],
  },
  {
    key: "meeting_scheduled",
    channel: "email",
    category: "transactional",
    name: "Meeting scheduled — confirmation",
    description: "Sent to the client when a meeting is scheduled; names the RM and the time.",
    body: {
      subject: "Your meeting with {{tenant_display_name}} is scheduled",
      blocks: [
        { type: "header", title: "Your meeting is scheduled ✅" },
        {
          type: "text",
          content: "Hi {{client_name}},\n\nYour meeting has been scheduled with {{rm_name}} on {{meeting_when}}.",
        },
        // Blank for in-person meetings / when no link was pasted.
        { type: "text", content: "{{meeting_join}}" },
        {
          type: "text",
          content:
            "We look forward to speaking with you. If you need to reschedule, just reply to this email.\n\nWarm regards,\n{{tenant_display_name}}",
        },
      ],
      textFallback:
        "Hi {{client_name}}, your meeting has been scheduled with {{rm_name}} on {{meeting_when}}. {{meeting_join}} — {{tenant_display_name}}",
    },
    variables: [{ key: "client_name", type: "string", source: "investor.name", fallback: "there" }],
  },
  {
    key: "meeting_reminder",
    channel: "email",
    category: "utility",
    name: "Meeting reminder",
    description: "Reminder sent before a scheduled meeting; names the RM and the time.",
    body: {
      subject: "Reminder: your meeting with {{tenant_display_name}}",
      blocks: [
        { type: "header", title: "Meeting reminder ⏰" },
        {
          type: "text",
          content:
            "Hi {{client_name}},\n\nThis is a friendly reminder of your upcoming meeting with {{rm_name}} on {{meeting_when}}.",
        },
        // Blank for in-person meetings / when no link was pasted.
        { type: "text", content: "{{meeting_join}}" },
        {
          type: "text",
          content:
            "We look forward to seeing you. If you need to reschedule, just reply to this email.\n\nWarm regards,\n{{tenant_display_name}}",
        },
      ],
      textFallback:
        "Reminder: your meeting with {{rm_name}} is on {{meeting_when}}. {{meeting_join}} — {{tenant_display_name}}",
    },
    variables: [{ key: "client_name", type: "string", source: "investor.name", fallback: "there" }],
  },
  {
    key: "meeting_minutes",
    channel: "email",
    category: "transactional",
    name: "Meeting minutes — thank you + summary",
    description: "Sent to the client when a meeting is completed: thanks them and shares AI-written minutes ({{minutes}}).",
    body: {
      subject: "Thank you for your time — minutes of our meeting",
      blocks: [
        { type: "header", title: "Thank you for your time 🙏" },
        {
          type: "text",
          content:
            "Hi {{client_name}},\n\nThank you for giving your valuable time to {{rm_name}}. It was a pleasure speaking with you. Here is a quick summary of what we discussed:",
        },
        { type: "text", content: "{{minutes}}" },
        {
          type: "text",
          content:
            "If anything above needs correcting, just reply to this email and we'll update it.\n\nWarm regards,\n{{rm_name}}\n{{tenant_display_name}}",
        },
      ],
      textFallback:
        "Hi {{client_name}}, thank you for your time with {{rm_name}}. Minutes of our meeting:\n\n{{minutes}}\n\n— {{tenant_display_name}}",
    },
    variables: [{ key: "client_name", type: "string", source: "investor.name", fallback: "there" }],
  },
  {
    key: "risk_profile_request",
    channel: "email",
    category: "transactional",
    name: "Risk profile — form fill request",
    description: "Sent when a lead is won for Mutual Funds; asks the client to complete their risk profile via a private link ({{risk_profile_link}}).",
    body: {
      subject: "One quick step: complete your risk profile with {{tenant_display_name}}",
      blocks: [
        { type: "header", title: "Let's get your investments started 🚀" },
        {
          type: "text",
          content:
            "Hi {{name}},\n\nWelcome aboard! Before we recommend the right mutual fund portfolio for you, we need to understand your risk appetite and goals. It takes about 2 minutes:",
        },
        { type: "button", label: "Complete my risk profile", url: "{{risk_profile_link}}" },
        {
          type: "text",
          content:
            "This link is private to you and valid for 14 days. Once you're done, your advisor will share a tailored plan.\n\nWarm regards,\n{{tenant_display_name}}",
        },
      ],
      textFallback:
        "Hi {{name}}, please complete your risk profile to get started: {{risk_profile_link}} (valid 14 days). — {{tenant_display_name}}",
    },
    variables: [{ key: "name", type: "string", source: "lead.name", fallback: "there" }],
  },
  {
    key: "birthday_wish",
    channel: "email",
    category: "marketing",
    name: "Happy Birthday wish",
    description: "Sent to a client on their birthday.",
    body: {
      subject: "Happy Birthday, {{name}}! 🎂",
      blocks: [
        { type: "header", title: "Happy Birthday! 🎉" },
        {
          type: "text",
          content:
            "Dear {{name}},\n\nOn behalf of everyone at {{tenant_display_name}}, wishing you a very Happy Birthday! May the year ahead bring you good health, happiness, and prosperity.\n\nWarm wishes,\n{{tenant_display_name}}",
        },
      ],
      textFallback:
        "Dear {{name}}, wishing you a very Happy Birthday from all of us at {{tenant_display_name}}! 🎂",
    },
    variables: [{ key: "name", type: "string", source: "investor.name", fallback: "there" }],
  },
  {
    key: "doc_checklist",
    channel: "email",
    category: "transactional",
    name: "Onboarding document checklist + upload link",
    description: "Sent to a new client to request KYC/onboarding documents via a secure upload link ({{document_collection_link}}).",
    body: {
      subject: "Documents needed to complete your onboarding with {{tenant_display_name}}",
      blocks: [
        { type: "header", title: "A few documents to get you started 📄" },
        {
          type: "text",
          content:
            "Hi {{name}},\n\nWelcome to {{tenant_display_name}}! To complete your onboarding and KYC, please share the following documents:",
        },
        {
          type: "text",
          content:
            "• PAN card\n• Address proof (Aadhaar / passport / utility bill)\n• Bank proof (cancelled cheque / passbook / recent statement)\n• Passport-size photograph\n• Cancelled cheque (for your SIP mandate)",
        },
        { type: "button", label: "Upload my documents securely", url: "{{document_collection_link}}" },
        {
          type: "text",
          content:
            "This link is private to you and valid for 14 days. Once we receive your documents, we'll proceed with your account setup.\n\nWarm regards,\n{{tenant_display_name}}",
        },
      ],
      textFallback:
        "Hi {{name}}, to complete onboarding please upload your KYC documents (PAN, address proof, bank proof, photo, cancelled cheque) here: {{document_collection_link}} (valid 14 days). — {{tenant_display_name}}",
    },
    variables: [{ key: "name", type: "string", source: "investor.name", fallback: "there" }],
  },
  {
    key: "business_confirmation",
    channel: "email",
    category: "transactional",
    name: "Transaction / business confirmation",
    description: "Sent to the client when a business entry is confirmed — confirms what was recorded.",
    body: {
      subject: "Transaction confirmation — {{tenant_display_name}}",
      blocks: [
        { type: "header", title: "Transaction recorded ✅" },
        {
          type: "text",
          content:
            "Hi {{client_name}},\n\nThis confirms that {{tenant_display_name}} has recorded your transaction:",
        },
        {
          type: "text",
          content: "Amount: ₹{{total_amount}}\nAMC: {{amc_name}}\nDate: {{business_date}}",
        },
        {
          type: "text",
          content:
            "Thank you for investing with us. If anything looks incorrect, just reply to this email and we'll fix it.\n\nWarm regards,\n{{tenant_display_name}}",
        },
      ],
      textFallback:
        "Hi {{client_name}}, {{tenant_display_name}} has recorded your transaction of ₹{{total_amount}} ({{amc_name}}, {{business_date}}). Reply if anything looks off.",
    },
    variables: [{ key: "client_name", type: "string", source: "investor.name", fallback: "there" }],
  },
  {
    key: "kyc_expiry", channel: "email", category: "utility",
    name: "KYC expiry reminder", description: "Sent before a client's KYC expires.",
    body: {
      subject: "Action needed: your KYC is expiring soon",
      blocks: [
        { type: "header", title: "Let's keep your KYC current 🔁" },
        { type: "text", content: "Hi {{client_name}},\n\nYour KYC is due to expire soon. To keep your investments active and compliant, we need to complete a quick re-KYC. Just reply to this email and we'll guide you through it.\n\nWarm regards,\n{{tenant_display_name}}" },
      ],
      textFallback: "Hi {{client_name}}, your KYC is expiring soon — reply and we'll help you re-KYC. — {{tenant_display_name}}",
    },
    variables: [{ key: "client_name", type: "string", source: "investor.name", fallback: "there" }],
  },
  {
    key: "sip_ending", channel: "email", category: "utility",
    name: "SIP ending soon", description: "Sent before a SIP's end date.",
    body: {
      subject: "Your SIP is ending soon",
      blocks: [
        { type: "header", title: "Your SIP is wrapping up ⏳" },
        { type: "text", content: "Hi {{client_name}},\n\nYour SIP ({{scheme_name}}) is scheduled to end on {{end_date}}. Let's review whether to renew or step it up so your goals stay on track. Reply and we'll set it up.\n\nWarm regards,\n{{tenant_display_name}}" },
      ],
      textFallback: "Hi {{client_name}}, your SIP ({{scheme_name}}) ends on {{end_date}} — let's renew or step it up. — {{tenant_display_name}}",
    },
    variables: [{ key: "client_name", type: "string", source: "investor.name", fallback: "there" }],
  },
  {
    key: "premium_renewal", channel: "email", category: "utility",
    name: "Insurance premium renewal reminder", description: "Sent before a policy's next premium due date.",
    body: {
      subject: "Premium due soon — keep your cover active",
      blocks: [
        { type: "header", title: "Premium due soon 🛡️" },
        { type: "text", content: "Hi {{client_name}},\n\nYour insurance premium is due on {{next_premium_due_date}}. Please pay before the due date to keep policy {{policy_number}} in force. Reply if you'd like a hand with the payment.\n\nWarm regards,\n{{tenant_display_name}}" },
      ],
      textFallback: "Hi {{client_name}}, your insurance premium (policy {{policy_number}}) is due {{next_premium_due_date}}. — {{tenant_display_name}}",
    },
    variables: [{ key: "client_name", type: "string", source: "investor.name", fallback: "there" }],
  },
  {
    key: "policy_maturity", channel: "email", category: "utility",
    name: "Policy maturity heads-up", description: "Sent before a policy matures.",
    body: {
      subject: "Your policy is maturing soon",
      blocks: [
        { type: "header", title: "Your policy is maturing 🎯" },
        { type: "text", content: "Hi {{client_name}},\n\nYour policy {{policy_number}} matures on {{maturity_date}}. Let's plan how to reinvest the proceeds to keep your money working. Reply to schedule a quick call.\n\nWarm regards,\n{{tenant_display_name}}" },
      ],
      textFallback: "Hi {{client_name}}, policy {{policy_number}} matures on {{maturity_date}} — let's plan the reinvestment. — {{tenant_display_name}}",
    },
    variables: [{ key: "client_name", type: "string", source: "investor.name", fallback: "there" }],
  },
  {
    key: "onboarding_anniversary", channel: "email", category: "transactional",
    name: "Client anniversary", description: "Sent yearly on the client's onboarding anniversary.",
    body: {
      subject: "Happy anniversary with {{tenant_display_name}}! 🎉",
      blocks: [
        { type: "header", title: "Cheers to another year together 🥂" },
        { type: "text", content: "Hi {{client_name}},\n\nIt's another year since you joined {{tenant_display_name}}. Thank you for your trust — here's to many more years of growing your wealth together. We're always here if you need anything.\n\nWarm regards,\n{{tenant_display_name}}" },
      ],
      textFallback: "Hi {{client_name}}, happy anniversary with {{tenant_display_name}} — thank you for your trust!",
    },
    variables: [{ key: "client_name", type: "string", source: "investor.name", fallback: "there" }],
  },
  {
    key: "stale_lead_nurture", channel: "email", category: "marketing",
    name: "Stale lead re-engagement", description: "Sent to a lead with no activity for a while.",
    body: {
      subject: "Still thinking it over?",
      blocks: [
        { type: "header", title: "We're here when you're ready 👋" },
        { type: "text", content: "Hi {{name}},\n\nWe noticed we haven't connected in a while. We'd love to help you start your investment journey with {{tenant_display_name}} — just reply and we'll take it from there, no pressure.\n\nWarm regards,\n{{tenant_display_name}}" },
      ],
      textFallback: "Hi {{name}}, we'd love to help you get started with {{tenant_display_name}} — just reply. ",
    },
    variables: [{ key: "name", type: "string", source: "lead.name", fallback: "there" }],
  },
  {
    key: "goal_review", channel: "email", category: "utility",
    name: "Goal target approaching", description: "Sent before a goal's target date.",
    body: {
      subject: "Your goal is approaching — let's review",
      blocks: [
        { type: "header", title: "Your goal is in sight 🎯" },
        { type: "text", content: "Hi {{client_name}},\n\nYour goal “{{name}}” is approaching its target date ({{target_date}}). Let's review your progress and make any adjustments so you finish strong. Reply to book a quick review.\n\nWarm regards,\n{{tenant_display_name}}" },
      ],
      textFallback: "Hi {{client_name}}, your goal “{{name}}” (target {{target_date}}) is approaching — let's review. — {{tenant_display_name}}",
    },
    variables: [{ key: "client_name", type: "string", source: "investor.name", fallback: "there" }],
  },
  {
    key: "dormant_reengage", channel: "email", category: "marketing",
    name: "Dormant client re-engagement", description: "Sent when a client hasn't transacted in a long time.",
    body: {
      subject: "We miss you, {{client_name}}",
      blocks: [
        { type: "header", title: "Let's reconnect 🤝" },
        { type: "text", content: "Hi {{client_name}},\n\nIt's been a while since your last transaction. Markets and opportunities have moved on — let's reconnect and make sure your portfolio is still working hard for you. Reply and we'll set up a quick review.\n\nWarm regards,\n{{tenant_display_name}}" },
      ],
      textFallback: "Hi {{client_name}}, it's been a while — let's reconnect and review your portfolio. — {{tenant_display_name}}",
    },
    variables: [{ key: "client_name", type: "string", source: "investor.name", fallback: "there" }],
  },
  {
    key: "sip_stepup", channel: "email", category: "marketing",
    name: "Annual SIP step-up nudge", description: "Sent yearly suggesting a SIP step-up.",
    body: {
      subject: "Time to step up your SIP?",
      blocks: [
        { type: "header", title: "A small step, a big difference 📈" },
        { type: "text", content: "Hi {{client_name}},\n\nYour SIP has completed another year. A small annual step-up can significantly grow your corpus over time, thanks to compounding. Reply and we'll show you the impact on your goals.\n\nWarm regards,\n{{tenant_display_name}}" },
      ],
      textFallback: "Hi {{client_name}}, consider stepping up your SIP this year — reply to see the impact. — {{tenant_display_name}}",
    },
    variables: [{ key: "client_name", type: "string", source: "investor.name", fallback: "there" }],
  },
  {
    key: "client_welcome", channel: "email", category: "transactional",
    name: "New client welcome", description: "Sent when a client is onboarded.",
    body: {
      subject: "Welcome to {{tenant_display_name}}! 🎉",
      blocks: [
        { type: "header", title: "Welcome aboard 🎉" },
        { type: "text", content: "Hi {{client_name}},\n\nWelcome to {{tenant_display_name}}! We're delighted to have you. Your advisor will be in touch shortly, and you can reach us anytime just by replying to this email. Here's to building your wealth together.\n\nWarm regards,\n{{tenant_display_name}}" },
      ],
      textFallback: "Hi {{client_name}}, welcome to {{tenant_display_name}}! Your advisor will be in touch shortly.",
    },
    variables: [{ key: "client_name", type: "string", source: "investor.name", fallback: "there" }],
  },
];

export function getStarterTemplate(key: string): StarterTemplate | undefined {
  return STARTER_TEMPLATES.find((t) => t.key === key);
}
