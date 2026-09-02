/**
 * Round-robin lead assignment.
 *
 * When a lead is created without an explicit `ownerId`, we auto-assign it to
 * an active RM. Two strategies — settable per-tenant later via masters; for
 * now we pick the strategy that gives the most balanced distribution:
 *
 *   1. "least_loaded"  — pick the RM with the fewest open (un-converted, un-lost)
 *                        leads. Self-balancing.
 *   2. "round_robin"   — pick the RM who hasn't received a lead in the longest
 *                        time (LRU). Fair sequence.
 *
 * We default to "least_loaded" because it self-heals when someone returns from
 * leave with a stale backlog — round-robin would keep feeding them while they
 * dig out.
 *
 * Caller passes the open `tx` (inside withTenant) so this runs in the same
 * transaction as the lead INSERT — no race window.
 */

import { sql } from "drizzle-orm";

export type AssignStrategy = "least_loaded" | "round_robin";

/**
 * Returns the user_id of the RM to assign, or null if no RMs exist.
 * Excludes `excludeUserId` from the pool (e.g. the creator).
 */
export async function pickRmForNewLead(
  tx: any,
  opts: {
    branchId?: string | null;
    strategy?: AssignStrategy;
    excludeUserId?: string | null;
  } = {}
): Promise<string | null> {
  const strategy: AssignStrategy = opts.strategy ?? "least_loaded";

  // Resolve the pool of active RMs in this tenant. RLS already scopes by tenant.
  const branchFilter = opts.branchId
    ? sql`AND (u.branch_id = ${opts.branchId} OR u.branch_id IS NULL)`
    : sql``;
  const excludeFilter = opts.excludeUserId
    ? sql`AND u.id <> ${opts.excludeUserId}`
    : sql``;

  if (strategy === "least_loaded") {
    const r = await tx.execute(sql`
      SELECT u.id,
        (SELECT COUNT(*) FROM leads l
          WHERE l.owner_id = u.id
            AND l.stage NOT IN ('converted', 'lost', 'cold', 'not_interested')
        )::int AS open_count
      FROM users u
      WHERE 'rm' = ANY(u.roles)
        AND u.status = 'active'
        ${branchFilter}
        ${excludeFilter}
      ORDER BY open_count ASC, u.created_at ASC
      LIMIT 1
    `);
    return (r.rows[0] as { id: string } | undefined)?.id ?? null;
  }

  // Round-robin: oldest assignment first (i.e. has gone longest without a new lead)
  const r = await tx.execute(sql`
    SELECT u.id,
      (SELECT MAX(l.created_at) FROM leads l WHERE l.owner_id = u.id) AS last_assigned
    FROM users u
    WHERE 'rm' = ANY(u.roles)
      AND u.status = 'active'
      ${branchFilter}
      ${excludeFilter}
    ORDER BY last_assigned ASC NULLS FIRST, u.created_at ASC
    LIMIT 1
  `);
  return (r.rows[0] as { id: string } | undefined)?.id ?? null;
}
