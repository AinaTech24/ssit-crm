import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

/**
 * CS6 — proactive protection-gap advice as a client moment. Fires on the
 * scanner's `insurance.protection_gap` event (a client with real AUM but no
 * active life cover; emitted at most ~quarterly per client). Turns an owner-side
 * radar into a caring client message + an RM follow-up task.
 */
export const protectionGapNudgeRecipe: RecipeDef = {
  key: "protection_gap_nudge",
  name: "Protection gap — proactive advice",
  description:
    "When a client has meaningful investments but no life cover on file, send a caring 'protect your family' nudge and create an RM task to discuss term cover.",
  category: "relationship",
  tags: ["insurance", "advice", "cross-sell"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", { kind: "insurance.protection_gap", subjectType: "investor" }),
      n("wa", "send_whatsapp", {
        templateKey: "protection_gap_advice",
        variables: { name: "subject.name", suggested_cover: "event.after.suggested_cover" },
        category: "marketing",
      }),
      n("task", "create_task", {
        title: "Discuss life cover with {{subject.name}} (protection gap)",
        type: "advisory",
        priority: "normal",
        assignee: "subject.rm_id",
        dueAfter: { amount: 5, unit: "day" },
      }),
      n("end", "end", {}),
    ],
    edges: [e("e0", "trigger", "wa"), e("e1", "wa", "task"), e("e2", "task", "end")],
  }),
};
