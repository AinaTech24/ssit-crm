import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

export const complaintSlaRecipe: RecipeDef = {
  key: "complaint_sla_breach",
  name: "Complaint SLA breach escalation",
  description: "When a complaint's SLA due is within 24h and not resolved, alert compliance. If breached, alert owner.",
  category: "compliance",
  tags: ["complaint", "sla"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", {}),
      n("alert_compliance", "raise_alert", {
        severity: "warning",
        title: "Complaint SLA at risk: {{event.ticket_no}}",
        audience: { roles: ["compliance"], users: [] },
        channels: ["inapp", "email"],
      }),
      n("delay", "delay", { duration: { amount: 24, unit: "hour" } }),
      n("alert_owner", "raise_alert", {
        severity: "critical",
        title: "Complaint SLA BREACHED: {{event.ticket_no}}",
        audience: { roles: ["owner", "compliance"], users: [] },
        channels: ["inapp", "email", "whatsapp"],
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "alert_compliance"),
      e("e1", "alert_compliance", "delay"),
      e("e2", "delay", "alert_owner"),
      e("e3", "alert_owner", "end"),
    ],
  }),
};
