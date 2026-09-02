import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

/**
 * Low-CSAT service recovery. A poor rating on a service request is an early
 * churn signal — escalate it immediately: alert the branch head, task an urgent
 * recovery call, and send the client a sincere acknowledgement.
 */
export const lowCsatRecoveryRecipe: RecipeDef = {
  key: "low_csat_recovery",
  name: "Low CSAT → service recovery",
  description:
    "When a client gives a low satisfaction rating on a service request, alert the branch head, create an urgent recovery-call task, and send an acknowledgement.",
  category: "service",
  tags: ["csat", "service-recovery", "retention", "escalation"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", { kind: "service_request.csat_low", subjectType: "investor" }),
      n("alert_head", "raise_alert", {
        severity: "warning",
        title: "Low CSAT from {{subject.name}}",
        body: "{{subject.name}} rated a recent service interaction poorly. Personal follow-up needed to recover the relationship.",
        audience: { roles: ["branch_head", "owner"], users: [] },
        channels: ["inapp"],
      }),
      n("task_recover", "create_task", {
        title: "Recovery call: {{subject.name}} (low CSAT)",
        description: "Call the client, understand what went wrong, and make it right. Log the outcome.",
        type: "follow_up",
        priority: "urgent",
        assignee: "subject.rm_id",
        dueAfter: { amount: 4, unit: "hour" },
        slaAfter: { amount: 1, unit: "day" },
      }),
      n("ack", "send_whatsapp", {
        templateKey: "csat_recovery_wa",
        variables: { name: "subject.name" },
        category: "utility",
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "alert_head"),
      e("e1", "alert_head", "task_recover"),
      e("e2", "task_recover", "ack"),
      e("e3", "ack", "end"),
    ],
  }),
  defaultTemplates: [
    {
      key: "csat_recovery_wa",
      channel: "whatsapp",
      name: "Low-CSAT acknowledgement",
      category: "utility",
      body: {
        body: {
          text:
            "Hi {{name}}, we're sorry your recent experience didn't meet expectations. Your feedback matters to us — " +
            "your advisor will call you shortly to understand and resolve this. Thank you for helping us do better.",
        },
      },
      variables: [{ key: "name", type: "string", source: "subject.name", required: true }],
    },
  ],
};
