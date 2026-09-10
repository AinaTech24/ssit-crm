import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

/**
 * Proposal approved → request KYC documents (Onboarding flow #4).
 *
 * Fires on event `proposal.accepted`. The RM has already created the
 * proposal acceptance link and the client has signed it. This recipe:
 *   1. Stamps the lead's stage to `docs_requested`.
 *   2. Generates a document-collection share token via internal API.
 *   3. Sends the link to the client via WhatsApp + email.
 *   4. Adds a 2-day-out follow-up task for the RM in case the client doesn't
 *      upload promptly.
 */
export const proposalApprovedRequestDocsRecipe: RecipeDef = {
  key: "proposal_approved_request_docs",
  name: "Proposal approved → request KYC documents",
  description:
    "When a client approves a proposal, immediately send them the document-collection form (PAN, Aadhar, bank statement, photo, cheque) via WhatsApp + email. RM gets a follow-up task in 2 days if docs aren't uploaded.",
  category: "onboarding",
  tags: ["proposal", "kyc", "docs", "onboarding"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", {}),

      // Mint a document-collection share token for the lead
      n("mint_token", "http_request", {
        url: "{{system.api_base}}/internal/share-tokens",
        method: "POST",
        bodyTemplate: JSON.stringify({
          tenantId: "{{tenant.id}}",
          kind: "document_collection",
          subjectType: "lead",
          subjectId: "{{event.leadId}}",
          expiresInDays: 14,
        }),
        storeResultAs: "share",
      }),

      // Update lead stage
      n("update_lead_stage", "update_field", {
        target: "subject",
        updates: { stage: "docs_requested" },
      }),

      // Send the doc link
      n("send_wa", "send_whatsapp", {
        templateKey: "docs_request_wa",
        variables: {
          client_name: "subject.name",
          docs_url: "vars.share.url",
        },
        category: "utility",
      }),
      n("send_email", "send_email", {
        templateKey: "docs_request_email",
        variables: {
          client_name: "subject.name",
          docs_url: "vars.share.url",
          firm_name: "tenant.displayName",
        },
        category: "transactional",
      }),

      // Follow-up task in 2 days for the RM
      n("follow_up_task", "create_task", {
        title: "Follow up on KYC docs from {{subject.name}}",
        description:
          "Document-collection link was sent. Check if the client has uploaded their PAN, Aadhar, photo, bank proof, and cheque.",
        type: "follow_up",
        priority: "high",
        assignee: "subject.owner_id",
        department: "sales",
        dueAfter: { amount: 2, unit: "day" },
      }),

      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "mint_token"),
      e("e1", "mint_token", "update_lead_stage"),
      e("e2", "update_lead_stage", "send_wa"),
      e("e3", "send_wa", "send_email"),
      e("e4", "send_email", "follow_up_task"),
      e("e5", "follow_up_task", "end"),
    ],
  }),
  defaultTemplates: [
    {
      key: "docs_request_wa",
      channel: "whatsapp",
      name: "KYC docs request (WA)",
      category: "utility",
      body: {
        body: {
          text:
            "Hi {{client_name}} 🎉\n\n" +
            "Thanks for approving the proposal! To open your investment account, please upload your KYC documents using this secure link (expires in 14 days):\n\n" +
            "{{docs_url}}\n\n" +
            "You'll need: PAN, Aadhar, photo, bank statement, cancelled cheque.",
        },
      },
      variables: [
        { key: "client_name", type: "string", source: "subject.name", required: true },
        { key: "docs_url", type: "url", source: "vars.share.url", required: true },
      ],
    },
    {
      key: "docs_request_email",
      channel: "email",
      name: "KYC docs request (Email)",
      category: "transactional",
      body: {
        mode: "designer",
        subject: "Next step — upload your KYC documents to open the account",
        preheader: "Secure single-use link. Takes 5 minutes.",
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
            title: "Almost there, {{client_name}}!",
            subtitle: "One last step — upload your KYC documents to activate your investment account.",
            imageUrl: "",
            imageAlt: "",
            align: "center",
          },
          {
            id: "b3",
            type: "data_table",
            caption: "Please keep handy:",
            rows: [
              { label: "PAN card", value: "Photo or scan" },
              { label: "Aadhar card", value: "Front + back" },
              { label: "Passport-size photo", value: "Recent" },
              { label: "Bank statement", value: "Last 3 months" },
              { label: "Cancelled cheque", value: "Of the bank you'll invest from" },
            ],
          },
          {
            id: "b4",
            type: "button",
            label: "Upload my documents",
            url: "{{docs_url}}",
            align: "center",
            style: "solid",
            fullWidth: false,
          },
          {
            id: "b5",
            type: "text",
            html:
              "<i>This link is single-use and expires in 14 days. Your documents are encrypted in transit + at rest, " +
              "and only visible to your relationship manager and our back-office team.</i>",
            align: "center",
          },
        ],
        footer: { includeArn: true, includeAddress: true, includeUnsubscribe: false },
      },
      variables: [
        { key: "client_name", type: "string", source: "subject.name", required: true },
        { key: "docs_url", type: "url", source: "vars.share.url", required: true },
        { key: "firm_name", type: "string", source: "tenant.displayName", required: true },
      ],
    },
  ],
};
