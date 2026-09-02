import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

/**
 * Insurance renewed → confirmation + protection review. Confirm the renewal so
 * the client has peace of mind, then task the RM to review whether their cover
 * is still adequate (a natural, low-pressure cross-sell moment).
 */
export const insuranceRenewedCrossSellRecipe: RecipeDef = {
  key: "insurance_renewed_crosssell",
  name: "Insurance renewed → confirm & protection review",
  description:
    "When a policy is renewed, send a confirmation and create an RM task to review the client's overall protection adequacy (term/health top-up opportunities).",
  category: "engagement",
  tags: ["insurance", "renewal", "cross-sell", "protection"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", { kind: "insurance.renewed", subjectType: "investor" }),
      n("confirm", "send_whatsapp", {
        templateKey: "insurance_renewed_wa",
        variables: { name: "subject.name", policy: "event.policy_name" },
        category: "utility",
      }),
      n("task_review", "create_task", {
        title: "Review protection adequacy for {{subject.name}} after renewal",
        description: "Check whether the client's life + health cover still matches their income and dependents. Flag any gap.",
        type: "follow_up",
        priority: "normal",
        assignee: "subject.rm_id",
        dueAfter: { amount: 5, unit: "day" },
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "confirm"),
      e("e1", "confirm", "task_review"),
      e("e2", "task_review", "end"),
    ],
  }),
  defaultTemplates: [
    {
      key: "insurance_renewed_wa",
      channel: "whatsapp",
      name: "Insurance renewal confirmation",
      category: "utility",
      body: {
        body: {
          text:
            "Hi {{name}}, your policy {{policy}} has been successfully renewed ✅ You're covered and protected. " +
            "Your advisor will also do a quick check to ensure your overall cover still fits your needs.",
        },
      },
      variables: [
        { key: "name", type: "string", source: "subject.name", required: true },
        { key: "policy", type: "string", source: "event.policy_name", required: false },
      ],
    },
  ],
};
