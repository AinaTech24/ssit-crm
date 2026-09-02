import { e, graph, n, and, p } from "./_helpers";
import type { RecipeDef } from ".";

export const sipRejectionFollowupRecipe: RecipeDef = {
  key: "sip_rejection_followup",
  name: "SIP rejection follow-up",
  description:
    "When a SIP transaction is rejected, classify the reason and trigger the right follow-up: WhatsApp + email to the investor, RM task, and retry logic for mandate failures.",
  category: "operations",
  tags: ["sip", "rejection", "retention", "recovery"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", { kind: "transaction.failed.sip_rejection", subjectType: "investor" }),
      n("branch", "branch", {
        cases: [
          {
            label: "Insufficient balance",
            criteria: and(p("event.reason_code", "eq", "insufficient_balance")),
          },
          {
            label: "Mandate expired",
            criteria: and(p("event.reason_code", "eq", "mandate_expired")),
          },
          {
            label: "Technical reject",
            criteria: and(p("event.reason_code", "in", ["technical", "system_error"])),
          },
        ],
      }),
      n("send_wa_balance", "send_whatsapp", {
        templateKey: "sip_rejection_low_balance",
        variables: {
          name: "subject.name",
          scheme: "event.scheme_name",
          amount: "event.amount",
          date: "event.order_date",
        },
        category: "transactional",
      }),
      n("task_balance", "create_task", {
        title: "Confirm available balance with {{subject.name}} and re-trigger SIP",
        type: "sip_retry",
        priority: "high",
        assignee: "subject.rm_id",
        dueAfter: { amount: 2, unit: "day" },
      }),
      n("send_wa_mandate", "send_whatsapp", {
        templateKey: "sip_rejection_mandate_expired",
        variables: { name: "subject.name", scheme: "event.scheme_name" },
        category: "transactional",
      }),
      n("send_email_mandate", "send_email", {
        templateKey: "sip_rejection_mandate_expired_email",
        variables: { name: "subject.name", scheme: "event.scheme_name" },
        category: "transactional",
      }),
      n("task_mandate", "create_task", {
        title: "New NACH mandate required for {{subject.name}}",
        type: "mandate_renewal",
        priority: "high",
        assignee: "subject.rm_id",
        dueAfter: { amount: 1, unit: "day" },
      }),
      n("alert_tech", "raise_alert", {
        severity: "warning",
        title: "Technical SIP rejection: {{subject.name}}",
        body: "Investor {{subject.name}} — scheme {{event.scheme_name}} rejected with technical code {{event.reason_code}}. Auto-retry queued for next cycle.",
        audience: { roles: ["ops"], users: [] },
        channels: ["inapp"],
      }),
      n("task_default", "create_task", {
        title: "Investigate SIP rejection for {{subject.name}}",
        type: "sip_review",
        priority: "normal",
        assignee: "subject.rm_id",
        dueAfter: { amount: 1, unit: "day" },
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "branch"),
      e("e1", "branch", "send_wa_balance", "case_0"),
      e("e2", "send_wa_balance", "task_balance"),
      e("e3", "task_balance", "end"),
      e("e4", "branch", "send_wa_mandate", "case_1"),
      e("e5", "send_wa_mandate", "send_email_mandate"),
      e("e6", "send_email_mandate", "task_mandate"),
      e("e7", "task_mandate", "end"),
      e("e8", "branch", "alert_tech", "case_2"),
      e("e9", "alert_tech", "end"),
      e("e10", "branch", "task_default", "default"),
      e("e11", "task_default", "end"),
    ],
  }),
  defaultTemplates: [
    {
      key: "sip_rejection_low_balance",
      channel: "whatsapp",
      name: "SIP rejection — low balance",
      category: "transactional",
      body: {
        body: {
          text:
            "Hi {{name}}, your SIP for {{scheme}} of ₹{{amount}} on {{date}} did not go through due to low account balance. " +
            "Please ensure sufficient balance to retry the next installment. We'll reach out shortly.",
        },
      },
      variables: [
        { key: "name", type: "string", source: "subject.name", required: true },
        { key: "scheme", type: "string", source: "event.scheme_name", required: true },
        { key: "amount", type: "currency", source: "event.amount", required: true },
        { key: "date", type: "date", source: "event.order_date", required: true, format: "dd MMM yyyy" },
      ],
    },
    {
      key: "sip_rejection_mandate_expired",
      channel: "whatsapp",
      name: "SIP rejection — mandate expired",
      category: "transactional",
      body: {
        body: {
          text:
            "Hi {{name}}, your SIP for {{scheme}} was rejected because your NACH mandate has expired. " +
            "We'll send a new mandate form for your signature shortly. No action needed right now.",
        },
      },
      variables: [
        { key: "name", type: "string", source: "subject.name", required: true },
        { key: "scheme", type: "string", source: "event.scheme_name", required: true },
      ],
    },
  ],
};
