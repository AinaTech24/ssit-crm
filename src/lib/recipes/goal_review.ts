import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

export const goalReviewRecipe: RecipeDef = {
  key: "goal_review_reminder",
  name: "Goal review reminder",
  description: "When goal.next_review_at falls due, WA the investor + create RM task.",
  category: "service",
  tags: ["goals"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", {}),
      n("wa", "send_whatsapp", {
        templateKey: "goal_review_due",
        variables: { name: "subject.name", goal: "event.goal_name" },
        category: "utility",
      }),
      n("task", "create_task", {
        title: "Goal review: {{event.goal_name}} for {{subject.name}}",
        type: "goal_review",
        priority: "normal",
        assignee: "subject.rm_id",
        dueAfter: { amount: 14, unit: "day" },
      }),
      n("end", "end", {}),
    ],
    edges: [e("e0", "trigger", "wa"), e("e1", "wa", "task"), e("e2", "task", "end")],
  }),
};
