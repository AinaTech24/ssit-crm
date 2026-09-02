import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

export const bankUpdateRecipe: RecipeDef = {
  key: "bank_update_verification",
  name: "Bank update verification",
  description: "When an investor's bank details change, send a WA verification message and create an ops task with 7-day SLA.",
  category: "operations",
  tags: ["bank", "verification"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", {}),
      n("wa", "send_whatsapp", {
        templateKey: "verify_bank",
        variables: { name: "subject.name", bank: "subject.bank_name" },
        category: "transactional",
      }),
      n("task", "create_task", {
        title: "Verify bank change — {{subject.name}}",
        type: "bank_verification",
        priority: "high",
        assignee: "subject.rm_id",
        slaAfter: { amount: 7, unit: "day" },
      }),
      n("end", "end", {}),
    ],
    edges: [e("e0", "trigger", "wa"), e("e1", "wa", "task"), e("e2", "task", "end")],
  }),
};
