import { e, graph, n, and, p } from "./_helpers";
import type { RecipeDef } from ".";

export const mandateFailureRetryRecipe: RecipeDef = {
  key: "mandate_failure_smart_retry",
  name: "Mandate failure smart retry",
  description:
    "When a transaction fails with reason='mandate_failure', branch on reason code: insufficient balance → next-cycle retry; mandate expired → trigger renewal flow; tech reject → ops task.",
  category: "operations",
  tags: ["mandate", "retry"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", {}),
      n("branch", "branch", {
        cases: [
          { label: "Insufficient", criteria: and(p("event.sub_reason", "eq", "insufficient_balance")) },
          { label: "Expired", criteria: and(p("event.sub_reason", "eq", "mandate_expired")) },
          { label: "Technical", criteria: and(p("event.sub_reason", "in", ["technical", "system"])) },
        ],
      }),
      n("wa_insuff", "send_whatsapp", {
        templateKey: "mandate_failure_insufficient",
        variables: { name: "subject.name", amount: "event.amount" },
        category: "transactional",
      }),
      n("task_expired", "create_task", {
        title: "New mandate required — {{subject.name}}",
        type: "mandate_renewal",
        priority: "urgent",
        assignee: "subject.rm_id",
      }),
      n("task_tech", "create_task", {
        title: "Investigate mandate failure — {{subject.name}}",
        type: "mandate_review",
        priority: "high",
        assignee: "subject.rm_id",
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "branch"),
      e("e1", "branch", "wa_insuff", "case_0"),
      e("e2", "wa_insuff", "end"),
      e("e3", "branch", "task_expired", "case_1"),
      e("e4", "task_expired", "end"),
      e("e5", "branch", "task_tech", "case_2"),
      e("e6", "task_tech", "end"),
      e("e7", "branch", "end", "default"),
    ],
  }),
};
