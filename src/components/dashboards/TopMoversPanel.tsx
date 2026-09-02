import Link from "next/link";
import { sql } from "drizzle-orm";
import { TrendingUp, TrendingDown, Repeat, ArrowUpRight } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { withTenant } from "@/db/client";
import { formatINR } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Top Movers — the specific clients driving the period's numbers.
 *
 * Owners scan aggregate tiles ("net business ₹42L") but the actionable
 * question is "WHO?". This panel answers it:
 *   - Biggest net inflows (purchases − redemptions) per client this period
 *   - Biggest net outflows (redemption risk — call them)
 *   - Biggest new SIPs registered this period
 *
 * All derived from transactions + sips for the selected period start.
 */
export async function TopMoversPanel({
  session,
  startISO,
  periodLabel,
}: {
  session: SessionUser;
  startISO: string;
  periodLabel: string;
}) {
  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const [inflows, outflows, newSips] = await Promise.all([
        // Biggest net inflows per client
        await tx.execute(sql`
          SELECT i.id, i.name, i.segment_tag, i.avatar_url,
            COALESCE(SUM(CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END), 0)::numeric AS net_flow
          FROM transactions t
          JOIN investors i ON i.id = t.investor_id
          WHERE t.status IN ('successful','processed')
            AND t.order_date >= ${startISO}::date
            AND i.deleted_at IS NULL
          GROUP BY i.id, i.name, i.segment_tag, i.avatar_url
          HAVING COALESCE(SUM(CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END), 0) > 0
          ORDER BY net_flow DESC
          LIMIT 5
        `),

        // Biggest net outflows per client (redemption watch)
        await tx.execute(sql`
          SELECT i.id, i.name, i.segment_tag, i.avatar_url,
            COALESCE(SUM(CASE WHEN t.direction = 'outflow' THEN t.amount::numeric ELSE -t.amount::numeric END), 0)::numeric AS net_out
          FROM transactions t
          JOIN investors i ON i.id = t.investor_id
          WHERE t.status IN ('successful','processed')
            AND t.order_date >= ${startISO}::date
            AND i.deleted_at IS NULL
          GROUP BY i.id, i.name, i.segment_tag, i.avatar_url
          HAVING COALESCE(SUM(CASE WHEN t.direction = 'outflow' THEN t.amount::numeric ELSE -t.amount::numeric END), 0) > 0
          ORDER BY net_out DESC
          LIMIT 5
        `),

        // Biggest new SIPs registered this period
        await tx.execute(sql`
          SELECT s.id, s.amount, s.scheme_name, s.frequency,
            i.id AS investor_id, i.name AS investor_name, i.avatar_url AS investor_avatar_url
          FROM sips s
          JOIN investors i ON i.id = s.investor_id
          WHERE s.created_at >= ${startISO}
            AND i.deleted_at IS NULL
          ORDER BY s.amount::numeric DESC
          LIMIT 5
        `),
      ]);

      return {
        inflows: inflows.rows as any[],
        outflows: outflows.rows as any[],
        newSips: newSips.rows as any[],
      };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const empty =
    data.inflows.length === 0 && data.outflows.length === 0 && data.newSips.length === 0;

  if (empty) {
    return (
      <div className="card-surface glass-card p-5">
        <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90 mb-2">
          <div className="size-7 rounded-lg bg-brand-cyan-light grid place-items-center">
            <TrendingUp className="size-3.5 text-brand-cyan-deep" />
          </div>
          Top movers — {periodLabel}
        </h2>
        <p className="text-sm text-muted-foreground py-6 text-center">
          No transactions or new SIPs recorded for this period yet.
        </p>
      </div>
    );
  }

  return (
    <div className="card-surface glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
          <div className="size-7 rounded-lg bg-brand-cyan-light grid place-items-center">
            <TrendingUp className="size-3.5 text-brand-cyan-deep" />
          </div>
          Top movers — {periodLabel}
        </h2>
        <span className="text-xs text-muted-foreground">The clients behind the numbers</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Inflows */}
        <MoverColumn
          title="Biggest inflows"
          icon={<TrendingUp className="size-3.5 text-emerald-600" />}
          tone="emerald"
          empty={data.inflows.length === 0}
          emptyText="No net inflows this period."
        >
          {data.inflows.map((r) => (
            <MoverRow
              key={r.id}
              href={`/dashboard/investors/${r.id}`}
              name={r.name}
              tag={r.segment_tag}
              value={`+${formatINR(Number(r.net_flow))}`}
              valueTone="emerald"
              investorId={r.id}
              avatarUrl={r.avatar_url}
            />
          ))}
        </MoverColumn>

        {/* Outflows — redemption watch */}
        <MoverColumn
          title="Biggest outflows"
          icon={<TrendingDown className="size-3.5 text-rose-600" />}
          tone="rose"
          empty={data.outflows.length === 0}
          emptyText="No net outflows this period. ✓"
        >
          {data.outflows.map((r) => (
            <MoverRow
              key={r.id}
              href={`/dashboard/investors/${r.id}`}
              name={r.name}
              tag={r.segment_tag}
              value={`−${formatINR(Number(r.net_out))}`}
              valueTone="rose"
              investorId={r.id}
              avatarUrl={r.avatar_url}
            />
          ))}
        </MoverColumn>

        {/* New SIPs */}
        <MoverColumn
          title="Biggest new SIPs"
          icon={<Repeat className="size-3.5 text-violet-600" />}
          tone="violet"
          empty={data.newSips.length === 0}
          emptyText="No new SIPs this period."
        >
          {data.newSips.map((r) => (
            <MoverRow
              key={r.id}
              href={`/dashboard/investors/${r.investor_id}`}
              name={r.investor_name}
              tag={r.scheme_name ? String(r.scheme_name).slice(0, 18) : r.frequency}
              value={`${formatINR(Number(r.amount))}/mo`}
              valueTone="violet"
              investorId={r.investor_id}
              avatarUrl={r.investor_avatar_url}
            />
          ))}
        </MoverColumn>
      </div>
    </div>
  );
}

function MoverColumn({
  title,
  icon,
  tone,
  empty,
  emptyText,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  tone: "emerald" | "rose" | "violet";
  empty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
        {icon}
        {title}
      </div>
      {empty ? (
        <p className="text-xs text-muted-foreground py-4 text-center">{emptyText}</p>
      ) : (
        <ul className="divide-y">{children}</ul>
      )}
    </div>
  );
}

function MoverRow({
  href,
  name,
  tag,
  value,
  valueTone,
  investorId,
  avatarUrl,
}: {
  href: string;
  name: string;
  tag?: string | null;
  value: string;
  valueTone: "emerald" | "rose" | "violet";
  investorId?: string | null;
  avatarUrl?: string | null;
}) {
  const toneCls =
    valueTone === "emerald"
      ? "text-emerald-700"
      : valueTone === "rose"
      ? "text-rose-700"
      : "text-violet-700";
  return (
    <li className="py-1.5">
      <Link
        href={href}
        className="flex items-center justify-between gap-2 group hover:bg-accent/30 -mx-1 px-1 rounded"
      >
        <Avatar src={avatarUrl && investorId ? `/api/investors/${investorId}/avatar` : null} name={name} size={26} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate flex items-center gap-1">
            {name}
            <ArrowUpRight className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          {tag && (
            <div className="text-[10px] text-muted-foreground truncate">{tag}</div>
          )}
        </div>
        <span className={`text-xs font-bold tabular-nums whitespace-nowrap ${toneCls}`}>
          {value}
        </span>
      </Link>
    </li>
  );
}
