import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

/**
 * Service-Request Escalation — spec § Module 13 Automation 3.
 *
 * Daily scan. For service requests where:
 *   - status NOT IN ('resolved','closed')
 *   - sla_resolution_at < now() — i.e. TAT breached
 *   - escalated_at IS NULL — not already escalated
 *
 * The recipe:
 *   1. Updates the ticket status → 'escalated'; stamps escalated_at.
 *   2. Creates an in-app notification for owner + back_office roles.
 *   3. Sends a WhatsApp / email to the firm owner with the ticket link.
 *   4. Optional: creates a high-priority task for the owner to intervene.
 *
 * Pairs with the existing `complaint_sla` recipe (complaint-specific) — this
 * one covers all 13 service types from the spec.
 */
export const serviceRequestEscalationRecipe: RecipeDef = {
  key: "service_request_escalation",
  name: "Service Request — escalate to owner on TAT breach",
  description:
    "Daily scan. Any open service request whose expected closure date has passed gets escalated to " +
    "the firm owner — in-app alert + task + WhatsApp + email.",
  category: "service",
  tags: ["service_request", "sla", "escalation", "tat"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", {}),
      n("flag", "update_field", {
        target: "subject",
        updates: {
          status: "escalated",
          escalated_at: "now()",
        },
      }),
      n("notify_owner", "create_notification", {
        kind: "service_request.escalated",
        title: "SR escalation: {{subject.ticket_no}} — {{subject.type}}",
        body: "TAT breached. Original SLA: {{subject.sla_resolution_at}}. Investor: {{subject.investor_name}}.",
        linkUrl: "/dashboard/service-requests",
        severity: "critical",
        audience: { roles: ["owner", "branch_head"], users: [], subjectRm: false },
      }),
      n("notify_assignee", "create_notification", {
        kind: "service_request.escalated",
        title: "Your SR has been escalated: {{subject.ticket_no}}",
        body: "Owner has been notified. Please action this ticket immediately.",
        linkUrl: "/dashboard/service-requests",
        severity: "warning",
        audience: { roles: [], users: ["subject.assigned_to_user_id"] },
      }),
      n("owner_task", "create_task", {
        title: "Resolve escalated SR {{subject.ticket_no}}",
        description: "TAT breached. Investor: {{subject.investor_name}}. Type: {{subject.type}}.",
        type: "service_request_escalation",
        priority: "urgent",
        assignee: "fixed:owner_role", // create_task handler resolves "owner_role" via RBAC
        dueAfter: { amount: 1, unit: "day" },
        slaAfter: { amount: 1, unit: "day" },
      }),
      n("wa", "send_whatsapp", {
        templateKey: "sr_escalation_owner",
        variables: {
          name: "subject.investor_name",
          ticket: "subject.ticket_no",
          type: "subject.type",
        },
        category: "transactional",
      }),
      n("email", "send_email", {
        templateKey: "sr_escalation_owner_email",
        variables: {
          name: "subject.investor_name",
          ticket: "subject.ticket_no",
          type: "subject.type",
          sla: "subject.sla_resolution_at",
        },
        category: "transactional",
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "flag"),
      e("e1", "flag", "notify_owner"),
      e("e2", "notify_owner", "notify_assignee"),
      e("e3", "notify_assignee", "owner_task"),
      e("e4", "owner_task", "wa"),
      e("e5", "wa", "email"),
      e("e6", "email", "end"),
    ],
  }),
  defaultTemplates: [
    {
      key: "sr_escalation_owner",
      channel: "whatsapp",
      category: "transactional",
      name: "SR escalation — Owner WA",
      body: {
        type: "wa_template",
        text:
          "Service Request {{ticket}} ({{type}}) for {{name}} has breached its TAT and is now escalated. " +
          "Please review on the dashboard.",
      },
      variables: [
        { key: "ticket", required: true },
        { key: "type", required: true },
        { key: "name", required: true },
      ],
    },
    {
      key: "sr_escalation_owner_email",
      channel: "email",
      category: "transactional",
      name: "SR escalation — Owner Email",
      body: {
        type: "email",
        subject: "Escalated: Service Request {{ticket}} — TAT breached",
        text:
          "A service request has breached its TAT and is now escalated to you.\n\n" +
          "Ticket: {{ticket}}\nClient: {{name}}\nType: {{type}}\nOriginal SLA: {{sla}}\n\n" +
          "Please review and intervene on the dashboard.",
      },
      variables: [
        { key: "ticket", required: true },
        { key: "name", required: true },
        { key: "type", required: true },
        { key: "sla", required: true },
      ],
    },
  ],
};
