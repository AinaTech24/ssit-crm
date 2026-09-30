/**
 * The research view of the firm's book: how big it is, what is due review, and
 * how that splits by RM.
 *
 * Research is asked "how many clients do we cover, and whose portfolios have
 * gone unreviewed" — questions about the SHAPE of the book rather than any one
 * client. Those answers lived in three different modules, none of which a
 * research user could open.
 *
 * Read-only by construction: it counts, it does not link into anything that
 * edits. Runs under the caller's own data wall, so a research user with a
 * narrower scope sees their slice rather than the firm's.
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { Users, CalendarClock, PieChart, ArrowRight } from "lucide-react";
import { withTenant } from "@/db/client";
import { formatINR } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";
import { investorScopeSql } from "@/lib/investors/access";
import { can } from "@/lib/auth/rbac";

/** A review this far past due is the one research is being asked about. */
const REVIEW_OVERDUE_DAYS = 100;

type RmRow = {
  rm_id: string | null;
  rm_name: string | null;
  clients: number;
  aum: string | number;
  reviews_due: number;
};

export async function ResearchCoverageSection({ session }: { session: SessionUser }) {
  let totals = { clients: 0, aum: 0, reviews_due: 0, reviewed_90d: 0 };
  let byRm: RmRow[] = [];

  try {
    const data = await withTenant(session.tenantId, async (tx) => {
      // Someone holding investor.view.all is entitled to the whole book, and
      // these are aggregate counts over exactly that. The row wall exists to
      // narrow an RM to their own clients; applying it to a research user who
      // owns no clients gave a panel of zeroes, which is not the question they
      // were asking. Anyone without the capability still counts only their
      // own — investorScopeSql enforces that, RLS keeps it inside the tenant.
      const seesAll = can(session.roles, "investor.view.all", session.permissions);
      const scope = seesAll ? sql`TRUE` : await investorScopeSql(tx, session, "investors");
      const base = sql`
        investors.deleted_at IS NULL
        AND investors.status = 'active'
        AND ${scope}
      `;

      const [totalsRes, rmRes] = await Promise.all([
        tx.execute(sql`
          SELECT
            COUNT(*)::int AS clients,
            COALESCE(SUM(investors.aum::numeric), 0)::numeric AS aum,
            COUNT(*) FILTER (
              WHERE investors.next_review_at IS NOT NULL
                AND investors.next_review_at <= now() - (${REVIEW_OVERDUE_DAYS} || ' days')::interval
            )::int AS reviews_due,
            COUNT(*) FILTER (
              WHERE investors.last_review_at IS NOT NULL
                AND investors.last_review_at >= now() - interval '90 days'
            )::int AS reviewed_90d
          FROM investors
          WHERE ${base}
        `),
        // Portfolio review, RM by RM — the split research is asked for.
        tx.execute(sql`
          SELECT u.id AS rm_id, u.name AS rm_name,
                 COUNT(investors.id)::int AS clients,
                 COALESCE(SUM(investors.aum::numeric), 0)::numeric AS aum,
                 COUNT(investors.id) FILTER (
                   WHERE investors.next_review_at IS NOT NULL
                     AND investors.next_review_at <= now() - (${REVIEW_OVERDUE_DAYS} || ' days')::interval
                 )::int AS reviews_due
            FROM investors
            LEFT JOIN users u ON u.id = investors.rm_id
           WHERE ${base}
           GROUP BY u.id, u.name
           ORDER BY aum DESC NULLS LAST
           LIMIT 10
        `),
      ]);

      const t = totalsRes.rows[0] as {
        clients: number;
        aum: string;
        reviews_due: number;
        reviewed_90d: number;
      };
      return {
        totals: {
          clients: Number(t?.clients ?? 0),
          aum: Number(t?.aum ?? 0),
          reviews_due: Number(t?.reviews_due ?? 0),
          reviewed_90d: Number(t?.reviewed_90d ?? 0),
        },
        byRm: rmRes.rows as unknown as RmRow[],
      };
    });
    totals = data.totals;
    byRm = data.byRm;
  } catch {
    // A dashboard panel must never take the whole page down.
    return null;
  }

  if (totals.clients === 0) return null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat icon={Users} tone="violet" label="Clients covered" value={String(totals.clients)} />
        <Stat icon={PieChart} tone="emerald" label="AUM" value={formatINR(totals.aum)} />
        <Stat
          icon={CalendarClock}
          tone="rose"
          label={`Reviews ${REVIEW_OVERDUE_DAYS}d+ overdue`}
          value={String(totals.reviews_due)}
          alert={totals.reviews_due > 0}
        />
        <Stat icon={CalendarClock} tone="blue" label="Reviewed (90d)" value={String(totals.reviewed_90d)} />
      </div>

      <div className="border rounded-lg bg-card">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
          <div className="flex items-center gap-2">
            <div className="size-7 rounded-lg bg-violet-50 grid place-items-center">
              <PieChart className="size-3.5 text-violet-600" />
            </div>
            <div>
              <div className="font-medium text-sm">Portfolio review by RM</div>
              <div className="text-[11px] text-muted-foreground">
                Book size, AUM and what has gone unreviewed, per relationship manager
              </div>
            </div>
          </div>
          <Link
            href="/dashboard/investors?sort=review&dir=asc"
            className="text-xs text-violet-700 hover:underline font-medium inline-flex items-center gap-1"
          >
            All clients <ArrowRight className="size-3.5" />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs table-modern">
            <thead>
              <tr>
                <th className="text-left py-1.5 px-3">RM</th>
                <th className="text-right py-1.5 px-3">Clients</th>
                <th className="text-right py-1.5 px-3">AUM</th>
                <th className="text-right py-1.5 px-3">Reviews due</th>
              </tr>
            </thead>
            <tbody>
              {byRm.map((r) => (
                <tr key={r.rm_id ?? "unassigned"}>
                  <td className="py-2 px-3 font-medium">{r.rm_name ?? "Unassigned"}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.clients}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{formatINR(Number(r.aum))}</td>
                  <td
                    className={`py-2 px-3 text-right tabular-nums ${
                      Number(r.reviews_due) > 0 ? "text-rose-600 font-semibold" : ""
                    }`}
                  >
                    {r.reviews_due}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  tone,
  label,
  value,
  alert = false,
}: {
  icon: typeof Users;
  tone: string;
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className="border rounded-lg bg-card px-4 py-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className={`size-3.5 text-${tone}-600`} /> {label}
      </div>
      <div className={`text-xl font-semibold tabular-nums mt-0.5 ${alert ? "text-rose-600" : ""}`}>
        {value}
      </div>
    </div>
  );
}
