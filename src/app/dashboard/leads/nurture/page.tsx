import Link from "next/link";
import { sql } from "drizzle-orm";
import { Heart, Clock, Calendar, Phone } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatDate, formatRelative } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function LeadNurturePage() {
  const session = await requireSession();

  const rows = await withTenant(session.tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT l.id, l.name, l.phone, l.email, l.source, l.stage,
             l.last_contact_at, l.next_follow_up_at, l.follow_up_notes,
             u.name AS rm_name
      FROM leads l
      LEFT JOIN users u ON u.id = l.owner_id
      WHERE l.stage IN ('follow_up', 'contacted', 'meeting_scheduled', 'meeting_done')
        AND l.converted_investor_id IS NULL
        AND (l.next_follow_up_at IS NOT NULL OR l.last_contact_at < now() - interval '14 days')
      ORDER BY
        CASE WHEN l.next_follow_up_at IS NOT NULL THEN 0 ELSE 1 END,
        l.next_follow_up_at NULLS LAST,
        l.last_contact_at NULLS LAST
      LIMIT 200
    `);
    return r.rows as any[];
  });

  // Bucket: today / this-week / future / overdue
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const buckets = {
    overdue: [] as any[],
    today: [] as any[],
    thisWeek: [] as any[],
    later: [] as any[],
    dormant: [] as any[],
  };

  for (const r of rows) {
    const next = r.next_follow_up_at ? new Date(r.next_follow_up_at) : null;
    if (next) {
      if (next < new Date()) buckets.overdue.push(r);
      else if (next <= today) buckets.today.push(r);
      else if (next <= weekEnd) buckets.thisWeek.push(r);
      else buckets.later.push(r);
    } else {
      buckets.dormant.push(r);
    }
  }

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="page-title">
          <Heart className="size-6 text-brand-cyan" /> Lead Nurturing
        </h1>
        <p className="page-subtitle">
          Leads that aren't quite ready yet — keep them warm with periodic content + check-ins. Once they're ready, push them through to the proposal stage.
        </p>
      </div>

      <Section title="Overdue follow-ups" tone="rose" rows={buckets.overdue} />
      <Section title="Today" tone="amber" rows={buckets.today} />
      <Section title="This week" tone="cyan" rows={buckets.thisWeek} />
      <Section title="Later" tone="emerald" rows={buckets.later} />
      <Section title="Dormant (no contact in 14+ days)" tone="muted" rows={buckets.dormant} />
    </div>
  );
}

function Section({
  title,
  tone,
  rows,
}: {
  title: string;
  tone: "rose" | "amber" | "cyan" | "emerald" | "muted";
  rows: any[];
}) {
  if (rows.length === 0) return null;
  const colour: Record<string, string> = {
    rose: "border-rose-300 bg-rose-50/30",
    amber: "border-amber-300 bg-amber-50/30",
    cyan: "border-brand-cyan/40 bg-brand-cyan-light/20",
    emerald: "border-emerald-300 bg-emerald-50/30",
    muted: "border-border bg-secondary/30",
  };
  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        {title} <span className="text-xs">· {rows.length}</span>
      </h2>
      <div className={`card-surface border-l-4 ${colour[tone]} overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Lead</th>
              <th className="text-left py-2 font-medium">Source</th>
              <th className="text-left py-2 font-medium">RM</th>
              <th className="text-left py-2 font-medium">Last contact</th>
              <th className="text-left py-2 font-medium">Next follow-up</th>
              <th className="text-left py-2 font-medium pr-4">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0 hover:bg-white/40">
                <td className="px-4 py-3">
                  <Link href={`/dashboard/leads/${r.id}`} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                    {r.phone && <span><Phone className="inline size-2.5 mr-0.5" />{r.phone}</span>}
                  </div>
                </td>
                <td className="py-3 text-xs capitalize">{r.source?.replace(/_/g, " ")}</td>
                <td className="py-3 text-xs">{r.rm_name ?? <span className="text-muted-foreground">—</span>}</td>
                <td className="py-3 text-xs tabular-nums">
                  {r.last_contact_at ? formatRelative(r.last_contact_at) : <span className="text-muted-foreground">never</span>}
                </td>
                <td className="py-3 text-xs tabular-nums">
                  {r.next_follow_up_at ? (
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="size-3" /> {formatDate(r.next_follow_up_at)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground italic">no date set</span>
                  )}
                </td>
                <td className="py-3 pr-4 text-xs text-muted-foreground max-w-[260px] truncate">
                  {r.follow_up_notes ?? <span className="italic">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
