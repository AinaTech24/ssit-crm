import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

export const minorToMajorRecipe: RecipeDef = {
  key: "minor_to_major_transition",
  name: "Minor → Major transition",
  description:
    "On 18th birthday of a minor investor, create onboarding task + notify guardian + sticky alert until folio transitioned.",
  category: "operations",
  tags: ["minor", "lifecycle", "kyc"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", { kind: "investor.minor_to_major", subjectType: "investor" }),
      n("task", "create_task", {
        title: "Minor-to-major KYC + folio transition — {{subject.name}}",
        type: "minor_major_transition",
        priority: "high",
        assignee: "subject.rm_id",
        slaAfter: { amount: 30, unit: "day" },
      }),
      n("wa_guardian", "send_whatsapp", {
        templateKey: "minor_to_major_guardian",
        variables: { name: "subject.name" },
        category: "transactional",
        recipient: { source: "context", value: "subject.guardian_phone" },
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "task"),
      e("e1", "task", "wa_guardian"),
      e("e2", "wa_guardian", "end"),
    ],
  }),
};
