import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

export const employeeExitRecipe: RecipeDef = {
  key: "employee_exit",
  name: "Employee offboarding",
  description:
    "When user.status='offboarding': revoke EUIN-based transaction rights, reassign investors round-robin, create handover task (7d SLA), log to compliance.",
  category: "internal",
  tags: ["offboarding", "employee", "compliance"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", {}),
      n("revoke", "update_field", { target: "subject", updates: { status: "offboarded" } }),
      n("alert_compliance", "raise_alert", {
        severity: "warning",
        title: "Employee exit: {{subject.name}}",
        body: "Reassign their {{event.investor_count}} investors. Handover task created.",
        audience: { roles: ["compliance", "owner"], users: [] },
        channels: ["inapp", "email"],
      }),
      n("task", "create_task", {
        title: "Reassign and handover investors of {{subject.name}}",
        type: "employee_handover",
        priority: "high",
        assignee: "branch_head",
        slaAfter: { amount: 7, unit: "day" },
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "revoke"),
      e("e1", "revoke", "alert_compliance"),
      e("e2", "alert_compliance", "task"),
      e("e3", "task", "end"),
    ],
  }),
};
