import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

/**
 * Risk profile completed → suitability summary + proposal nudge. The moment a
 * client finishes risk profiling, send them their risk category and task the RM
 * to send a suitable proposal while intent is hot.
 */
export const riskProfileCompletedRecipe: RecipeDef = {
  key: "risk_profile_completed",
  name: "Risk profile completed → suitability & proposal",
  description:
    "When a client completes their risk profile, send a suitability summary (their risk category) and create an RM task to share a matching proposal.",
  category: "sales",
  tags: ["risk-profile", "suitability", "proposal", "onboarding"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", { kind: "risk_profile.completed", subjectType: "investor" }),
      n("send_wa", "send_whatsapp", {
        templateKey: "risk_profile_done_wa",
        variables: { name: "subject.name", category: "event.risk_category" },
        category: "utility",
      }),
      n("task_proposal", "create_task", {
        title: "Send a suitable proposal to {{subject.name}} ({{event.risk_category}} risk)",
        type: "follow_up",
        priority: "high",
        assignee: "subject.rm_id",
        dueAfter: { amount: 1, unit: "day" },
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "send_wa"),
      e("e1", "send_wa", "task_proposal"),
      e("e2", "task_proposal", "end"),
    ],
  }),
  defaultTemplates: [
    {
      key: "risk_profile_done_wa",
      channel: "whatsapp",
      name: "Risk profile completed",
      category: "utility",
      body: {
        body: {
          text:
            "Hi {{name}}, thank you for completing your risk assessment. Your profile is *{{category}}*. " +
            "Based on this, your advisor will share a suitable, goal-aligned investment plan shortly.",
        },
      },
      variables: [
        { key: "name", type: "string", source: "subject.name", required: true },
        { key: "category", type: "string", source: "event.risk_category", required: true },
      ],
    },
  ],
};
