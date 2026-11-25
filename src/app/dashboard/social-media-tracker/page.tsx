import Link from "next/link";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { ChevronLeft, ChevronRight, Share2 } from "lucide-react";
import { withTenant } from "@/db/client";
import { socialMediaPosts } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { SocialTrackerManager, type TrackerRow } from "@/components/social/SocialTrackerManager";
import { isMonthKey, istDate, shiftMonth } from "@/lib/dhandho/schedule";
import { PLATFORMS, POST_STATUSES, totalsOf } from "@/lib/social/tracker";

export const dynamic = "force-dynamic";

const monthTitle = (key: string) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const num = (n: number) => n.toLocaleString("en-IN");

export default async function SocialMediaTrackerPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; platform?: string; status?: string }>;
}) {
  const session = await requireSession();
  const canManage = can(session.roles, "social_tracker.manage", session.permissions);
  const canView = canManage || can(session.roles, "social_tracker.view", session.permissions);
  if (!canView) {
    return (
      <div className="max-w-xl border rounded-lg bg-card p-8 text-sm text-muted-foreground">
        You do not have access to the Social Media Tracker. Ask an admin to turn on “Social Media Tracker — view” for you.
      </div>
    );
  }

  const thisMonth = istDate().slice(0, 7);
  const sp = await searchParams;
  const month = sp.m && isMonthKey(sp.m) ? sp.m : thisMonth;
  const platform = PLATFORMS.some((p) => p.key === sp.platform) ? sp.platform! : "";
  const status = POST_STATUSES.some((s) => s.key === sp.status) ? sp.status! : "";

  const from = `${month}-01`;
  const to = `${shiftMonth(month, 1)}-01`;

  const rows = await withTenant(session.tenantId, (tx) =>
    tx
      .select()
      .from(socialMediaPosts)
      .where(
        and(
          eq(socialMediaPosts.tenantId, session.tenantId),
          gte(socialMediaPosts.postDate, from),
          lt(socialMediaPosts.postDate, to),
          platform ? eq(socialMediaPosts.platform, platform) : undefined,
          status ? eq(socialMediaPosts.status, status) : undefined
        )
      )
      .orderBy(desc(socialMediaPosts.postDate), desc(socialMediaPosts.createdAt))
      .limit(500)
  );

  const totals = totalsOf(rows);
  const tableRows: TrackerRow[] = rows.map((r) => ({
    id: r.id,
    postDate: r.postDate,
    contentTitle: r.contentTitle,
    contentType: r.contentType,
    platform: r.platform,
    status: r.status,
    postLink: r.postLink,
    driveLink: r.driveLink,
    views: r.views,
    reach: r.reach,
    likes: r.likes,
    followersIncrease: r.followersIncrease,
    leads: r.leads,
  }));

  const href = (over: { m?: string; platform?: string; status?: string }) => {
    const q = new URLSearchParams();
    const m = over.m ?? month;
    const p = over.platform ?? platform;
    const s = over.status ?? status;
    if (m !== thisMonth) q.set("m", m);
    if (p) q.set("platform", p);
    if (s) q.set("status", s);
    const qs = q.toString();
    return `/dashboard/social-media-tracker${qs ? `?${qs}` : ""}`;
  };

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-full border text-xs ${active ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`;

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Share2 className="size-6 text-brand-cyan" /> Social Media Tracker
          </h1>
          <p className="page-subtitle mt-1">What was posted, where, and how it performed.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Link href={href({ m: shiftMonth(month, -1) })} className="rounded-md border p-1.5 hover:bg-accent" aria-label="Previous month">
            <ChevronLeft className="size-4" />
          </Link>
          <span className="px-2 text-sm font-semibold min-w-[8rem] text-center">{monthTitle(month)}</span>
          <Link href={href({ m: shiftMonth(month, 1) })} className="rounded-md border p-1.5 hover:bg-accent" aria-label="Next month">
            <ChevronRight className="size-4" />
          </Link>
          {month !== thisMonth && (
            <Link href={href({ m: thisMonth })} className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent">
              This month
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          ["Posts", totals.posts],
          ["Views", totals.views],
          ["Reach", totals.reach],
          ["Likes", totals.likes],
          ["Followers gained", totals.followersIncrease],
          ["Leads", totals.leads],
        ].map(([label, value]) => (
          <div key={label as string} className="border rounded-lg bg-card p-4">
            <div className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider">{label}</div>
            <div className="text-2xl font-bold mt-1 tracking-tight tabular-nums">{num(value as number)}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-muted-foreground">Platform:</span>
        <Link href={href({ platform: "" })} className={chip(!platform)}>All</Link>
        {PLATFORMS.map((p) => (
          <Link key={p.key} href={href({ platform: p.key })} className={chip(platform === p.key)}>
            {p.label}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-muted-foreground">Status:</span>
        <Link href={href({ status: "" })} className={chip(!status)}>All</Link>
        {POST_STATUSES.map((s) => (
          <Link key={s.key} href={href({ status: s.key })} className={chip(status === s.key)}>
            {s.label}
          </Link>
        ))}
      </div>

      <SocialTrackerManager rows={tableRows} canManage={canManage} />
    </div>
  );
}
