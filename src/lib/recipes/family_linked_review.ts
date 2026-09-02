import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

/**
 * Family linked → household review opportunity. When investors are grouped into
 * a family, there's a natural opening for a consolidated, household-level
 * financial review (goals, protection, succession). Task the RM to propose one.
 */
export const familyLinkedReviewRecipe: RecipeDef = {
  key: "family_linked_review",
  name: "Family linked → propose a household review",
  description:
    "When an investor is linked into a family group, create an RM task to offer a consolidated household financial review (goals, protection, nomination).",
  category: "sales",
  tags: ["family", "household", "review", "cross-sell"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", { kind: "investor.family_linked", subjectType: "investor" }),
      n("notify_rm", "create_notification", {
        kind: "family.linked",
        title: "Family review opportunity: {{subject.name}}",
        body: "{{subject.name}} was linked into a family group — a good moment to offer a consolidated household review.",
        linkUrl: "/dashboard/families",
        severity: "info",
        audience: { roles: [], users: [], subjectRm: true },
      }),
      n("task_review", "create_task", {
        title: "Offer a household financial review to {{subject.name}}'s family",
        description: "Propose a consolidated review across the family — goals, protection adequacy, nominations and succession.",
        type: "review_meeting",
        priority: "normal",
        assignee: "subject.rm_id",
        dueAfter: { amount: 7, unit: "day" },
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "notify_rm"),
      e("e1", "notify_rm", "task_review"),
      e("e2", "task_review", "end"),
    ],
  }),
};
