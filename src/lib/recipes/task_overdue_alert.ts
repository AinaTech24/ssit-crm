import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

/**
 * Task Overdue Alert (M18 automation #1)
 *
 * Triggered when a task crosses its `due_at` and is still `open`.
 *
 * Flow:
 *   1. Notify the assignee (in-app + WhatsApp) immediately.
 *   2. Wait 24 hours.
 *   3. If still not done (handled by re-check at firing time), escalate to the
 *      assignee's RM/owner via in-app alert + email.
 *
 * The trigger fires whenever an event of kind `task.overdue` lands in
 * events_outbox — emitted by workers/task-reminder-scanner.ts, which sweeps
 * `tasks WHERE due_at < now() AND status IN ('open','in_progress','blocked')`
 * (deduped via tasks.overdue_notified_at) every 5 minutes. That scanner also
 * posts a guaranteed in-app alert to the assignee, so overdue surfacing works
 * even when this escalation recipe isn't installed.
 */
export const taskOverdueAlertRecipe: RecipeDef = {
  key: "task_overdue_alert",
  name: "Overdue task alert",
  description:
    "When an open task crosses its due date, notify the assignee immediately. After 24 hours with no completion, escalate to their RM / owner.",
  category: "operations",
  tags: ["task", "sla", "escalation", "overdue"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", {}),

      // 1. Notify the assignee in-app right away
      n("notify_assignee", "create_notification", {
        kind: "task.overdue",
        severity: "warning",
        title: "Task overdue: {{event.title}}",
        body:
          "Your task '{{event.title}}' was due on {{event.due_at}} and is still open. " +
          "Please action it or reschedule.",
        linkUrl: "/dashboard/tasks?status=open",
        audience: { users: ["event.assignee_id"], roles: [], subjectRm: false },
      }),

      // 2. WhatsApp ping to the assignee (utility category)
      n("wa_assignee", "send_whatsapp", {
        templateKey: "task_overdue_assignee",
        variables: {
          title: "event.title",
          due_at: "event.due_at",
          priority: "event.priority",
          link: "system.dashboard_url",
        },
        category: "utility",
        recipient: { source: "context", value: "event.assignee_phone" },
      }),

      // 3. Wait 24 hours, then escalate if still open
      n("delay_24h", "delay", { duration: { amount: 24, unit: "hour" } }),

      n("alert_rm", "raise_alert", {
        severity: "warning",
        title: "Task still overdue (24h+): {{event.title}}",
        body:
          "Task '{{event.title}}' assigned to {{event.assignee_name}} has been overdue " +
          "for more than 24 hours. Please review.",
        audience: { roles: ["owner", "branch_head"], users: ["event.assignee_rm_id"] },
        channels: ["inapp", "email"],
      }),

      // Also notify the owner in-app
      n("notify_owner", "create_notification", {
        kind: "task.overdue.escalated",
        severity: "critical",
        title: "Escalation: overdue task '{{event.title}}'",
        body:
          "{{event.assignee_name}} has not completed task '{{event.title}}' which was " +
          "due on {{event.due_at}}. 24h escalation window passed.",
        linkUrl: "/dashboard/tasks?priority=urgent,high&status=open",
        audience: { users: [], roles: ["owner", "branch_head"], subjectRm: true },
      }),

      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "notify_assignee"),
      e("e1", "notify_assignee", "wa_assignee"),
      e("e2", "wa_assignee", "delay_24h"),
      e("e3", "delay_24h", "alert_rm"),
      e("e4", "alert_rm", "notify_owner"),
      e("e5", "notify_owner", "end"),
    ],
  }),
  defaultTemplates: [
    {
      key: "task_overdue_assignee",
      channel: "whatsapp",
      name: "Task overdue — assignee ping",
      category: "transactional",
      body: {
        body: {
          text:
            "⏰ Your task is overdue\n\n" +
            "*{{title}}*\n" +
            "Priority: {{priority}}\n" +
            "Was due: {{due_at}}\n\n" +
            "Action it now or reschedule: {{link}}",
        },
      },
      variables: [
        { key: "title", type: "string", source: "event.title", required: true },
        { key: "due_at", type: "date", source: "event.due_at", required: true, format: "dd MMM yyyy" },
        { key: "priority", type: "string", source: "event.priority", required: false, fallback: "normal" },
        { key: "link", type: "url", source: "system.dashboard_url", required: false, fallback: "/dashboard/tasks" },
      ],
    },
  ],
};
