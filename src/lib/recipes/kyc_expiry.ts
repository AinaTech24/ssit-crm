import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

export const kycExpiryRecipe: RecipeDef = {
  key: "kyc_expiry_renew",
  name: "KYC expiry / re-KYC",
  description:
    "Schedule daily. For investors whose CKYC has expired or expires within 30 days, send WA + email and create an ops task. If no response in 14 days, escalate.",
  category: "compliance",
  tags: ["kyc", "compliance"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", { kind: "investor.kyc_expiring", subjectType: "investor" }),
      n("wa", "send_whatsapp", {
        templateKey: "kyc_renew",
        variables: { name: "subject.name", expiry: "subject.ckyc_expiry_at" },
        category: "transactional",
      }),
      n("email", "send_email", {
        templateKey: "kyc_renew_email",
        variables: { name: "subject.name", expiry: "subject.ckyc_expiry_at" },
        category: "transactional",
      }),
      n("task", "create_task", {
        title: "Collect re-KYC for {{subject.name}}",
        type: "kyc_renewal",
        priority: "high",
        assignee: "subject.rm_id",
        dueAfter: { amount: 14, unit: "day" },
      }),
      n("delay", "delay", { duration: { amount: 14, unit: "day" } }),
      n("escalate", "raise_alert", {
        severity: "warning",
        title: "Re-KYC pending: {{subject.name}}",
        audience: { roles: ["branch_head", "compliance"], users: [] },
        channels: ["inapp"],
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "wa"),
      e("e1", "wa", "email"),
      e("e2", "email", "task"),
      e("e3", "task", "delay"),
      e("e4", "delay", "escalate"),
      e("e5", "escalate", "end"),
    ],
  }),
};
