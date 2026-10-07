import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ALL_NAV_KEYS, CORE_HREFS } from "@/config/nav-access";

/**
 * Every sidebar item must be in the access catalogue.
 *
 * An item the catalogue does not know is never gated (isGatableNav is false for
 * it), so it shows for everyone no matter what the firm or the team member has
 * switched off — which is exactly how Induction and Expected Inflows ended up
 * un-toggleable. This fails the build the next time someone adds a sidebar item
 * without adding it to src/config/nav-access.ts.
 */
describe("sidebar access catalogue", () => {
  it("covers every href in the dashboard NAV", () => {
    const layout = readFileSync(path.resolve(__dirname, "../src/app/dashboard/layout.tsx"), "utf8");
    const hrefs = [...new Set([...layout.matchAll(/href: "(\/dashboard[^"]*)"/g)].map((m) => m[1]))];
    const known = new Set(ALL_NAV_KEYS);
    const missing = hrefs.filter((h) => !known.has(h) && !CORE_HREFS.has(h));
    expect(missing).toEqual([]);
  });
});
