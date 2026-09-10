import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

/**
 * Weekly Pending Task Report to Owner (M18 automation #3)
 *
 * Every Monday at 8:30 AM IST, the firm owner receives a roll-up of all
 * pending tasks across the team:
 *   - Open by department
 *   - Open by RM (top 5 backlog holders)
 *   - SLA-at-risk
 *   - Overdue (>24h)
 *   - Avg age of open tasks
 *   - Trend vs previous week
 *
 * Trigger: cron `30 8 * * 1` (Monday 8:30 IST).
 * Subject: the owner user (one run per tenant, addressed to the owner).
 */
export const taskWeeklyOwnerReportRecipe: RecipeDef = {
  key: "task_weekly_owner_report",
  name: "Weekly pending task report to owner",
  description:
    "Every Monday at 8:30 AM IST, email the owner a roll-up of pending tasks — by department, by RM, SLA-at-risk count, overdue count, and week-over-week trend.",
  category: "internal",
  tags: ["task", "owner", "report", "weekly"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", {}),

      // Pull the rolled-up metrics
      n("load_metrics", "http_request", {
        url: "{{system.api_base}}/internal/tasks-weekly-rollup",
        method: "POST",
        bodyTemplate: JSON.stringify({
          tenantId: "{{tenant.id}}",
          weekStart: "{{system.last_monday}}",
        }),
        storeResultAs: "metrics",
      }),

      // Compose a natural-language briefing
      n("compose", "ai_compose", {
        prompt:
          "Write a concise weekly task-pipeline briefing for the firm owner. " +
          "Cover: total open tasks, by department, top-3 RMs with backlog, SLA-at-risk count, " +
          "overdue count, week-on-week change, and 2-3 recommended actions. " +
          "Keep under 220 words. Use bullet points with bold labels.",
        storeAs: "briefing",
        context: ["vars.metrics"],
        maxTokens: 700,
      }),

      // Email the owner using the new Email Designer body
      n("send_email", "send_email", {
        templateKey: "task_weekly_owner_email",
        variables: {
          owner_name: "subject.name",
          briefing: "vars.briefing",
          open_total: "vars.metrics.open_total",
          overdue: "vars.metrics.overdue_count",
          sla_at_risk: "vars.metrics.sla_at_risk",
          completed_last_week: "vars.metrics.completed_last_week",
          dashboard_url: "system.dashboard_url",
          week_start: "vars.metrics.week_start",
          week_end: "vars.metrics.week_end",
        },
        category: "transactional",
        recipient: { source: "subject", value: "email" },
      }),

      // Also drop an in-app notification for the owner so they see it in the bell
      n("notify_owner", "create_notification", {
        kind: "task.weekly_report",
        severity: "info",
        title: "Weekly task report — {{vars.metrics.week_start}}",
        body:
          "{{vars.metrics.open_total}} open · {{vars.metrics.overdue_count}} overdue · " +
          "{{vars.metrics.sla_at_risk}} SLA-at-risk. Click to view.",
        linkUrl: "/dashboard/tasks",
        audience: { users: [], roles: ["owner", "branch_head"], subjectRm: false },
      }),

      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "load_metrics"),
      e("e1", "load_metrics", "compose"),
      e("e2", "compose", "send_email"),
      e("e3", "send_email", "notify_owner"),
      e("e4", "notify_owner", "end"),
    ],
  }),
  defaultTemplates: [
    {
      key: "task_weekly_owner_email",
      channel: "email",
      name: "Weekly task report — owner",
      category: "transactional",
      body: {
        mode: "designer",
        subject: "Weekly task report · {{open_total}} open ({{overdue}} overdue)",
        preheader: "{{week_start}} – {{week_end}} · {{overdue}} overdue · {{sla_at_risk}} SLA-at-risk",
        theme: {
          brandColor: "#d22e32",
          accentColor: "#841f21",
          pageBackground: "#f5f7fb",
          cardBackground: "#ffffff",
          textColor: "#111827",
          mutedColor: "#6b7280",
          fontFamily: "modern",
          baseFontSize: 15,
          containerWidth: 640,
          cornerRadius: 14,
          logoHeight: 44,
          logoAlign: "center",
        },
        blocks: [
          { id: "b1", type: "logo" },
          {
            id: "b2",
            type: "hero",
            title: "Weekly task report",
            subtitle: "Hi {{owner_name}}, here's how your team's task pipeline looks this week.",
            imageUrl: "",
            imageAlt: "",
            align: "center",
          },
          {
            id: "b3",
            type: "data_table",
            caption: "{{week_start}} – {{week_end}}",
            rows: [
              { label: "Total open tasks", value: "{{open_total}}" },
              { label: "Overdue", value: "{{overdue}}" },
              { label: "SLA at risk (<24h to deadline)", value: "{{sla_at_risk}}" },
              { label: "Completed last week", value: "{{completed_last_week}}" },
            ],
          },
          { id: "b4", type: "heading", text: "Owner briefing", level: "h2", align: "left" },
          { id: "b5", type: "text", html: "{{briefing}}", align: "left" },
          { id: "b6", type: "divider", thickness: 1, color: "#e5e7eb" },
          {
            id: "b7",
            type: "button",
            label: "Open task dashboard",
            url: "{{dashboard_url}}",
            align: "center",
            style: "solid",
            fullWidth: false,
          },
          { id: "b8", type: "spacer", height: 12 },
          {
            id: "b9",
            type: "text",
            html:
              "Need a different cadence or scope? <a href='/dashboard/workflows/rules'>Edit this rule</a> " +
              "to change the schedule, recipients, or content.",
            align: "left",
          },
        ],
        footer: { includeArn: true, includeAddress: true, includeUnsubscribe: false },
      },
      variables: [
        { key: "owner_name", type: "string", source: "subject.name", required: true },
        { key: "briefing", type: "string", source: "vars.briefing", required: true },
        { key: "open_total", type: "number", source: "vars.metrics.open_total", required: false, fallback: 0 },
        { key: "overdue", type: "number", source: "vars.metrics.overdue_count", required: false, fallback: 0 },
        { key: "sla_at_risk", type: "number", source: "vars.metrics.sla_at_risk", required: false, fallback: 0 },
        { key: "completed_last_week", type: "number", source: "vars.metrics.completed_last_week", required: false, fallback: 0 },
        { key: "week_start", type: "string", source: "vars.metrics.week_start", required: false },
        { key: "week_end", type: "string", source: "vars.metrics.week_end", required: false },
        { key: "dashboard_url", type: "url", source: "system.dashboard_url", required: false, fallback: "/dashboard/tasks" },
      ],
    },
  ],
};
