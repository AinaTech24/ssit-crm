import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

export const marketVolatilityRecipe: RecipeDef = {
  key: "market_volatility_broadcast",
  name: "Market volatility — stay-invested broadcast",
  description:
    "When NIFTY drops >2% in a day, broadcast a pre-approved 'stay invested' WhatsApp message to all marketing-opted-in investors. Throttled to once per 24h.",
  category: "marketing",
  tags: ["volatility", "broadcast", "retention"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", { kind: "market.nifty_drop", subjectType: "investor" }),
      n("send_wa", "send_whatsapp", {
        templateKey: "market_volatility_stay_invested",
        variables: {
          name: "subject.name",
          drop_pct: "event.after.nifty_change_pct",
        },
        category: "marketing",
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "send_wa"),
      e("e1", "send_wa", "end"),
    ],
  }),
};
