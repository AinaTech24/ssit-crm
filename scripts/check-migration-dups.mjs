#!/usr/bin/env node
/**
 * CI guard: reject NEW duplicate migration number prefixes.
 *
 * The migrate runner (scripts/migrate-all.ts) applies files by lexicographic
 * filename, so two files sharing a numeric prefix have a non-deterministic
 * apply order on a fresh DB. We can't safely renumber ALREADY-APPLIED history
 * (it would change the applied-checksum ledger and re-run them), so the
 * historical collisions are grandfathered in BASELINE below. Any collision on a
 * prefix NOT in the baseline fails CI — preventing new ambiguity from creeping in.
 *
 * When you intentionally accept a new collision (you shouldn't — just bump the
 * number), add its prefix to BASELINE.
 */
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "drizzle", "migrations");

// Prefixes that already collide in committed history (frozen — do not grow).
// The 0131–0161 block was collisions that predate the checker's baseline and
// only surfaced once those migrations were tracked in git; every pair touches
// unrelated tables, so their fresh-DB apply order is immaterial.
const BASELINE = new Set([
  "0001", "0036", "0037", "0040", "0045", "0047", "0051", "0052", "0053",
  "0054", "0055", "0056", "0057", "0058", "0060", "0061", "0062", "0063",
  "0072", "0073", "0074",
  "0131", "0137", "0144", "0145", "0147", "0148", "0149", "0150", "0151",
  "0160", "0161",
]);

const files = fs.readdirSync(DIR).filter((f) => /^\d+_.*\.sql$/.test(f));
const byPrefix = new Map();
for (const f of files) {
  const prefix = f.match(/^(\d+)_/)[1];
  (byPrefix.get(prefix) ?? byPrefix.set(prefix, []).get(prefix)).push(f);
}

const newDups = [];
for (const [prefix, group] of byPrefix) {
  if (group.length > 1 && !BASELINE.has(prefix)) newDups.push({ prefix, group });
}

if (newDups.length) {
  console.error("✗ New duplicate migration number prefix(es) found — bump to a unique number:");
  for (const { prefix, group } of newDups) {
    console.error(`  ${prefix}: ${group.join(", ")}`);
  }
  process.exit(1);
}

console.log(`✓ No new duplicate migration prefixes (${files.length} migrations, ${BASELINE.size} grandfathered collisions).`);
