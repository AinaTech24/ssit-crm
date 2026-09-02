import { e, graph, n, and, p } from "./_helpers";
import type { RecipeDef } from ".";

export const redemptionRetentionRecipe: RecipeDef = {
  key: "redemption_retention",
  name: "Redemption alert + retention play",
  description:
    "Real-time alert when a redemption transaction lands. Large redemptions (>₹5L) trigger immediate RM task + owner alert. Full-folio redemptions also send the investor a 'let's talk' WhatsApp.",
  category: "retention",
  tags: ["redemption", "retention"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", {}),
      n("branch", "branch", {
        cases: [
          { label: ">₹5L", criteria: and(p("event.amount", "gte", 500000)) },
          { label: ">₹1L", criteria: and(p("event.amount", "gte", 100000)) },
        ],
      }),
      n("alert_large", "raise_alert", {
        severity: "critical",
        title: "Large redemption: {{subject.name}} — ₹{{event.amount}}",
        body: "Immediate retention contact required.",
        audience: { roles: ["owner", "branch_head"], users: [] },
        channels: ["inapp", "whatsapp"],
      }),
      n("task_large", "create_task", {
        title: "Retention call: {{subject.name}} ({{event.amount}})",
        type: "retention",
        priority: "urgent",
        assignee: "subject.rm_id",
        slaAfter: { amount: 24, unit: "hour" },
      }),
      n("send_wa_investor", "send_whatsapp", {
        templateKey: "redemption_lets_talk",
        variables: { name: "subject.name" },
        category: "transactional",
      }),
      n("task_med", "create_task", {
        title: "Follow up on redemption — {{subject.name}}",
        type: "retention",
        priority: "high",
        assignee: "subject.rm_id",
        slaAfter: { amount: 72, unit: "hour" },
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "branch"),
      e("e1", "branch", "alert_large", "case_0"),
      e("e2", "alert_large", "task_large"),
      e("e3", "task_large", "send_wa_investor"),
      e("e4", "send_wa_investor", "end"),
      e("e5", "branch", "task_med", "case_1"),
      e("e6", "task_med", "end"),
      e("e7", "branch", "end", "default"),
    ],
  }),
};
