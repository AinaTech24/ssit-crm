import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

export const documentChaseRecipe: RecipeDef = {
  key: "document_chase",
  name: "Document chase — auto follow-ups",
  description:
    "When a 'collect_document' task is open >3 days, send a daily WA reminder (max 10). After 7 days, also email. After 10 days, escalate to branch head.",
  category: "operations",
  tags: ["document", "onboarding"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", {}),
      n("loop", "loop", { itemsExpression: "vars.reminders", maxIterations: 10, itemAlias: "i" }),
      n("wa", "send_whatsapp", {
        templateKey: "document_reminder",
        variables: { name: "subject.name", doc: "event.document_name" },
        category: "transactional",
      }),
      n("delay", "delay", { duration: { amount: 1, unit: "day" } }),
      n("email_d7", "send_email", {
        templateKey: "document_reminder_email",
        variables: { name: "subject.name", doc: "event.document_name" },
        category: "transactional",
      }),
      n("escalate", "raise_alert", {
        severity: "warning",
        title: "Document overdue: {{event.document_name}} for {{subject.name}}",
        audience: { roles: ["branch_head"], users: [] },
        channels: ["inapp"],
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "loop"),
      e("e1", "loop", "wa", "body"),
      e("e2", "wa", "delay"),
      e("e3", "delay", "loop"),
      e("e4", "loop", "email_d7", "done"),
      e("e5", "email_d7", "escalate"),
      e("e6", "escalate", "end"),
    ],
  }),
};
