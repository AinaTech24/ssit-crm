import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

export const hniQuarterlyReviewRecipe: RecipeDef = {
  key: "hni_quarterly_review",
  name: "HNI quarterly review cadence",
  description:
    "Daily check: for any HNI investor whose last review was >90 days ago, create an RM task. If not completed within 14 days, escalate to branch head.",
  category: "service",
  tags: ["review", "hni", "retention"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", {}),
      n("task", "create_task", {
        title: "Schedule quarterly review with {{subject.name}}",
        type: "review_meeting",
        priority: "high",
        assignee: "subject.rm_id",
        dueAfter: { amount: 14, unit: "day" },
        slaAfter: { amount: 21, unit: "day" },
      }),
      n("delay", "delay", { duration: { amount: 14, unit: "day" } }),
      n("escalate", "raise_alert", {
        severity: "warning",
        title: "Overdue HNI review: {{subject.name}}",
        audience: { roles: ["branch_head"], users: [] },
        channels: ["inapp", "email"],
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "task"),
      e("e1", "task", "delay"),
      e("e2", "delay", "escalate"),
      e("e3", "escalate", "end"),
    ],
  }),
};
