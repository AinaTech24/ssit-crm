import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

/**
 * Insurance lapse recovery.
 *
 * The scanner emits `insurance.lapsed` once when an active policy passes its
 * grace period unpaid. Many insurers allow reinstatement within a window, so a
 * fast outreach can recover the cover (and the trail). This raises an internal
 * alert + RM task and gently nudges the client to discuss reinstatement.
 *
 * Subject is the investor; the event payload carries the lapsed policy details.
 */
export const insuranceLapseRecoveryRecipe: RecipeDef = {
  key: "insurance_lapse_recovery",
  name: "Insurance lapse recovery",
  description:
    "When a policy lapses past its grace period, alert the RM + raise an internal flag and message the client about reinstatement — most insurers allow a recovery window.",
  category: "retention",
  tags: ["insurance", "retention", "reinstatement"],
  defaultTemplates: [
    {
      key: "insurance_lapsed_wa",
      channel: "whatsapp",
      category: "transactional",
      name: "Insurance lapse — WhatsApp",
      body: {
        body: {
          text:
            "Hi {{name}}, it looks like the premium for your {{plan_name}} policy ({{insurer}}) " +
            "wasn't received and the policy has lapsed. The good news: most policies can be " +
            "reinstated within a short window. Can we connect this week to restore your cover?\n\n" +
            "Insurance is the subject matter of solicitation.\n— {{arn_name}}, ARN-{{arn_no}}",
        },
      },
      variables: [
        { key: "name", type: "string", source: "subject.name", required: true },
        { key: "plan_name", type: "string", source: "event.plan_name", required: true },
        { key: "insurer", type: "string", source: "event.insurer", required: false },
      ],
    },
  ],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", { kind: "insurance.lapsed", subjectType: "investor" }),
      n("task", "create_task", {
        title: "LAPSED — reinstate {{event.plan_name}} for {{subject.name}}",
        type: "insurance_lapse_recovery",
        priority: "urgent",
        assignee: "subject.rm_id",
        dueAfter: { amount: 1, unit: "day" },
      }),
      n("alert", "raise_alert", {
        severity: "warning",
        title: "Policy lapsed: {{subject.name}} · {{event.plan_name}}",
        audience: { roles: ["branch_head"], users: [] },
        channels: ["inapp"],
      }),
      n("wa", "send_whatsapp", {
        templateKey: "insurance_lapsed_wa",
        variables: {
          name: "subject.name",
          plan_name: "event.plan_name",
          insurer: "event.insurer",
        },
        category: "transactional",
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "task"),
      e("e1", "task", "alert"),
      e("e2", "alert", "wa"),
      e("e3", "wa", "end"),
    ],
  }),
};
