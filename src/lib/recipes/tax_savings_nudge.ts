import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

/**
 * CS6 — tax-savings opportunity as a client moment. Fires on the scanner's
 * `tax.harvest_opportunity` event (Jan–Mar FY-closing window, once per client
 * per year). Prompts an RM-led tax-harvesting / 80C conversation before March.
 */
export const taxSavingsNudgeRecipe: RecipeDef = {
  key: "tax_savings_nudge",
  name: "Tax savings — year-end opportunity",
  description:
    "In the Jan–Mar window, nudge clients to review tax-harvesting and 80C headroom before the financial year closes, with an RM follow-up task.",
  category: "relationship",
  tags: ["tax", "advice", "fy-end"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", { kind: "tax.harvest_opportunity", subjectType: "investor" }),
      n("wa", "send_whatsapp", {
        templateKey: "tax_savings_year_end",
        variables: { name: "subject.name" },
        category: "marketing",
      }),
      n("task", "create_task", {
        title: "Year-end tax review with {{subject.name}} (harvesting / 80C)",
        type: "advisory",
        priority: "high",
        assignee: "subject.rm_id",
        dueAfter: { amount: 7, unit: "day" },
      }),
      n("end", "end", {}),
    ],
    edges: [e("e0", "trigger", "wa"), e("e1", "wa", "task"), e("e2", "task", "end")],
  }),
};
