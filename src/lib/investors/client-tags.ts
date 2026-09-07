/**
 * Client "book" tags and the per-platform codes that go with them.
 *
 * In practice a firm's clients arrive through one of two books — Motilal Oswal
 * or plain Mutual Fund — and most carry exactly one. They are modelled as TAGS
 * rather than an enum column because a client can legitimately be both, and
 * because the list grows: a third distributor next year should be a one-line
 * change here, not a migration.
 *
 * The codes are separate: they are identifiers, they get searched, and they
 * live in their own columns (migration 0206).
 */

/** Suggested book tags, offered as one-click chips. Free-form tags still work. */
export const CLIENT_BOOK_TAGS = ["Motilal Oswal", "Mutual Fund"] as const;

export type ClientCodeKey = "mfCode" | "moCode" | "bajajCode" | "lasCode";

export const CLIENT_CODE_FIELDS: {
  key: ClientCodeKey;
  label: string;
  placeholder: string;
  /** Book tag this code belongs to, when it maps to one. */
  tag?: (typeof CLIENT_BOOK_TAGS)[number];
}[] = [
  { key: "mfCode", label: "MF Code", placeholder: "Mutual-fund book code", tag: "Mutual Fund" },
  { key: "moCode", label: "MO Code", placeholder: "Motilal Oswal code", tag: "Motilal Oswal" },
  { key: "bajajCode", label: "Bajaj Code", placeholder: "Bajaj code" },
  { key: "lasCode", label: "LAS", placeholder: "Loan Against Shares a/c" },
];

export const CLIENT_CODE_KEYS = CLIENT_CODE_FIELDS.map((f) => f.key);

/**
 * Normalise a tag list: trimmed, de-duplicated case-insensitively (so
 * "motilal oswal" typed by hand does not sit beside the chip version), capped.
 * Returns the FIRST spelling seen, so a chip pressed before a manual typo wins.
 */
export function normaliseTags(input: unknown, max = 25): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const t = raw.trim().slice(0, 60);
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}
