import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

/**
 * SIP expiry / renewal reminder.
 *
 * The daily-ops scanner emits `sip.expiring` at 30/15/7 days before an active
 * SIP's end_date. A SIP that simply runs to its end date and isn't renewed is
 * silently-lost recurring AUM — the single biggest avoidable leak in an MFD
 * book. This nudges the client to extend + tasks the RM to follow up.
 *
 * Subject is the investor; the event payload carries the SIP details.
 */
export const sipExpiryReminderRecipe: RecipeDef = {
  key: "sip_expiry_reminder",
  name: "SIP expiry / renewal reminder",
  description:
    "When an active SIP is approaching its end date (30/15/7 days out), WhatsApp the client to extend and create an RM renewal task — protects recurring AUM.",
  category: "retention",
  tags: ["sip", "retention", "renewal", "persistency"],
  defaultTemplates: [
    {
      key: "sip_expiry_wa",
      channel: "whatsapp",
      category: "transactional",
      name: "SIP expiring — WhatsApp",
      body: {
        body: {
          text:
            "Hi {{name}}, your SIP in {{scheme}} ({{amount}}/installment) is set to end on {{end_date}}. " +
            "Extending it keeps your compounding on track — shall I set up a renewal? Happy to help.\n\n" +
            "Mutual fund investments are subject to market risks. Read all scheme related documents carefully.\n" +
            "— {{arn_name}}, ARN-{{arn_no}}",
        },
      },
      variables: [
        { key: "name", type: "string", source: "subject.name", required: true },
        { key: "scheme", type: "string", source: "event.scheme_name", required: true },
        { key: "amount", type: "number", source: "event.amount", required: false },
        { key: "end_date", type: "string", source: "event.end_date", required: true },
      ],
    },
  ],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", { kind: "sip.expiring", subjectType: "investor" }),
      n("wa", "send_whatsapp", {
        templateKey: "sip_expiry_wa",
        variables: {
          name: "subject.name",
          scheme: "event.scheme_name",
          amount: "event.amount",
          end_date: "event.end_date",
        },
        category: "transactional",
      }),
      n("task", "create_task", {
        title: "SIP renewal — {{subject.name}} · {{event.scheme_name}} ends {{event.end_date}}",
        type: "sip_renewal",
        priority: "high",
        assignee: "subject.rm_id",
        dueAfter: { amount: 2, unit: "day" },
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "wa"),
      e("e1", "wa", "task"),
      e("e2", "task", "end"),
    ],
  }),
};
