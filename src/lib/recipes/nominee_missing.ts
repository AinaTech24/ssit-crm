import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

export const nomineeMissingRecipe: RecipeDef = {
  key: "nominee_missing",
  name: "Nominee missing — AUM > ₹1L",
  description: "Weekly check. Investors with no nominee and AUM > ₹1L get a WA reminder + RM task.",
  category: "compliance",
  tags: ["nominee", "compliance"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", {}),
      n("wa", "send_whatsapp", {
        templateKey: "nomination_update",
        variables: { name: "subject.name" },
        category: "transactional",
      }),
      n("task", "create_task", {
        title: "Add nominee for {{subject.name}}",
        type: "nominee_update",
        priority: "normal",
        assignee: "subject.rm_id",
        dueAfter: { amount: 14, unit: "day" },
      }),
      n("end", "end", {}),
    ],
    edges: [e("e0", "trigger", "wa"), e("e1", "wa", "task"), e("e2", "task", "end")],
  }),
};
