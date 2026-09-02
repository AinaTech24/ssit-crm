import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

/**
 * Insurance premium reminder.
 *
 * The daily-ops scanner emits `insurance.premium_due` at 15 / 7 / 1 days before
 * a policy's next premium (the schema already indexes next_premium_due_date and
 * the register surfaces "Premium due (30d)" — but nothing nudged the client).
 * Lapsed insurance = lost cover for the client + lost persistency/trail for the
 * MFD, so a proactive WhatsApp + RM follow-up is one of the highest-ROI plays.
 *
 * Subject is the investor; the event payload carries the policy details.
 */
export const insurancePremiumReminderRecipe: RecipeDef = {
  key: "insurance_premium_reminder",
  name: "Insurance premium reminder",
  description:
    "When a policy's premium is due (15/7/1 days out), WhatsApp the client a reminder and create an RM follow-up task. Protects the client's cover and your persistency. " +
    "Note: overlaps with the \"Insurance premium reminder\" predefined rule (email, 7 days out) — enable only one so the client isn't messaged twice at the 7-day mark.",
  category: "retention",
  tags: ["insurance", "retention", "persistency"],
  defaultTemplates: [
    {
      key: "insurance_premium_due_wa",
      channel: "whatsapp",
      category: "transactional",
      name: "Insurance premium due — WhatsApp",
      body: {
        body: {
          text:
            "Hi {{name}}, a quick reminder that the premium for your {{plan_name}} policy " +
            "({{insurer}}) is due on {{due_date}}. Paying before the due date keeps your cover " +
            "active without interruption. Reply here if you'd like help with the payment.\n\n" +
            "Insurance is the subject matter of solicitation.\n— {{arn_name}}, ARN-{{arn_no}}",
        },
      },
      variables: [
        { key: "name", type: "string", source: "subject.name", required: true },
        { key: "plan_name", type: "string", source: "event.plan_name", required: true },
        { key: "insurer", type: "string", source: "event.insurer", required: false },
        { key: "due_date", type: "string", source: "event.due_date", required: true },
      ],
    },
  ],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", { kind: "insurance.premium_due", subjectType: "investor" }),
      n("wa", "send_whatsapp", {
        templateKey: "insurance_premium_due_wa",
        variables: {
          name: "subject.name",
          plan_name: "event.plan_name",
          insurer: "event.insurer",
          due_date: "event.due_date",
        },
        category: "transactional",
      }),
      n("task", "create_task", {
        title: "Premium due — {{subject.name}} · {{event.plan_name}} ({{event.due_date}})",
        type: "insurance_premium_followup",
        priority: "high",
        assignee: "subject.rm_id",
        dueAfter: { amount: 1, unit: "day" },
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
