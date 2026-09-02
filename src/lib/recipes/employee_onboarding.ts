import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

export const employeeOnboardingRecipe: RecipeDef = {
  key: "employee_onboarding",
  name: "New employee onboarding checklist",
  description: "Welcome email, KYC / NISM / SOP tasks, ping owner if not complete by Day 7.",
  category: "internal",
  tags: ["onboarding", "employee"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", {}),
      n("welcome", "send_email", {
        templateKey: "employee_welcome",
        variables: { name: "subject.name" },
        category: "transactional",
        recipient: { source: "subject" },
      }),
      n("task_nism", "create_task", {
        title: "Upload NISM certificate — {{subject.name}}",
        type: "compliance_upload",
        priority: "high",
        assignee: "fixed:{{subject.id}}",
        dueAfter: { amount: 7, unit: "day" },
      }),
      n("task_kyc", "create_task", {
        title: "Complete internal KYC — {{subject.name}}",
        type: "employee_kyc",
        priority: "high",
        assignee: "fixed:{{subject.id}}",
        dueAfter: { amount: 3, unit: "day" },
      }),
      n("task_sop", "create_task", {
        title: "Acknowledge core SOPs — {{subject.name}}",
        type: "sop_signoff",
        priority: "normal",
        assignee: "fixed:{{subject.id}}",
        dueAfter: { amount: 7, unit: "day" },
      }),
      n("delay", "delay", { duration: { amount: 7, unit: "day" } }),
      n("check_owner", "raise_alert", {
        severity: "info",
        title: "Day-7 onboarding check: {{subject.name}}",
        body: "Confirm NISM / KYC / SOP tasks are complete.",
        audience: { roles: ["owner"], users: [] },
        channels: ["inapp"],
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "welcome"),
      e("e1", "welcome", "task_nism"),
      e("e2", "task_nism", "task_kyc"),
      e("e3", "task_kyc", "task_sop"),
      e("e4", "task_sop", "delay"),
      e("e5", "delay", "check_owner"),
      e("e6", "check_owner", "end"),
    ],
  }),
};
