import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

export const inactiveReactivationRecipe: RecipeDef = {
  key: "inactive_reactivation",
  name: "Inactive investor reactivation drip",
  description:
    "Monthly: investors with no transactions in 6 months and zero active SIPs enter a drip — D0 email, D3 WA, D10 RM task.",
  category: "retention",
  tags: ["inactive", "drip", "retention"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", { kind: "investor.dormant", subjectType: "investor" }),
      n("d0_email", "send_email", {
        templateKey: "inactive_d0",
        variables: { name: "subject.name" },
        category: "marketing",
      }),
      n("delay_3d", "delay", { duration: { amount: 3, unit: "day" } }),
      n("d3_wa", "send_whatsapp", {
        templateKey: "inactive_d3",
        variables: { name: "subject.name" },
        category: "marketing",
      }),
      n("delay_7d", "delay", { duration: { amount: 7, unit: "day" } }),
      n("d10_task", "create_task", {
        title: "Reactivation call — {{subject.name}}",
        type: "reactivation",
        priority: "normal",
        assignee: "subject.rm_id",
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "d0_email"),
      e("e1", "d0_email", "delay_3d"),
      e("e2", "delay_3d", "d3_wa"),
      e("e3", "d3_wa", "delay_7d"),
      e("e4", "delay_7d", "d10_task"),
      e("e5", "d10_task", "end"),
    ],
  }),
};
