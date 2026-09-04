import { e, graph, n, and, p } from "./_helpers";
import type { RecipeDef } from ".";

/**
 * Lead-created welcome (Onboarding flow #1).
 *
 * Fires on event `lead.created`.
 *
 * Branch:
 *   - Always: WhatsApp + email welcome to the lead. Each send is marked
 *     continueOnError so an unconfigured channel (no WhatsApp token yet)
 *     never stops the other one going out.
 *   - If source === "referral" OR "existing_client" AND referredByInvestorId
 *     is set: WhatsApp + email "thank-you for referring" to the referrer
 */
export const leadWelcomeRecipe: RecipeDef = {
  key: "lead_welcome",
  name: "New lead welcome + referrer thank-you",
  description:
    "When a lead is created, send a welcome WhatsApp + email to the lead immediately. If the lead came in via a referral and the referring client is on file, also send them a thank-you note.",
  category: "marketing",
  tags: ["lead", "welcome", "referral", "onboarding"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", { kind: "lead.created", subjectType: "lead" }),

      // Branch 1 — to lead (always)
      n("welcome_wa", "send_whatsapp", {
        templateKey: "lead_welcome_wa",
        variables: {
          lead_name: "subject.name",
          firm_name: "tenant.displayName",
          rm_name: "subject.owner_name",
        },
        category: "utility",
        continueOnError: true,
      }),
      n("welcome_email", "send_email", {
        templateKey: "lead_welcome_email",
        variables: {
          lead_name: "subject.name",
          firm_name: "tenant.displayName",
          rm_name: "subject.owner_name",
        },
        category: "transactional",
        continueOnError: true,
      }),

      // Branch 2 — referrer thank-you (if applicable)
      n("check_referral", "branch", {
        cases: [
          {
            label: "Referral with named referrer",
            criteria: and(
              p("subject.source", "in", ["referral", "existing_client"]),
              p("subject.referred_by_investor_id", "is_not_null")
            ),
          },
        ],
      }),
      n("thank_referrer_wa", "send_whatsapp", {
        templateKey: "referrer_thank_you_wa",
        variables: {
          referrer_name: "context.referrer_name",
          lead_name: "subject.name",
        },
        category: "utility",
        recipient: { source: "context", value: "referrer_phone" },
        continueOnError: true,
      }),
      n("thank_referrer_email", "send_email", {
        templateKey: "referrer_thank_you_email",
        variables: {
          referrer_name: "context.referrer_name",
          lead_name: "subject.name",
          firm_name: "tenant.displayName",
        },
        category: "transactional",
        recipient: { source: "context", value: "referrer_email" },
        continueOnError: true,
      }),

      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "welcome_wa"),
      e("e1", "welcome_wa", "welcome_email"),
      e("e2", "welcome_email", "check_referral"),
      e("e3", "check_referral", "thank_referrer_wa", "case_0"),
      e("e4", "thank_referrer_wa", "thank_referrer_email"),
      e("e5", "thank_referrer_email", "end"),
      e("e6", "check_referral", "end", "default"),
    ],
  }),
  defaultTemplates: [
    {
      key: "lead_welcome_wa",
      channel: "whatsapp",
      name: "Lead welcome (WA)",
      category: "utility",
      body: {
        body: {
          text:
            "Hi {{lead_name}} 👋\n\n" +
            "Thanks for connecting with *{{firm_name}}*. I'm {{rm_name}}, your dedicated relationship manager.\n\n" +
            "I'll reach out shortly to understand your goals and walk you through how we can help. Meanwhile, save this number — feel free to ping me anytime.",
        },
      },
      variables: [
        { key: "lead_name", type: "string", source: "subject.name", required: true },
        { key: "firm_name", type: "string", source: "tenant.displayName", required: true },
        { key: "rm_name", type: "string", source: "subject.owner_name", required: false, fallback: "your relationship manager" },
      ],
    },
    {
      key: "lead_welcome_email",
      channel: "email",
      name: "Lead welcome (Email)",
      category: "transactional",
      body: {
        mode: "designer",
        subject: "Welcome to {{firm_name}}, {{lead_name}}",
        preheader: "Your dedicated relationship manager is on the way.",
        theme: {
          brandColor: "#0ea5e9",
          accentColor: "#0e2557",
          pageBackground: "#f5f7fb",
          cardBackground: "#ffffff",
          textColor: "#111827",
          mutedColor: "#6b7280",
          fontFamily: "sans",
          baseFontSize: 15,
          containerWidth: 600,
          cornerRadius: 12,
          logoHeight: 40,
          logoAlign: "center",
        },
        blocks: [
          { id: "b1", type: "logo" },
          {
            id: "b2",
            type: "hero",
            title: "Welcome, {{lead_name}} 👋",
            subtitle: "Glad you reached out. We're here to help you invest with confidence.",
            imageUrl: "",
            imageAlt: "",
            align: "center",
          },
          {
            id: "b3",
            type: "text",
            html:
              "Hi {{lead_name}},<br/><br/>" +
              "Thank you for connecting with <b>{{firm_name}}</b>. I'm <b>{{rm_name}}</b>, your relationship manager. " +
              "Over the next few days, I'll reach out for a quick conversation to understand your financial goals.<br/><br/>" +
              "Based on what's right for you, we'll prepare a custom investment plan — backed by 15+ years of " +
              "expertise across mutual funds, insurance, and structured products.<br/><br/>" +
              "Feel free to reply to this email with any questions in the meantime.",
            align: "left",
          },
          { id: "b4", type: "divider", thickness: 1, color: "#e5e7eb" },
          {
            id: "b5",
            type: "text",
            html: "Warm regards,<br/><b>{{rm_name}}</b><br/>{{firm_name}}",
            align: "left",
          },
        ],
        footer: { includeArn: true, includeAddress: true, includeUnsubscribe: false },
      },
      variables: [
        { key: "lead_name", type: "string", source: "subject.name", required: true },
        { key: "firm_name", type: "string", source: "tenant.displayName", required: true },
        { key: "rm_name", type: "string", source: "subject.owner_name", required: false, fallback: "your relationship manager" },
      ],
    },
    {
      key: "referrer_thank_you_wa",
      channel: "whatsapp",
      name: "Referrer thank-you (WA)",
      category: "utility",
      body: {
        body: {
          text:
            "Hi {{referrer_name}} 🙏\n\n" +
            "Thank you for referring *{{lead_name}}* to us! Your trust means a lot.\n\n" +
            "I'll reach out to them shortly and keep you posted. As always, here if you need anything.",
        },
      },
      variables: [
        { key: "referrer_name", type: "string", source: "context.referrer_name", required: true },
        { key: "lead_name", type: "string", source: "subject.name", required: true },
      ],
    },
    {
      key: "referrer_thank_you_email",
      channel: "email",
      name: "Referrer thank-you (Email)",
      category: "transactional",
      body: {
        mode: "designer",
        subject: "Thank you for referring {{lead_name}}",
        preheader: "Your trust in us means everything.",
        theme: {
          brandColor: "#0ea5e9",
          accentColor: "#0e2557",
          pageBackground: "#f5f7fb",
          cardBackground: "#ffffff",
          textColor: "#111827",
          mutedColor: "#6b7280",
          fontFamily: "sans",
          baseFontSize: 15,
          containerWidth: 600,
          cornerRadius: 12,
          logoHeight: 40,
          logoAlign: "center",
        },
        blocks: [
          { id: "b1", type: "logo" },
          {
            id: "b2",
            type: "hero",
            title: "Thank you, {{referrer_name}} 🙏",
            subtitle: "We genuinely appreciate the trust.",
            imageUrl: "",
            imageAlt: "",
            align: "center",
          },
          {
            id: "b3",
            type: "text",
            html:
              "Hi {{referrer_name}},<br/><br/>" +
              "Thank you for referring <b>{{lead_name}}</b> to <b>{{firm_name}}</b>. We treat every referral as a " +
              "responsibility — we'll take great care of them.<br/><br/>" +
              "I'll connect with them in the next 24 hours and keep you informed of the next steps.<br/><br/>" +
              "Warm regards.",
            align: "left",
          },
        ],
        footer: { includeArn: true, includeAddress: true, includeUnsubscribe: false },
      },
      variables: [
        { key: "referrer_name", type: "string", source: "context.referrer_name", required: true },
        { key: "lead_name", type: "string", source: "subject.name", required: true },
        { key: "firm_name", type: "string", source: "tenant.displayName", required: true },
      ],
    },
  ],
};
