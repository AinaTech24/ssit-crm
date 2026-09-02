import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

export const arnExpiryRecipe: RecipeDef = {
  key: "arn_expiry_alert",
  name: "ARN expiry alerts (T-120/90/60/30)",
  description:
    "ARN renewals lapse if missed — at which point all distribution activity stops. This alerts owner + compliance at progressive thresholds and surfaces a sticky banner at T-30.",
  category: "compliance",
  tags: ["arn", "compliance"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", {}),
      n("email_owner", "send_email", {
        templateKey: "arn_expiry_alert",
        variables: { days_left: "event.days_left", expires_at: "tenant.arn_expiry_at" },
        category: "transactional",
        recipient: { source: "fixed", value: "{{tenant.email}}" },
      }),
      n("alert", "raise_alert", {
        severity: "critical",
        title: "ARN expiring in {{event.days_left}} days",
        body: "Renew ARN {{tenant.arn}} by {{tenant.arn_expiry_at}}.",
        audience: { roles: ["owner", "compliance"], users: [] },
        channels: ["inapp", "email"],
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "email_owner"),
      e("e1", "email_owner", "alert"),
      e("e2", "alert", "end"),
    ],
  }),
};
