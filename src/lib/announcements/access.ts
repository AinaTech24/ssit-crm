/**
 * Who may see an announcement — and therefore its files.
 *
 * The board's GET already narrows notices by published / not-expired / branch
 * / audience-role. An attachment route that only checked "are you in this
 * tenant" would hand the file to someone the notice was deliberately scoped
 * away from, which is the usual way a filtered list gets undone by a direct
 * URL. So both attachment routes decide visibility HERE, against the same
 * conditions, rather than re-deriving them.
 */

import { sql } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Per-person audience (announcements.audience_user_ids). A notice aimed at named
 * people is shown only to them and to whoever wrote it; the owner still sees it
 * on the manage board (`ownerSeesAll`) but not in their own banner / badge.
 * Expects the announcements table aliased `a`.
 */
export function audienceUserSql(session: { userId: string; roles: string[] }, ownerSeesAll = false) {
  if (ownerSeesAll && session.roles.includes("owner")) return sql`TRUE`;
  return sql`(a.audience_user_ids IS NULL OR jsonb_array_length(a.audience_user_ids) = 0
    OR a.audience_user_ids ? ${session.userId}::text OR a.created_by_user_id = ${session.userId}::uuid)`;
}

/** Posting a notice is owner / branch-head work; so is attaching to one. */
export function isAnnouncementManager(roles: string[]): boolean {
  return roles.some((r) => ["owner", "branch_head"].includes(r));
}

/**
 * Can this session see this announcement? Managers see everything in their own
 * firm, including drafts they are still writing. Everyone else gets the same
 * test the board applies.
 */
export async function canViewAnnouncement(
  tx: any,
  session: SessionUser,
  announcementId: string
): Promise<boolean> {
  if (isAnnouncementManager(session.roles)) {
    const r = await tx.execute(sql`
      SELECT 1 FROM announcements a
      WHERE a.id = ${announcementId}::uuid AND a.tenant_id = ${session.tenantId}::uuid
        AND ${audienceUserSql(session, true)}
      LIMIT 1
    `);
    return r.rows.length > 0;
  }
  const rolesJson = JSON.stringify(session.roles);
  const r = await tx.execute(sql`
    SELECT 1 FROM announcements a
    WHERE a.id = ${announcementId}::uuid
      AND a.tenant_id = ${session.tenantId}::uuid
      AND a.published_at IS NOT NULL AND a.published_at <= now()
      AND (a.expires_at IS NULL OR a.expires_at > now())
      AND (a.branch_id IS NULL OR a.branch_id = ${session.branchId ?? null})
        -- Desk scope, read from the user row so a move between sub-branches
        -- takes effect on the next request rather than the next login.
        AND (
          a.desk_id IS NULL
          OR a.desk_id = (SELECT desk_id FROM users WHERE id = ${session.userId}::uuid)
        )
      AND (
        a.audience_roles IS NULL
        OR jsonb_array_length(a.audience_roles) = 0
        OR a.audience_roles ?| array(SELECT jsonb_array_elements_text(${rolesJson}::jsonb))
      )
      AND ${audienceUserSql(session)}
    LIMIT 1
  `);
  return r.rows.length > 0;
}
