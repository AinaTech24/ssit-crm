import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

export const anniversaryRecipe: RecipeDef = {
  key: "investor_anniversary",
  name: "Investor anniversary touchpoint",
  description: "Annual anniversary of onboarding — send a thank-you WA + email.",
  category: "service",
  tags: ["anniversary", "engagement"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", { kind: "investor.anniversary", subjectType: "investor" }),
      n("wa", "send_whatsapp", {
        templateKey: "thank_you_anniversary",
        variables: { name: "subject.name", years: "event.years" },
        category: "utility",
      }),
      n("email", "send_email", {
        templateKey: "thank_you_anniversary_email",
        variables: { name: "subject.name", years: "event.years" },
        category: "transactional",
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "wa"),
      e("e1", "wa", "email"),
      e("e2", "email", "end"),
    ],
  }),
};
