import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

export const dailyMisDigestRecipe: RecipeDef = {
  key: "daily_mis_digest",
  name: "Daily MIS digest to owner",
  description: "Every morning 7AM IST, send the owner an AUM / net sales / SIP / redemption / alerts digest via WA + email.",
  category: "internal",
  tags: ["mis", "owner", "digest"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", {}),
      n("compose", "ai_compose", {
        prompt:
          "Write a concise daily digest for the firm owner. Include: AUM movement, net sales today, new SIPs registered, redemptions, top 3 alerts. Keep it under 200 words. Reference data from context.",
        storeAs: "digest",
        context: ["context.metrics", "context.alerts"],
        maxTokens: 600,
      }),
      n("wa", "send_whatsapp", {
        templateKey: "daily_digest_wa",
        variables: { name: "tenant.legal_name", digest: "vars.digest" },
        category: "utility",
        recipient: { source: "context", value: "tenant.phone" },
      }),
      n("email", "send_email", {
        templateKey: "daily_digest_email",
        variables: { digest: "vars.digest" },
        category: "transactional",
        recipient: { source: "context", value: "tenant.email" },
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "compose"),
      e("e1", "compose", "wa"),
      e("e2", "wa", "email"),
      e("e3", "email", "end"),
    ],
  }),
};
