/**
 * "Central spine" assertions — the engines CLAUDE.md calls the most critical:
 * the Filter AST compiler/predicate (the SQL-injection-safety boundary), the
 * comms compliance gate (the regulatory moat), and the RTA feed parsers. Pure
 * functions only (no DB), runnable via `tsx`. Wired into `npm test` + CI.
 *
 *   npx tsx scripts/check-spine.ts
 */
import { and, p } from "../src/lib/filter/ast";
import { compileToSql } from "../src/lib/filter/compiler";
import { compileToPredicate } from "../src/lib/filter/predicate";
import { runComplianceChecks } from "../src/lib/comms/compliance";
import { classifyTransactionType, parseReverseFeed } from "../src/lib/integrations/cams-feed-parser";
import { fifoRealizedGains, type TxRow } from "../src/lib/tax/realized-gains";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}
function eq(actual: unknown, expected: unknown, label: string) {
  ok(actual === expected, `${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}
function throws(fn: () => unknown, label: string) {
  try {
    fn();
    failed++;
    console.error(`  ✗ ${label}: expected throw, got none`);
  } catch {
    passed++;
  }
}

// ── Filter compiler: parameterization / injection safety ───────────────────
console.log("Filter compiler:");
{
  const r = compileToSql(and(p("name", "contains", "O'Brien; DROP TABLE investors;--")), "investor");
  ok(r.params.some((v) => String(v).includes("O'Brien")), "value rides as a bind param");
  ok(!r.sql.includes("DROP TABLE"), "raw value is NOT inlined into SQL (injection-safe)");
  ok(/\$\d+/.test(r.sql), "SQL uses positional placeholders");
}
throws(() => compileToSql(and(p("totally_unknown_field", "eq", "x")), "investor"), "unknown catalog field rejected");

// ── Filter predicate: in-memory event-time matching ────────────────────────
console.log("Filter predicate:");
{
  const isHni = compileToPredicate(and(p("segment_tag", "eq", "HNI")), "investor");
  eq(isHni({ segment_tag: "HNI" }), true, "segment eq match");
  eq(isHni({ segment_tag: "Retail" }), false, "segment eq non-match");
  const bigAum = compileToPredicate(and(p("aum", "gt", 1_000_000)), "investor");
  eq(bigAum({ aum: 2_000_000 }), true, "aum gt match");
  eq(bigAum({ aum: 500_000 }), false, "aum gt non-match");
}

// ── Comms compliance gate ──────────────────────────────────────────────────
console.log("Compliance gate:");
{
  const t = { legalName: "Acme Wealth LLP", arn: "270604" };
  const guaranteed = runComplianceChecks({ channel: "email", category: "transactional", tenant: t, text: "You get assured returns of 15% — risk free!" });
  eq(guaranteed.blocked, true, "assured/guaranteed-return language blocks (any category)");

  const adviser = runComplianceChecks({ channel: "email", category: "transactional", tenant: t, text: "Speak to our Wealth Adviser. ARN-270604" });
  eq(adviser.blocked, true, "adviser term blocks when not RIA");
  const adviserRia = runComplianceChecks({ channel: "email", category: "transactional", tenant: { ...t, riaRegistered: true }, text: "Speak to our Wealth Adviser. ARN-270604" });
  eq(adviserRia.blocked, false, "adviser term allowed for RIA");

  const mktgNoDisc = runComplianceChecks({ channel: "email", category: "marketing", tenant: t, text: "Invest now with Acme Wealth LLP. ARN-270604" });
  eq(mktgNoDisc.blocked, true, "marketing without risk disclaimer blocks");
  const mktgOk = runComplianceChecks({
    channel: "email", category: "marketing", tenant: t,
    text: "Invest with Acme Wealth LLP. Mutual fund investments are subject to market risks. Read all scheme related documents carefully. ARN-270604",
  });
  eq(mktgOk.blocked, false, "marketing with disclaimer + ARN + name passes");

  const txnOk = runComplianceChecks({ channel: "email", category: "transactional", tenant: t, text: "Your statement is attached. ARN-270604" });
  eq(txnOk.blocked, false, "clean transactional passes");
}

// ── RTA feed parser ─────────────────────────────────────────────────────────
console.log("RTA parser:");
eq(classifyTransactionType("R1"), "redemption", "R1 → redemption");
eq(classifyTransactionType("P234ES", "Systematic Investment"), "sip", "P234ES + SIP desc → sip");
eq(classifyTransactionType("TICOB"), "switch", "TICOB → switch");
eq(classifyTransactionType("", "Redemption", "FUL"), "redemption", "Redemption desc → redemption");
eq(classifyTransactionType("PURCHASE"), "lumpsum", "PURCHASE → lumpsum");
{
  const feed = [
    "folio_no|pan|scheme_code|trxn_type|trxn_nature|amount|units|post_date",
    "12345|ABCDE1234F|251G|P234ES|Systematic Investment|4999.75|13.4|15/05/2026",
    "67890|FGHIJ5678K|296G|R1|Redemption|10000|100|03/15/2026", // MM/DD → must swap
  ].join("\n");
  const rows = parseReverseFeed(feed, "test");
  eq(rows.length, 2, "two rows parsed");
  eq(rows[0]?.folioNumber, "12345", "folio extracted");
  eq(rows[0]?.amount, 4999.75, "amount extracted");
  eq(rows[0]?.type, "sip", "type classified");
  eq(rows[0]?.orderDate, "2026-05-15", "DD/MM date normalized");
  eq(rows[1]?.orderDate, "2026-03-15", "MM/DD date swapped correctly");
  eq(rows[1]?.type, "redemption", "redemption classified");
}

// ── Realized-gains: switch-in must be a BUY, not a sell ─────────────────────
console.log("Realized gains (switch):");
{
  const rows: TxRow[] = [
    { scheme_code: "B", scheme_name: "Dest", type: "switch", direction: "inflow", units: "100", nav: "10", amount: "1000", order_date: "2024-05-01" },
    { scheme_code: "B", scheme_name: "Dest", type: "redemption", direction: "outflow", units: "100", nav: "12", amount: "1200", order_date: "2024-09-01" },
  ];
  const g = fifoRealizedGains(rows, 2024);
  // The switch-IN built a lot at nav 10; the later sell at 12 realizes a 200 gain.
  eq(g.rows.length, 1, "one realized sell row");
  ok(Math.abs(g.stcg - 200) < 0.01, `STCG ≈ 200 (switch-in correctly treated as buy), got ${g.stcg}`);
}

console.log(`\n[check-spine] ${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
