import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

/**
 * CS5 — celebrate a client crossing an AUM milestone (₹10L/₹25L/₹50L/₹1Cr/…).
 * Fires on the daily-ops-scanner's `investor.milestone.aum` event (once per
 * crossing). A warm, proactive "moment that matters" the client remembers.
 */
export const aumMilestoneRecipe: RecipeDef = {
  key: "aum_milestone_celebrate",
  name: "AUM milestone — congratulate the client",
  description:
    "When a client's portfolio crosses a wealth milestone (₹10L / ₹25L / ₹50L / ₹1Cr …), send a warm congratulations and log a relationship touch.",
  category: "relationship",
  tags: ["milestone", "delight", "retention"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", { kind: "investor.milestone.aum", subjectType: "investor" }),
      n("wa", "send_whatsapp", {
        templateKey: "aum_milestone_congrats",
        variables: { name: "subject.name", milestone: "event.after.band_label" },
        category: "marketing",
      }),
      n("task", "create_task", {
        title: "Congratulate {{subject.name}} — crossed {{event.after.band_label}}",
        type: "engagement",
        priority: "normal",
        assignee: "subject.rm_id",
        dueAfter: { amount: 2, unit: "day" },
      }),
      n("end", "end", {}),
    ],
    edges: [e("e0", "trigger", "wa"), e("e1", "wa", "task"), e("e2", "task", "end")],
  }),
};
