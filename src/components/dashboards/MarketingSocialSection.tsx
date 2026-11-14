import Link from "next/link";
import { sql } from "drizzle-orm";
import { ExternalLink, Plus, Share2 } from "lucide-react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { DashboardEmptyState } from "./DashboardEmptyState";
import { platformLabel, typeLabel } from "@/lib/social/tracker";

type PlatformRow = { platform: string; posts: number; views: number; reach: number; likes: number; followers: number; leads: number };
type TopRow = { id: string; post_date: string; content_title: string; platform: string; content_type: string; post_link: string | null; views: number; leads: number };

const num = (n: number) => Number(n || 0).toLocaleString("en-IN");
const fmtDate = (iso: string) =>
  new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * The "Social media" tab of the Marketing dashboard: the Social Media Tracker's
 * numbers for the selected period — totals, a per-platform breakdown and the
 * best-performing posts — with a way into the full tracker.
 */
export async function MarketingSocialSection({
  session,
  fromISO,
  toISO,
}: {
  session: SessionUser;
  fromISO: string;
  toISO: string;
}) {
  const canManage = can(session.roles, "social_tracker.manage", session.permissions);

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const range = sql`post_date >= (${fromISO}::timestamptz AT TIME ZONE 'Asia/Kolkata')::date
                    AND post_date <= (${toISO}::timestamptz AT TIME ZONE 'Asia/Kolkata')::date
                    AND status <> 'cancelled'
                    AND tenant_id = ${session.tenantId}::uuid`;
      const byPlatform = await tx.execute(sql`
        SELECT platform,
               COUNT(*)::int AS posts,
               COALESCE(SUM(views), 0)::bigint AS views,
               COALESCE(SUM(reach), 0)::bigint AS reach,
               COALESCE(SUM(likes), 0)::bigint AS likes,
               COALESCE(SUM(followers_increase), 0)::bigint AS followers,
               COALESCE(SUM(leads), 0)::bigint AS leads
          FROM social_media_posts
         WHERE ${range}
         GROUP BY platform
         ORDER BY SUM(views) DESC, COUNT(*) DESC
      `);
      const top = await tx.execute(sql`
        SELECT id, post_date, content_title, platform, content_type, post_link, views, leads
          FROM social_media_posts
         WHERE ${range}
         ORDER BY views DESC, post_date DESC
         LIMIT 5
      `);
      return { byPlatform: byPlatform.rows as unknown as PlatformRow[], top: top.rows as unknown as TopRow[] };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const t = data.byPlatform.reduce(
    (a, r) => ({
      posts: a.posts + Number(r.posts),
      views: a.views + Number(r.views),
      reach: a.reach + Number(r.reach),
      likes: a.likes + Number(r.likes),
      followers: a.followers + Number(r.followers),
      leads: a.leads + Number(r.leads),
    }),
    { posts: 0, views: 0, reach: 0, likes: 0, followers: 0, leads: 0 }
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {(
          [
            ["Posts", t.posts],
            ["Views", t.views],
            ["Reach", t.reach],
            ["Likes", t.likes],
            ["Followers gained", t.followers],
            ["Leads", t.leads],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="card-surface glass-card p-5 hover-lift">
            <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">{label}</div>
            <div className="text-2xl font-bold mt-2 tracking-tight tabular-nums">{num(value)}</div>
          </div>
        ))}
      </div>

      <div className="card-surface glass-card p-5">
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
            <Share2 className="size-4 text-brand-cyan-deep" /> By platform
          </h2>
          <div className="flex items-center gap-3">
            {canManage && (
              <Link href="/dashboard/social-media-tracker" className="text-xs text-brand-cyan-deep hover:underline font-semibold inline-flex items-center gap-1">
                <Plus className="size-3.5" /> Add entry
              </Link>
            )}
            <Link href="/dashboard/social-media-tracker" className="text-xs text-brand-cyan-deep hover:underline font-semibold">
              Open tracker →
            </Link>
          </div>
        </div>
        {data.byPlatform.length === 0 ? (
          <DashboardEmptyState
            icon={Share2}
            title="No posts logged in this period"
            hint="Entries added in the Social Media Tracker show up here."
            cta={{ href: "/dashboard/social-media-tracker", label: "Open the tracker" }}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-2 font-medium">Platform</th>
                  <th className="text-right py-2 font-medium">Posts</th>
                  <th className="text-right py-2 font-medium">Views</th>
                  <th className="text-right py-2 font-medium">Reach</th>
                  <th className="text-right py-2 font-medium">Likes</th>
                  <th className="text-right py-2 font-medium">Followers +</th>
                  <th className="text-right py-2 font-medium">Leads</th>
                </tr>
              </thead>
              <tbody>
                {data.byPlatform.map((r) => (
                  <tr key={r.platform} className="border-b last:border-0">
                    <td className="py-2 font-medium">{platformLabel(r.platform)}</td>
                    <td className="py-2 text-right tabular-nums">{num(r.posts)}</td>
                    <td className="py-2 text-right tabular-nums">{num(r.views)}</td>
                    <td className="py-2 text-right tabular-nums">{num(r.reach)}</td>
                    <td className="py-2 text-right tabular-nums">{num(r.likes)}</td>
                    <td className="py-2 text-right tabular-nums">{num(r.followers)}</td>
                    <td className="py-2 text-right tabular-nums">{num(r.leads)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data.top.length > 0 && (
        <div className="card-surface glass-card p-5">
          <h2 className="font-semibold text-sm tracking-tight text-foreground/90 mb-3">Top posts by views</h2>
          <ul className="divide-y">
            {data.top.map((p) => (
              <li key={p.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium truncate">{p.content_title}</div>
                  <div className="text-xs text-muted-foreground">
                    {fmtDate(p.post_date)} · {platformLabel(p.platform)} · {typeLabel(p.content_type)}
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0 text-xs text-muted-foreground tabular-nums">
                  <span>{num(p.views)} views</span>
                  <span>{num(p.leads)} leads</span>
                  {p.post_link && (
                    <a href={p.post_link} target="_blank" rel="noopener noreferrer" className="text-brand-cyan-deep hover:underline inline-flex items-center gap-1">
                      Open <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
