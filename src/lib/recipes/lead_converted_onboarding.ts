import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

/**
 * Lead converted → onboarding kick-off. Fires the moment a lead becomes a
 * client: a warm welcome plus the onboarding hand-off tasks (KYC, UCC, mandate)
 * so nothing stalls between sale and first investment.
 */
export const leadConvertedOnboardingRecipe: RecipeDef = {
  key: "lead_converted_onboarding",
  name: "Lead converted → welcome & onboarding kick-off",
  description:
    "When a lead is converted to a client, send a welcome message and auto-create the onboarding hand-off tasks (KYC, UCC, mandate) for the operations team.",
  category: "operations",
  tags: ["conversion", "onboarding", "welcome", "kyc"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", { kind: "lead.converted", subjectType: "investor" }),
      n("welcome", "send_whatsapp", {
        templateKey: "client_welcome_wa",
        variables: { name: "subject.name" },
        category: "utility",
      }),
      n("task_kyc", "create_task", {
        title: "Complete KYC & account opening for {{subject.name}}",
        type: "collect_document",
        priority: "high",
        assignee: "subject.rm_id",
        dueAfter: { amount: 2, unit: "day" },
      }),
      n("task_ucc", "create_task", {
        title: "Create UCC (BSE/NSE) for {{subject.name}}",
        type: "follow_up",
        priority: "high",
        assignee: "subject.rm_id",
        dueAfter: { amount: 3, unit: "day" },
      }),
      n("task_mandate", "create_task", {
        title: "Register SIP mandate (NACH/e-mandate) for {{subject.name}}",
        type: "follow_up",
        priority: "normal",
        assignee: "subject.rm_id",
        dueAfter: { amount: 4, unit: "day" },
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "welcome"),
      e("e1", "welcome", "task_kyc"),
      e("e2", "task_kyc", "task_ucc"),
      e("e3", "task_ucc", "task_mandate"),
      e("e4", "task_mandate", "end"),
    ],
  }),
  defaultTemplates: [
    {
      key: "client_welcome_wa",
      channel: "whatsapp",
      name: "Client welcome (post-conversion)",
      category: "utility",
      body: {
        body: {
          text:
            "Welcome aboard, {{name}}! 🎉 We're delighted to have you as a client. " +
            "Your advisor will guide you through a quick onboarding (KYC & account setup) so we can start working towards your goals.",
        },
      },
      variables: [{ key: "name", type: "string", source: "subject.name", required: true }],
    },
  ],
};
