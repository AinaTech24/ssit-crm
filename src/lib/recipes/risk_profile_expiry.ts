import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

/**
 * Risk profile annual review reminder + expiry alert.
 *
 * Trigger: schedule_kind = daily; criteria selects investors whose
 *   risk_profile_signed_at is between 11 and 13 months old (warning window
 *   before expiry + the first 30 days after expiry for follow-up).
 *
 * Flow:
 *   1. WA + email reminder to the client that their risk profile expires
 *      and the RM will reach out.
 *   2. Create a task for the RM ("re-do risk profile") with 14-day SLA.
 *   3. After 14 days, escalate to compliance via in-app alert.
 */
export const riskProfileExpiryRecipe: RecipeDef = {
  key: "risk_profile_annual_review",
  name: "Risk profile — annual review",
  description:
    "Daily scan. When an investor's risk profile is approaching or past its 12-month mark, " +
    "alert the client + the RM, and escalate to compliance after 14 days.",
  category: "compliance",
  tags: ["risk_profile", "compliance", "annual_review"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", { kind: "investor.risk_profile_expired", subjectType: "investor" }),
      n("wa", "send_whatsapp", {
        templateKey: "risk_profile_renew",
        variables: {
          name: "subject.name",
          last_signed: "subject.risk_profile_signed_at",
        },
        category: "transactional",
      }),
      n("email", "send_email", {
        templateKey: "risk_profile_renew_email",
        variables: {
          name: "subject.name",
          last_signed: "subject.risk_profile_signed_at",
          current_category: "subject.risk_profile",
        },
        category: "transactional",
      }),
      n("notify_rm", "create_notification", {
        kind: "risk_profile.review_due",
        title: "Risk profile review due — {{subject.name}}",
        body: "Annual review window opened. Last signed {{subject.risk_profile_signed_at}}.",
        linkUrl: "/dashboard/risk-profiles/new?investorId={{subject.id}}",
        severity: "warning",
        audience: { roles: [], users: [], subjectRm: true },
      }),
      n("task", "create_task", {
        title: "Re-do risk profile for {{subject.name}}",
        type: "risk_profile_renewal",
        priority: "normal",
        assignee: "subject.rm_id",
        dueAfter: { amount: 14, unit: "day" },
        slaAfter: { amount: 14, unit: "day" },
      }),
      n("delay", "delay", { duration: { amount: 14, unit: "day" } }),
      n("escalate", "raise_alert", {
        severity: "warning",
        title: "Risk profile still pending: {{subject.name}}",
        body: "14 days since notice — escalating to compliance.",
        audience: { roles: ["compliance", "branch_head"], users: [] },
        channels: ["inapp"],
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "wa"),
      e("e1", "wa", "email"),
      e("e2", "email", "notify_rm"),
      e("e3", "notify_rm", "task"),
      e("e4", "task", "delay"),
      e("e5", "delay", "escalate"),
      e("e6", "escalate", "end"),
    ],
  }),
  defaultTemplates: [
    {
      key: "risk_profile_renew",
      channel: "whatsapp",
      category: "transactional",
      name: "Risk profile renewal — WA",
      body: {
        type: "wa_template",
        text:
          "Dear {{name}}, your risk profile was completed on {{last_signed}} and is due for the SEBI-mandated annual review. " +
          "Your RM will reach out to refresh it. Please respond when contacted.",
      },
      variables: [
        { key: "name", required: true },
        { key: "last_signed", required: true },
      ],
    },
    {
      key: "risk_profile_renew_email",
      channel: "email",
      category: "transactional",
      name: "Risk profile renewal — Email",
      body: {
        type: "email",
        subject: "Action needed: refresh your risk profile",
        text:
          "Hello {{name}},\n\nAs per SEBI guidelines, mutual fund investors must complete a risk-profile review " +
          "every 12 months. Your last risk profile (category: {{current_category}}) was completed on " +
          "{{last_signed}} and is now due.\n\n" +
          "Your relationship manager will set up a quick 10-minute call to refresh it.\n\nThanks.",
      },
      variables: [
        { key: "name", required: true },
        { key: "last_signed", required: true },
        { key: "current_category", required: false },
      ],
    },
  ],
};
