import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

export const rmScorecardRecipe: RecipeDef = {
  key: "rm_weekly_scorecard",
  name: "Weekly RM scorecard",
  description: "Every Monday 7AM, send each RM their weekly activity scorecard (calls, tasks closed, follow-ups) and CC branch head.",
  category: "internal",
  tags: ["rm", "scorecard"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", {}),
      n("compose", "ai_compose", {
        prompt:
          "Write a weekly scorecard for the RM. Include: calls made, tasks closed, follow-ups overdue, net sales contribution, top 3 investors needing attention next week. Brief, warm, motivating tone.",
        storeAs: "scorecard",
        context: ["context.rm_stats"],
        maxTokens: 700,
      }),
      n("email", "send_email", {
        templateKey: "rm_scorecard_email",
        variables: { name: "subject.name", scorecard: "vars.scorecard" },
        category: "transactional",
        recipient: { source: "subject" },
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "compose"),
      e("e1", "compose", "email"),
      e("e2", "email", "end"),
    ],
  }),
};
