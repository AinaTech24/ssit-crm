import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

export const retailHalfYearlyReviewRecipe: RecipeDef = {
  key: "retail_halfyearly_review",
  name: "Retail half-yearly review cadence",
  description:
    "For retail-segment investors whose last review was >180 days ago, create an RM task. Lower priority than HNI.",
  category: "service",
  tags: ["review", "retail"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", {}),
      n("task", "create_task", {
        title: "Half-yearly review — {{subject.name}}",
        type: "review_meeting",
        priority: "normal",
        assignee: "subject.rm_id",
        dueAfter: { amount: 21, unit: "day" },
      }),
      n("end", "end", {}),
    ],
    edges: [e("e0", "trigger", "task"), e("e1", "task", "end")],
  }),
};
