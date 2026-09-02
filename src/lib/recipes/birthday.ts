import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

export const birthdayRecipe: RecipeDef = {
  key: "birthday_touchpoint",
  name: "Birthday touchpoint",
  description: "On an investor's birthday, send a warm WA wish + create RM task for a personal call.",
  category: "service",
  tags: ["birthday", "engagement"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", { kind: "investor.birthday", subjectType: "investor" }),
      n("wa", "send_whatsapp", {
        templateKey: "happy_birthday",
        variables: { name: "subject.name" },
        category: "utility",
      }),
      n("task", "create_task", {
        title: "Birthday call: {{subject.name}}",
        type: "engagement",
        priority: "normal",
        assignee: "subject.rm_id",
        dueAfter: { amount: 1, unit: "day" },
      }),
      n("end", "end", {}),
    ],
    edges: [e("e0", "trigger", "wa"), e("e1", "wa", "task"), e("e2", "task", "end")],
  }),
};
