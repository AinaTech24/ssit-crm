/**
 * Whose record is this — the person an automated message should come from.
 *
 * A lead Nimisha created is Nimisha's lead (leads.owner_id); a client is their
 * RM's client (investors.rm_id). When a rule fires off that record, the mail is
 * that person's work, so it goes out over their name. The rule's author is only
 * a fallback: they wrote the rule once, months ago, and it is not their client.
 *
 * Columns are read defensively (snake_case and camelCase) because the record on
 * a rule context comes from a raw row in some paths and a Drizzle select in
 * others.
 */

type Rec = Record<string, unknown> | null | undefined;

function pick(rec: Rec, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = rec?.[k];
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

/** The owning user for a rule/workflow subject, or undefined when it has none. */
export function recordOwnerUserId(subjectType: string | null | undefined, record: Rec): string | undefined {
  switch (subjectType) {
    case "investor":
      return pick(record, "rm_id", "rmId");
    case "lead":
      return pick(record, "owner_id", "ownerId");
    case "task":
      return pick(record, "assignee_id", "assigneeId");
    default:
      // Unknown subject: try the common shapes rather than guessing wrong.
      return pick(record, "rm_id", "rmId", "owner_id", "ownerId");
  }
}
