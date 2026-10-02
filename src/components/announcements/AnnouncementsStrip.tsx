/**
 * AnnouncementsStrip — compact banner of active pinned/urgent notices, shown
 * at the top of the dashboard home so staff see firm news on login. Renders
 * nothing when there's nothing to show.
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { Megaphone, Pin } from "lucide-react";
import { withTenant } from "@/db/client";

const CAT_TONE: Record<string, string> = {
  urgent: "border-rose-200 bg-rose-50/70 text-rose-900 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200",
  policy: "border-blue-200 bg-blue-50/70 text-blue-900 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-200",
  event: "border-violet-200 bg-violet-50/70 text-violet-900 dark:border-violet-900 dark:bg-violet-950/50 dark:text-violet-200",
  system: "border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
  general: "border-border bg-secondary/70 text-foreground",
};

export async function AnnouncementsStrip({ session }: { session: { tenantId: string; userId: string; roles: string[]; branchId?: string | null } }) {
  const rolesJson = JSON.stringify(session.roles);
  const rows = await withTenant(session.tenantId, async (tx) => {
    // Drop notices the user has already read so the strip stays a signal, not
    // noise. A requires-ack notice stays until it's actually acknowledged.
    const r = await tx.execute(sql`
      SELECT a.id, a.title, a.body, a.category, a.is_pinned, a.requires_ack
      FROM announcements a
      LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.user_id = ${session.userId}::uuid
      WHERE a.tenant_id = ${session.tenantId}::uuid
        AND a.published_at IS NOT NULL AND a.published_at <= now()
        AND (a.expires_at IS NULL OR a.expires_at > now())
        AND (a.branch_id IS NULL OR a.branch_id = ${session.branchId ?? null})
        -- Desk scope, read from the user row so a move between sub-branches
        -- takes effect on the next request rather than the next login.
        AND (
          a.desk_id IS NULL
          OR a.desk_id = (SELECT desk_id FROM users WHERE id = ${session.userId}::uuid)
        )
        AND (a.is_pinned = true OR a.category = 'urgent' OR a.requires_ack = true)
        AND (
          a.audience_roles IS NULL
          OR jsonb_array_length(a.audience_roles) = 0
          OR a.audience_roles ?| array(SELECT jsonb_array_elements_text(${rolesJson}::jsonb))
        )
        AND (CASE WHEN a.requires_ack THEN ar.acknowledged_at IS NULL ELSE ar.read_at IS NULL END)
      ORDER BY (a.category = 'urgent') DESC, a.is_pinned DESC, a.published_at DESC
      LIMIT 3
    `);
    return r.rows as any[];
  });

  if (!rows.length) return null;

  return (
    <div className="space-y-2 mb-4">
      {rows.map((a) => (
        <Link key={a.id} href="/dashboard/announcements" className={`block rounded-lg border px-4 py-2.5 text-sm hover:brightness-[0.98] transition ${CAT_TONE[a.category] ?? CAT_TONE.general}`}>
          <div className="flex items-center gap-2 font-semibold">
            {a.is_pinned ? <Pin className="size-3.5" /> : <Megaphone className="size-3.5" />}
            {a.title}
            {a.category === "urgent" && <span className="chip text-[10px] bg-rose-600 text-white">Urgent</span>}
          </div>
          <p className="text-xs opacity-80 mt-0.5 line-clamp-1">{a.body}</p>
        </Link>
      ))}
    </div>
  );
}
