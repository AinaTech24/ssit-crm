import { e, graph, n, and, p } from "./_helpers";
import type { RecipeDef } from ".";

/**
 * Operations complete → portal welcome (Onboarding flow #3).
 *
 * Fires on event `onboarding.completed` — emitted when all 4 ops tasks for a
 * client are marked done. The recipe sends the formal portal-welcome email
 * + WhatsApp with the client's login link, and notifies the RM that the
 * handoff is complete.
 *
 * Sets the investor's lastReviewAt and nextReviewAt so the periodic
 * review-cadence workflow picks up from here.
 */
export const opsCompletePortalWelcomeRecipe: RecipeDef = {
  key: "ops_complete_portal_welcome",
  name: "Onboarding complete → portal welcome",
  description:
    "When all 4 onboarding tasks (KYC, UCC, Mandate, First transaction) are done, send the client a portal welcome with login details, schedule the first review per service tier, and notify the RM.",
  category: "onboarding",
  tags: ["portal", "welcome", "operations", "onboarding"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", {}),

      n("portal_email", "send_email", {
        templateKey: "client_portal_welcome_email",
        variables: {
          client_name: "subject.name",
          firm_name: "tenant.displayName",
          portal_url: "system.portal_url",
          rm_name: "subject.rm_name",
        },
        category: "transactional",
      }),
      n("portal_wa", "send_whatsapp", {
        templateKey: "client_portal_welcome_wa",
        variables: {
          client_name: "subject.name",
          portal_url: "system.portal_url",
        },
        category: "utility",
      }),

      // Set lastReviewAt = now and nextReviewAt per service_tier.
      // Cadence: A = +90d, B = +180d, C = +365d (default 365 if unset).
      n("schedule_review", "update_field", {
        target: "subject",
        updates: {
          last_review_at: "{{system.now}}",
          // The new review date is computed by an http_request below since
          // we need conditional logic (tier-driven). update_field with a
          // raw {{...}} placeholder works for simple "now"; for the tier
          // calc we hand off to an internal helper.
        },
      }),
      n("compute_next_review", "http_request", {
        url: "{{system.api_base}}/internal/investors/schedule-review",
        method: "POST",
        bodyTemplate: JSON.stringify({
          tenantId: "{{tenant.id}}",
          investorId: "{{subject.id}}",
        }),
      }),

      n("notify_rm", "create_notification", {
        kind: "client.onboarding.complete",
        severity: "success",
        title: "{{subject.name}} is fully onboarded 🎉",
        body:
          "All 4 operations tasks are done. Portal welcome sent. First review scheduled per service tier.",
        linkUrl: "/dashboard/investors/{{subject.id}}",
        audience: { users: [], roles: [], subjectRm: true },
      }),

      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "portal_email"),
      e("e1", "portal_email", "portal_wa"),
      e("e2", "portal_wa", "schedule_review"),
      e("e3", "schedule_review", "compute_next_review"),
      e("e4", "compute_next_review", "notify_rm"),
      e("e5", "notify_rm", "end"),
    ],
  }),
  defaultTemplates: [
    {
      key: "client_portal_welcome_email",
      channel: "email",
      name: "Client portal welcome",
      category: "transactional",
      body: {
        mode: "designer",
        subject: "Welcome aboard, {{client_name}} — your portal is ready 🎉",
        preheader: "Login details inside. Track your investments anytime.",
        theme: {
          brandColor: "#d22e32",
          accentColor: "#841f21",
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
            title: "Welcome aboard, {{client_name}} 🎉",
            subtitle: "Your account is live and your portal is ready.",
            imageUrl: "",
            imageAlt: "",
            align: "center",
          },
          {
            id: "b3",
            type: "text",
            html:
              "Hi {{client_name}},<br/><br/>" +
              "Everything is set up — your KYC is verified, your investment account is active, and your first " +
              "transactions are scheduled.<br/><br/>" +
              "Use the link below to access your client portal anytime. You can view holdings, statements, " +
              "and run quick reports.",
            align: "left",
          },
          {
            id: "b4",
            type: "button",
            label: "Open my client portal",
            url: "{{portal_url}}",
            align: "center",
            style: "solid",
            fullWidth: false,
          },
          { id: "b5", type: "divider", thickness: 1, color: "#e5e7eb" },
          {
            id: "b6",
            type: "text",
            html:
              "Your relationship manager <b>{{rm_name}}</b> will reach out periodically for a portfolio review. " +
              "In the meantime, reply to this email anytime with questions.",
            align: "left",
          },
        ],
        footer: { includeArn: true, includeAddress: true, includeUnsubscribe: false },
      },
      variables: [
        { key: "client_name", type: "string", source: "subject.name", required: true },
        { key: "firm_name", type: "string", source: "tenant.displayName", required: true },
        { key: "portal_url", type: "url", source: "system.portal_url", required: false, fallback: "/portal" },
        { key: "rm_name", type: "string", source: "subject.rm_name", required: false },
      ],
    },
    {
      key: "client_portal_welcome_wa",
      channel: "whatsapp",
      name: "Client portal welcome (WA)",
      category: "utility",
      body: {
        body: {
          text:
            "🎉 Welcome aboard, {{client_name}}!\n\n" +
            "Your investment account is fully set up. Track your holdings + statements on the client portal:\n\n" +
            "{{portal_url}}\n\n" +
            "Save this chat — feel free to reach out anytime.",
        },
      },
      variables: [
        { key: "client_name", type: "string", source: "subject.name", required: true },
        { key: "portal_url", type: "url", source: "system.portal_url", required: false },
      ],
    },
  ],
};
