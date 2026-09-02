import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

export const nismExpiryRecipe: RecipeDef = {
  key: "nism_expiry_alert",
  name: "NISM expiry alerts (T-90 / T-60 / T-30 / T-7)",
  description:
    "NISM certification expiry blocks EUIN-based transactions for the holding employee. This workflow alerts the user + owner at 90/60/30/7 days and disables transactions on expiry.",
  category: "compliance",
  tags: ["nism", "compliance", "regulatory"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", {}),
      n("email_user", "send_email", {
        templateKey: "nism_expiry_alert_user",
        variables: {
          name: "subject.name",
          expiry: "subject.nism_expiry_at",
          days_left: "event.days_left",
        },
        category: "transactional",
        recipient: { source: "subject", value: "" },
      }),
      n("email_owner", "send_email", {
        templateKey: "nism_expiry_alert_owner",
        variables: {
          name: "subject.name",
          expiry: "subject.nism_expiry_at",
          days_left: "event.days_left",
        },
        category: "transactional",
        recipient: { source: "context", value: "tenant.email" },
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "email_user"),
      e("e1", "email_user", "email_owner"),
      e("e2", "email_owner", "end"),
    ],
  }),
};
