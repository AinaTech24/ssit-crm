import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

/**
 * First investment celebration. The client's first investment is a milestone
 * worth marking — a warm congratulations builds the relationship, and the RM is
 * tasked to schedule the first review so the journey starts on the front foot.
 */
export const firstInvestmentCelebrationRecipe: RecipeDef = {
  key: "first_investment_celebration",
  name: "First investment → celebrate & schedule first review",
  description:
    "When a client makes their first investment, send a congratulations message and create an RM task to schedule the first portfolio review.",
  category: "engagement",
  tags: ["onboarding", "milestone", "retention", "celebration"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", { kind: "onboarding.first_investment", subjectType: "investor" }),
      n("celebrate", "send_whatsapp", {
        templateKey: "first_investment_wa",
        variables: { name: "subject.name" },
        category: "utility",
      }),
      n("task_review", "create_task", {
        title: "Schedule the first portfolio review with {{subject.name}}",
        type: "review_meeting",
        priority: "normal",
        assignee: "subject.rm_id",
        dueAfter: { amount: 7, unit: "day" },
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "celebrate"),
      e("e1", "celebrate", "task_review"),
      e("e2", "task_review", "end"),
    ],
  }),
  defaultTemplates: [
    {
      key: "first_investment_wa",
      channel: "whatsapp",
      name: "First investment celebration",
      category: "utility",
      body: {
        body: {
          text:
            "Congratulations {{name}}! 🎉 You've made your first investment — a big step towards your financial goals. " +
            "We're proud to be on this journey with you. Your advisor will check in soon to review your plan.",
        },
      },
      variables: [{ key: "name", type: "string", source: "subject.name", required: true }],
    },
  ],
};
