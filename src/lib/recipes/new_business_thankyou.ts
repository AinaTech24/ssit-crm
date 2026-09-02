import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

/**
 * New business logged → thank-you + internal note. When a new business entry is
 * recorded against a client, send a brief thank-you and notify the RM so the
 * relationship moment isn't lost in the back-office.
 */
export const newBusinessThankYouRecipe: RecipeDef = {
  key: "new_business_thankyou",
  name: "New business logged → thank-you",
  description:
    "When new business is recorded for a client, send a thank-you message and notify the owning RM.",
  category: "engagement",
  tags: ["business", "thank-you", "relationship"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", { kind: "business_entry.created", subjectType: "investor" }),
      n("thanks", "send_whatsapp", {
        templateKey: "new_business_thanks_wa",
        variables: { name: "subject.name" },
        category: "utility",
      }),
      n("notify_rm", "create_notification", {
        kind: "business.created",
        title: "New business from {{subject.name}}",
        body: "New business was logged for {{subject.name}}. Nice work — consider a thank-you call.",
        linkUrl: "/dashboard/finances",
        severity: "success",
        audience: { roles: [], users: [], subjectRm: true },
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "thanks"),
      e("e1", "thanks", "notify_rm"),
      e("e2", "notify_rm", "end"),
    ],
  }),
  defaultTemplates: [
    {
      key: "new_business_thanks_wa",
      channel: "whatsapp",
      name: "New business thank-you",
      category: "utility",
      body: {
        body: {
          text:
            "Thank you for your continued trust, {{name}} 🙏 We truly value the opportunity to help grow and protect your wealth. " +
            "As always, we're just a message away.",
        },
      },
      variables: [{ key: "name", type: "string", source: "subject.name", required: true }],
    },
  ],
};
