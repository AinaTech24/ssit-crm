import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";
import { investors } from "./investors";

/**
 * Saved calculator scenarios — persistence for the Calculators module. An RM
 * builds an illustration in a client meeting and saves it; next review they
 * reload the exact inputs (and can compare against what was promised). One row
 * per saved scenario; `inputs` is the calculator's full input state keyed by
 * its own field names, `results` an optional summary snapshot for list views.
 */
export const calcScenarios = pgTable(
  "calc_scenarios",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    userId: uuid("user_id").references(() => users.id),
    /** Optional link to the client the illustration was built for. */
    investorId: uuid("investor_id").references(() => investors.id),
    /** Calculator key from the Calculators catalog (e.g. "sip360", "swpcomp"). */
    calculatorKey: text("calculator_key").notNull(),
    title: text("title").notNull(),
    inputs: jsonb("inputs").notNull(),
    results: jsonb("results"),
    ...timestamps,
  },
  (t) => ({
    byUserIdx: index("calc_scenarios_user_idx").on(t.tenantId, t.userId, t.calculatorKey),
    byInvestorIdx: index("calc_scenarios_investor_idx").on(t.tenantId, t.investorId),
  })
);

export type CalcScenario = typeof calcScenarios.$inferSelect;
export type NewCalcScenario = typeof calcScenarios.$inferInsert;
