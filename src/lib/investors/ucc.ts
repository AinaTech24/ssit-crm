/**
 * UCC helpers — server-safe (no "use client"), so API routes and the import
 * pipeline can normalise codes the same way the form does.
 */

/** Trim, drop blanks, de-dupe (order-preserving). */
export function cleanUccCodes(list: string[] | undefined | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list ?? []) {
    const v = (raw ?? "").trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/** Split a single imported cell (comma / semicolon / pipe separated) into codes. */
export function parseUccCell(cell: string | undefined | null): string[] {
  return cleanUccCodes((cell ?? "").split(/[,;|]/));
}
