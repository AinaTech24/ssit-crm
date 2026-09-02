/**
 * refresh-nav — download the AMFI NAVAll feed and upsert every scheme's latest
 * NAV into `scheme_nav`. Run daily (the master scheduler does this in prod) or
 * manually after a fresh DB to populate valuation data.
 *
 * Usage:  npm run refresh:nav
 */

import "dotenv/config";

// Cross-tenant maintenance — needs system DB access (scheme_nav has no RLS, but
// withSystem is the consistent entry point; read at call-time so set it here).
process.env.ALLOW_SYSTEM_TX = process.env.ALLOW_SYSTEM_TX ?? "1";

import { refreshNav } from "../src/lib/finance/nav-feed";

async function main() {
  const startedAt = Date.now();
  console.log("[refresh-nav] fetching AMFI NAVAll feed …");
  const { fetched, written, navDate } = await refreshNav();
  console.log(
    `[refresh-nav] done in ${Date.now() - startedAt}ms — parsed ${fetched} schemes, upserted ${written} (nav date ~${navDate}).`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[refresh-nav] failed:", err?.message ?? err);
  process.exit(1);
});
