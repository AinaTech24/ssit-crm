import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

export const leadNurtureRecipe: RecipeDef = {
  key: "lead_nurture_drip",
  name: "Lead nurture drip (D0/D2/D5/D14/D30)",
  description:
    "For website/ads-sourced leads: D0 WA thanks, D2 email intro, D5 WA book-a-call, D14 RM nudge if not converted, D30 mark cold.",
  category: "marketing",
  tags: ["lead", "nurture", "drip"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", {}),
      n("d0", "send_whatsapp", {
        templateKey: "lead_thanks",
        variables: { name: "subject.name" },
        category: "transactional",
      }),
      n("delay_2", "delay", { duration: { amount: 2, unit: "day" } }),
      n("d2", "send_email", {
        templateKey: "lead_intro",
        variables: { name: "subject.name" },
        category: "marketing",
      }),
      n("delay_3", "delay", { duration: { amount: 3, unit: "day" } }),
      n("d5", "send_whatsapp", {
        templateKey: "lead_book_call",
        variables: { name: "subject.name" },
        category: "marketing",
      }),
      n("delay_9", "delay", { duration: { amount: 9, unit: "day" } }),
      n("d14_task", "create_task", {
        title: "Re-engage lead {{subject.name}}",
        type: "lead_followup",
        priority: "high",
        assignee: "subject.owner_id",
        subjectType: "lead",
      }),
      n("delay_16", "delay", { duration: { amount: 16, unit: "day" } }),
      n("d30_cold", "update_field", { target: "subject", updates: { stage: "cold" } }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "d0"),
      e("e1", "d0", "delay_2"),
      e("e2", "delay_2", "d2"),
      e("e3", "d2", "delay_3"),
      e("e4", "delay_3", "d5"),
      e("e5", "d5", "delay_9"),
      e("e6", "delay_9", "d14_task"),
      e("e7", "d14_task", "delay_16"),
      e("e8", "delay_16", "d30_cold"),
      e("e9", "d30_cold", "end"),
    ],
  }),
};
