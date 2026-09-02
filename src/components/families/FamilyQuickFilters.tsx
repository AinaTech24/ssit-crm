import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Quick-filter OPTIONS (with live row counts) for the Families list.
 *
 * These used to render as a chip strip under the search box. They now feed the
 * shared CompactFilterBar's Filters dropdown, so Families matches Clients /
 * Leads / Tasks — one search field with a filter icon at its right edge.
 *
 * Filter keys:
 *   - mine=1            → family rm_id = session.userId
 *   - no_primary=1      → primary_investor_id IS NULL
 *   - no_rm=1           → rm_id IS NULL
 *   - review_due=1      → next_review_at IS NULL OR <= now()
 *   - nominee_gap=1     → at least one member with nominee_name IS NULL/''
 *   - has_minor=1       → at least one member with is_minor=true
 *   - hni=1             → at least one HNI member
 *   - single=1          → only one active member
 *   - large=1           → 5+ active members
 */
export type FamilyFilterOption = { key: string; label: string; count: number };

export async function familyQuickFilterOptions(session: SessionUser): Promise<FamilyFilterOption[]> {
  const userId = session.userId;
  const counts = await withTenant(
    session.tenantId,
    async (tx) => {
      const r = await tx.execute(sql`
        WITH fam AS (
          SELECT
            f.id, f.primary_investor_id, f.rm_id, f.next_review_at, f.health_band,
            COUNT(i.id) FILTER (WHERE i.status = 'active') AS active_members,
            BOOL_OR(i.nominee_name IS NULL OR i.nominee_name = '')
              FILTER (WHERE i.status = 'active') AS any_no_nominee,
            BOOL_OR(i.is_minor = true) AS has_minor,
            BOOL_OR(i.segment_tag = 'HNI') AS any_hni
          FROM families f
          LEFT JOIN investors i ON i.family_id = f.id AND i.deleted_at IS NULL
          GROUP BY f.id
        )
        SELECT
          COUNT(*) FILTER (WHERE rm_id = ${userId})::int AS mine,
          COUNT(*) FILTER (WHERE primary_investor_id IS NULL)::int AS no_primary,
          COUNT(*) FILTER (WHERE rm_id IS NULL)::int AS no_rm,
          COUNT(*) FILTER (
            WHERE next_review_at IS NULL OR next_review_at <= now()
          )::int AS review_due,
          COUNT(*) FILTER (WHERE any_no_nominee = true)::int AS nominee_gap,
          COUNT(*) FILTER (WHERE has_minor = true)::int AS has_minor,
          COUNT(*) FILTER (WHERE any_hni = true)::int AS hni,
          COUNT(*) FILTER (WHERE active_members = 1)::int AS single,
          COUNT(*) FILTER (WHERE active_members >= 5)::int AS large,
          COUNT(*) FILTER (WHERE health_band = 'red')::int AS red_health
        FROM fam
      `);
      return r.rows[0] as any;
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  return [
    { key: "mine", label: "My families", count: Number(counts.mine) },
    { key: "no_primary", label: "No primary", count: Number(counts.no_primary) },
    { key: "no_rm", label: "No RM", count: Number(counts.no_rm) },
    { key: "review_due", label: "Review due", count: Number(counts.review_due) },
    { key: "nominee_gap", label: "Nominee gap", count: Number(counts.nominee_gap) },
    { key: "has_minor", label: "Has minor", count: Number(counts.has_minor) },
    { key: "hni", label: "HNI", count: Number(counts.hni) },
    { key: "single", label: "Single-member", count: Number(counts.single) },
    { key: "large", label: "5+ members", count: Number(counts.large) },
    { key: "red_health", label: "At-risk health", count: Number(counts.red_health) },
  ];
}
