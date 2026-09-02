/**
 * Backfill folio scheme categories from the AMFI scheme_nav reference.
 *
 * Older RTA imports stored each folio's `schemes[]` WITHOUT a `category`, so
 * Portfolio Intelligence bucketed every holding as "Other". resolve-scheme.ts
 * now populates category on new imports; this one-off backfills existing rows by
 * matching each scheme to scheme_nav (by AMFI scheme_code, then by normalized
 * name) and writing the AMFI `scheme_category` into the jsonb.
 *
 * Safe + idempotent: only fills a category when it's currently missing; leaves
 * everything else untouched. Run with:
 *   ALLOW_SYSTEM_TX=1 npx tsx scripts/backfill-scheme-categories.ts
 */

import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";

function normName(s: string | undefined | null): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

async function main() {
  await withSystem(async (tx) => {
    // Build scheme_code → category + normalized-name → category lookups once.
    const navRows = (await tx.execute(sql`SELECT scheme_code, scheme_name, scheme_category FROM scheme_nav WHERE scheme_category IS NOT NULL`)).rows as any[];
    const byCode = new Map<string, string>();
    const byName = new Map<string, string>();
    for (const r of navRows) {
      const cat = String(r.scheme_category ?? "").trim();
      if (!cat) continue;
      if (r.scheme_code) byCode.set(String(r.scheme_code), cat);
      const k = normName(r.scheme_name);
      if (k && !byName.has(k)) byName.set(k, cat);
    }
    console.log(`[backfill] loaded ${byCode.size} codes / ${byName.size} names from scheme_nav`);

    const folios = (await tx.execute(sql`SELECT id, schemes FROM folios WHERE schemes IS NOT NULL AND jsonb_array_length(schemes) > 0`)).rows as any[];
    let touched = 0, schemesFilled = 0;
    for (const f of folios) {
      const schemes = (f.schemes as any[]) ?? [];
      let changed = false;
      for (const s of schemes) {
        if (s.category && String(s.category).trim()) continue; // already set
        const cat = (s.schemeCode && byCode.get(String(s.schemeCode))) || byName.get(normName(s.schemeName));
        if (cat) {
          s.category = cat;
          changed = true;
          schemesFilled++;
        }
      }
      if (changed) {
        await tx.execute(sql`UPDATE folios SET schemes = ${JSON.stringify(schemes)}::jsonb, updated_at = now() WHERE id = ${f.id}::uuid`);
        touched++;
      }
    }
    console.log(`[backfill] done — ${touched} folios updated, ${schemesFilled} scheme categories filled`);
  });
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
