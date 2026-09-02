import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

/**
 * Daily Task Summary per Team Member (M18 automation #2)
 *
 * Schedule-driven: every weekday at 9:00 AM IST, each user with at least one
 * open task assigned to them gets a personalised digest by email + WhatsApp.
 *
 * The trigger node is bound to a `recurrence` workflow_trigger with cron
 * `0 9 * * 1-5` (Mon–Fri 9am IST). The master-scheduler worker fans out one
 * run per user with open tasks (subject_type='user', subject_id=user.id).
 *
 * AI compose generates the natural-language summary from the user's open
 * tasks list pulled into the run context.
 */
export const taskDailySummaryRecipe: RecipeDef = {
  key: "task_daily_summary",
  name: "Daily task summary per team member",
  description:
    "Every weekday at 9:00 AM IST, send each team member a digest of their open tasks for the day — overdue first, then due today, then upcoming.",
  category: "internal",
  tags: ["task", "digest", "team", "daily"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", {}),

      // Pull the user's open tasks into run context.
      n("load_tasks", "http_request", {
        url: "{{system.api_base}}/internal/tasks-for-user",
        method: "POST",
        bodyTemplate: JSON.stringify({
          userId: "{{subject.id}}",
          buckets: ["overdue", "due_today", "upcoming_7d"],
        }),
        storeResultAs: "tasks_payload",
      }),

      // Skip the rest of the workflow if the user has zero open tasks.
      n("check_has_tasks", "branch", {
        cases: [
          {
            label: "Has tasks",
            criteria: {
              type: "predicate",
              field: { kind: "attr", path: "vars.tasks_payload.total" },
              op: "gt",
              value: 0,
            },
          },
        ],
      }),

      // Compose a personalised summary
      n("compose", "ai_compose", {
        prompt:
          "Write a short, friendly daily task digest for {{subject.name}}. " +
          "Group by Overdue, Due today, Upcoming this week. Highlight urgent/high-priority items. " +
          "Keep under 180 words. Use simple bullet points. End with a one-line motivational close.",
        storeAs: "summary",
        context: ["vars.tasks_payload"],
        maxTokens: 500,
      }),

      // Send email
      n("send_email", "send_email", {
        templateKey: "task_daily_summary_email",
        variables: {
          name: "subject.name",
          summary: "vars.summary",
          total: "vars.tasks_payload.total",
          overdue: "vars.tasks_payload.overdue_count",
          due_today: "vars.tasks_payload.due_today_count",
          dashboard_url: "system.dashboard_url",
        },
        category: "transactional",
        recipient: { source: "subject", value: "email" },
      }),

      // Send WhatsApp (utility — internal team comms)
      n("send_wa", "send_whatsapp", {
        templateKey: "task_daily_summary_wa",
        variables: {
          name: "subject.name",
          total: "vars.tasks_payload.total",
          overdue: "vars.tasks_payload.overdue_count",
          due_today: "vars.tasks_payload.due_today_count",
        },
        category: "utility",
        recipient: { source: "subject", value: "phone" },
      }),

      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "load_tasks"),
      e("e1", "load_tasks", "check_has_tasks"),
      e("e2", "check_has_tasks", "compose", "case_0"),
      e("e3", "check_has_tasks", "end", "default"),
      e("e4", "compose", "send_email"),
      e("e5", "send_email", "send_wa"),
      e("e6", "send_wa", "end"),
    ],
  }),
  defaultTemplates: [
    {
      key: "task_daily_summary_email",
      channel: "email",
      name: "Daily task summary — team",
      category: "transactional",
      body: {
        mode: "designer",
        subject: "Your tasks for today — {{total}} open ({{overdue}} overdue, {{due_today}} due today)",
        preheader: "{{overdue}} overdue · {{due_today}} due today",
        theme: {
          brandColor: "#0ea5e9",
          accentColor: "#0e2557",
          pageBackground: "#f5f7fb",
          cardBackground: "#ffffff",
          textColor: "#111827",
          mutedColor: "#6b7280",
          fontFamily: "sans",
          baseFontSize: 15,
          containerWidth: 600,
          cornerRadius: 12,
          logoHeight: 40,
          logoAlign: "center",
        },
        blocks: [
          { id: "b1", type: "logo" },
          {
            id: "b2",
            type: "hero",
            title: "Good morning, {{name}} 👋",
            subtitle: "Here's what's on your plate today.",
            imageUrl: "",
            imageAlt: "",
            align: "center",
          },
          {
            id: "b3",
            type: "data_table",
            caption: "Today at a glance",
            rows: [
              { label: "Overdue", value: "{{overdue}}" },
              { label: "Due today", value: "{{due_today}}" },
              { label: "Total open", value: "{{total}}" },
            ],
          },
          { id: "b4", type: "heading", text: "Your summary", level: "h2", align: "left" },
          { id: "b5", type: "text", html: "{{summary}}", align: "left" },
          {
            id: "b6",
            type: "button",
            label: "Open my task list",
            url: "{{dashboard_url}}",
            align: "center",
            style: "solid",
            fullWidth: false,
          },
        ],
        footer: { includeArn: true, includeAddress: true, includeUnsubscribe: false },
      },
      variables: [
        { key: "name", type: "string", source: "subject.name", required: true },
        { key: "summary", type: "string", source: "vars.summary", required: true },
        { key: "total", type: "number", source: "vars.tasks_payload.total", required: false, fallback: 0 },
        { key: "overdue", type: "number", source: "vars.tasks_payload.overdue_count", required: false, fallback: 0 },
        { key: "due_today", type: "number", source: "vars.tasks_payload.due_today_count", required: false, fallback: 0 },
        { key: "dashboard_url", type: "url", source: "system.dashboard_url", required: false, fallback: "/dashboard/tasks" },
      ],
    },
    {
      key: "task_daily_summary_wa",
      channel: "whatsapp",
      name: "Daily task summary — team (WA)",
      category: "utility",
      body: {
        body: {
          text:
            "Good morning {{name}} 👋\n\n" +
            "*Your tasks today*\n" +
            "🔴 Overdue: {{overdue}}\n" +
            "🟠 Due today: {{due_today}}\n" +
            "📋 Total open: {{total}}\n\n" +
            "Open dashboard → /dashboard/tasks",
        },
      },
      variables: [
        { key: "name", type: "string", source: "subject.name", required: true },
        { key: "total", type: "number", source: "vars.tasks_payload.total", required: false, fallback: 0 },
        { key: "overdue", type: "number", source: "vars.tasks_payload.overdue_count", required: false, fallback: 0 },
        { key: "due_today", type: "number", source: "vars.tasks_payload.due_today_count", required: false, fallback: 0 },
      ],
    },
  ],
};
