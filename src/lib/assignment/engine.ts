/**
 * Assignment engine — pick the RM a new record should route to, per the first
 * matching active Assignment Rule (Zoho parity). Round-robin advances a cursor;
 * load-balanced picks the least-loaded RM; specific is a fixed owner.
 *
 * Runs inside the caller's tenant transaction (RLS-scoped). Mutates the rule's
 * rr_cursor for round-robin so distribution is fair across calls.
 */

import { sql } from "drizzle-orm";

type Tx = { execute: (q: any) => Promise<{ rows: any[] }> };

function matches(criteria: Record<string, any> | null, record: Record<string, any>): boolean {
  if (!criteria || Object.keys(criteria).length === 0) return true;
  for (const [k, v] of Object.entries(criteria)) {
    if (!v) continue;
    const rv = record[k];
    if (String(rv ?? "").toLowerCase() !== String(v).toLowerCase()) return false;
  }
  return true;
}

export async function pickAssignee(
  tx: Tx,
  opts: { tenantId: string; subjectType: "lead" | "investor"; record: Record<string, any> }
): Promise<string | null> {
  const rules = (await tx.execute(sql`
    SELECT id, strategy, target_user_ids, criteria, rr_cursor
    FROM assignment_rules
    WHERE tenant_id = ${opts.tenantId}::uuid AND subject_type = ${opts.subjectType} AND is_active = true
    ORDER BY priority ASC, created_at ASC
  `)).rows as any[];

  for (const rule of rules) {
    const targets: string[] = Array.isArray(rule.target_user_ids) ? rule.target_user_ids : [];
    if (!targets.length) continue;
    if (!matches(rule.criteria, opts.record)) continue;

    if (rule.strategy === "specific") return targets[0];

    if (rule.strategy === "round_robin") {
      const idx = Number(rule.rr_cursor ?? 0) % targets.length;
      const chosen = targets[idx];
      await tx.execute(sql`UPDATE assignment_rules SET rr_cursor = ${(idx + 1) % targets.length}, updated_at = now() WHERE id = ${rule.id}::uuid`);
      return chosen;
    }

    if (rule.strategy === "load_balanced") {
      // Fewest open leads among the targets wins (ties → first).
      const counts = (await tx.execute(sql`
        SELECT u AS uid, (
          SELECT COUNT(*)::int FROM leads l
          WHERE l.tenant_id = ${opts.tenantId}::uuid AND l.owner_id = u::uuid
            AND l.converted_investor_id IS NULL
            AND l.stage NOT IN ('not_qualified','lost','not_interested','converted')
        ) AS open_count
        FROM unnest(${sql.raw(`ARRAY[${targets.map((t) => `'${t}'`).join(",")}]::uuid[]`)}) u
        ORDER BY open_count ASC
        LIMIT 1
      `)).rows as any[];
      if (counts[0]?.uid) return counts[0].uid as string;
      return targets[0];
    }
  }
  return null;
}
