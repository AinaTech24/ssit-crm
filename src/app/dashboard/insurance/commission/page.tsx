import Link from "next/link";
import { sql } from "drizzle-orm";
import { IndianRupee, TrendingUp, FileText, Repeat, Shield, Wallet } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { formatINR } from "@/lib/utils";
import { AddCommissionEntry } from "@/components/insurance/AddCommissionEntry";
import { CommissionLedger } from "@/components/insurance/CommissionLedger";
import { ModuleTabs, INSURANCE_TABS } from "@/components/common/ModuleTabs";

export const dynamic = "force-dynamic";

/** Indicative renewal-commission rate on annual premium (estimate; varies by line/insurer). */
const RENEWAL_RATE = 0.05;

export default async function InsuranceCommissionPage() {
  const session = await requireSession();
  // Commission is advisor/firm economics — the page had NO gate and showed the
  // WHOLE firm's earnings to any role. Require the view capability and scope
  // non-managers to their own book.
  requireCap(session.roles, "insurance.view", session.permissions);
  const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);
  const canWrite = can(session.roles, "insurance.write", session.permissions);

  const data = await withTenant(session.tenantId, async (tx) => {
    // Own-book slice for non-managers (policies they sold OR for their clients).
    const scope = seesAll
      ? sql``
      : sql` AND (sold_by_user_id = ${session.userId}::uuid OR investor_id IN (SELECT id FROM investors WHERE rm_id = ${session.userId}::uuid))`;
    const totals = (await tx.execute(sql`
      SELECT
        COALESCE(SUM(commission_paisa::numeric), 0)::numeric AS recorded,
        COUNT(*) FILTER (WHERE commission_paisa IS NOT NULL AND commission_paisa::numeric > 0)::int AS with_comm,
        COALESCE(SUM(annual_premium::numeric) FILTER (WHERE status='active'), 0)::numeric AS premium_book,
        COUNT(*) FILTER (WHERE status='active')::int AS active
      FROM insurance_policies WHERE tenant_id = ${session.tenantId}::uuid${scope}
    `)).rows[0] as any;

    const byInsurer = (await tx.execute(sql`
      SELECT insurer,
        COUNT(*)::int AS policies,
        COUNT(*) FILTER (WHERE status='active')::int AS active,
        COALESCE(SUM(annual_premium::numeric) FILTER (WHERE status='active'), 0)::numeric AS premium_book,
        COALESCE(SUM(commission_paisa::numeric), 0)::numeric AS recorded
      FROM insurance_policies WHERE tenant_id = ${session.tenantId}::uuid${scope}
      GROUP BY insurer ORDER BY premium_book DESC LIMIT 30
    `)).rows as any[];

    // Manual commission ledger — actual receipts. Scoped to own entries for
    // non-managers (matches the policy-book scope above).
    const entryScope = seesAll ? sql`` : sql` AND recorded_by_user_id = ${session.userId}::uuid`;
    const received = (await tx.execute(sql`
      SELECT COALESCE(SUM(net_amount::numeric), 0)::numeric AS net_total,
             COALESCE(SUM(net_amount::numeric) FILTER (WHERE date_trunc('year', entry_date) = date_trunc('year', current_date)), 0)::numeric AS net_ytd
      FROM insurance_commission_entries WHERE tenant_id = ${session.tenantId}::uuid${entryScope}
    `)).rows[0] as any;
    const entries = (await tx.execute(sql`
      SELECT ce.id, ce.entry_date, ce.insurer, ce.commission_type, ce.policy_number,
             ce.gross_amount, ce.tds_amount, ce.net_amount, ce.period_label, ce.reference_no,
             COALESCE(i.name, '') AS investor_name, COALESCE(u.name, '') AS recorded_by_name
      FROM insurance_commission_entries ce
      LEFT JOIN investors i ON i.id = ce.investor_id
      LEFT JOIN users u ON u.id = ce.recorded_by_user_id
      WHERE ce.tenant_id = ${session.tenantId}::uuid${entryScope}
      ORDER BY ce.entry_date DESC, ce.created_at DESC LIMIT 200
    `)).rows as any[];

    return { totals, byInsurer, received, entries };
  });

  const t = data.totals ?? {};
  const premiumBook = Number(t.premium_book ?? 0);
  const estRenewal = premiumBook * RENEWAL_RATE;
  const netReceived = Number(data.received?.net_total ?? 0);
  const netYtd = Number(data.received?.net_ytd ?? 0);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><IndianRupee className="size-6 text-brand-cyan" /> Insurance Commission</h1>
        </div>
        <div className="flex items-center gap-2">
          <AddCommissionEntry />
        </div>
      </div>

      <ModuleTabs tabs={INSURANCE_TABS} />

      <div className="card-surface table-scroll">
        <div className="px-4 py-3 border-b font-semibold text-sm flex items-center gap-2"><TrendingUp className="size-4 text-brand-cyan" /> By insurer</div>
        {data.byInsurer.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">No policies in the register yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
              <tr><th className="text-left px-4 py-2 font-medium">Insurer</th><th className="text-right py-2 font-medium">Policies</th><th className="text-right py-2 font-medium">Active</th><th className="text-right py-2 font-medium">Premium book</th><th className="text-right py-2 font-medium">Recorded comm.</th><th className="text-right py-2 font-medium pr-4">Est. renewal/yr</th></tr>
            </thead>
            <tbody>
              {data.byInsurer.map((r) => (
                <tr key={r.insurer} className="border-b last:border-0 hover:bg-secondary/40">
                  <td className="px-4 py-2.5 font-medium">{r.insurer ?? "—"}</td>
                  <td className="py-2.5 text-right tabular-nums">{r.policies}</td>
                  <td className="py-2.5 text-right tabular-nums text-muted-foreground">{r.active}</td>
                  <td className="py-2.5 text-right tabular-nums">{formatINR(Number(r.premium_book))}</td>
                  <td className="py-2.5 text-right tabular-nums text-emerald-700">{Number(r.recorded) > 0 ? formatINR(Number(r.recorded)) : "—"}</td>
                  <td className="py-2.5 text-right tabular-nums pr-4 text-emerald-700">{formatINR(Number(r.premium_book) * RENEWAL_RATE)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {/* Manual commission ledger — actual receipts */}
      <div className="card-surface table-scroll">
        <div className="px-4 py-3 border-b font-semibold text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Wallet className="size-4 text-brand-cyan" /> Commission received</span>
          <span className="text-xs text-muted-foreground font-normal">YTD net {formatINR(netYtd)}</span>
        </div>
        <CommissionLedger entries={data.entries as any} canDelete={canWrite} />
      </div>

      <p className="text-[11px] text-muted-foreground italic">
        <strong>Recorded on policies</strong> is the commission captured per policy at entry (an estimate). <strong>Commission received</strong> is the
        actual payouts you log above — net of TDS. Renewal income is an estimate at {Math.round(RENEWAL_RATE * 100)}% of active annual premium; actual rates vary by line and insurer.
      </p>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone?: "emerald" }) {
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{label}</span><Icon className="size-3.5 text-muted-foreground" /></div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${tone === "emerald" ? "text-emerald-600" : "text-foreground"}`}>{value}</div>
    </div>
  );
}
