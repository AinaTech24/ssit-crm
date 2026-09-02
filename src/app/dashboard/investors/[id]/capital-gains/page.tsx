import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { investors, tenants } from "@/db/schema";
import { computeRealizedGains, currentFyStartYear } from "@/lib/tax/realized-gains";
import { formatINR } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CapitalGainsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  const cur = currentFyStartYear();
  const fy = Number(sp.fy) > 2000 ? Number(sp.fy) : cur;

  const data = await withTenant(session.tenantId, async (tx) => {
    const [inv] = await tx
      .select({ name: investors.name, pan: investors.pan })
      .from(investors)
      .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
      .limit(1);
    if (!inv) return null;
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
    const g = await computeRealizedGains(tx, id, fy);
    return { inv, tenant: t as any, g };
  });

  if (!data) return <div className="p-6">Client not found.</div>;
  const { inv, tenant, g } = data;
  const years = [cur, cur - 1, cur - 2, cur - 3];

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-5 print:p-0">
      <div className="flex items-start justify-between gap-3 flex-wrap print:hidden">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Capital Gains Statement</h1>
          <p className="text-muted-foreground text-sm">
            Realized STCG/LTCG (FIFO) for {inv.name}. Use Ctrl/Cmd+P to save as PDF.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {years.map((y) => (
            <Link
              key={y}
              href={`/dashboard/investors/${id}/capital-gains?fy=${y}`}
              className={`text-xs px-2.5 py-1 rounded-md border ${y === fy ? "bg-brand-cyan text-white border-brand-cyan" : "hover:bg-muted"}`}
            >
              FY{y}-{String(y + 1).slice(-2)}
            </Link>
          ))}
        </div>
      </div>

      {/* Print header */}
      <div className="hidden print:block mb-3">
        <div className="font-bold text-lg">{tenant?.displayName ?? tenant?.legalName}</div>
        <div className="text-xs text-muted-foreground">ARN {tenant?.arn ?? "—"}</div>
      </div>

      <div className="card-surface p-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="font-semibold">{inv.name}</div>
            {inv.pan && <div className="text-xs text-muted-foreground font-mono">PAN {inv.pan}</div>}
          </div>
          <div className="text-sm font-semibold">{g.fyLabel}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Short-term gains" value={formatINR(g.stcg)} tone={g.stcg >= 0 ? "emerald" : "rose"} />
        <Kpi label="Long-term gains" value={formatINR(g.ltcg)} tone={g.ltcg >= 0 ? "emerald" : "rose"} />
        <Kpi label={`LTCG taxable (after ₹${(g.ltcgExemption / 100000).toFixed(2)}L)`} value={formatINR(g.ltcgTaxable)} />
        <Kpi label="Total proceeds" value={formatINR(g.totalProceeds)} />
      </div>

      <div className="card-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b">
              <th className="px-3 py-2">Scheme</th>
              <th className="px-3 py-2">Bought</th>
              <th className="px-3 py-2">Sold</th>
              <th className="px-3 py-2 text-right">Units</th>
              <th className="px-3 py-2 text-right">Buy NAV</th>
              <th className="px-3 py-2 text-right">Sell NAV</th>
              <th className="px-3 py-2 text-right">Gain</th>
              <th className="px-3 py-2">Term</th>
            </tr>
          </thead>
          <tbody>
            {g.rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                  No redemptions settled in {g.fyLabel} — nothing realized.
                </td>
              </tr>
            )}
            {g.rows.map((r, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="px-3 py-2">{r.schemeName ?? r.schemeCode ?? "—"}</td>
                <td className="px-3 py-2">{fmt(r.buyDate)}</td>
                <td className="px-3 py-2">{fmt(r.sellDate)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.units.toLocaleString("en-IN", { maximumFractionDigits: 3 })}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.buyNav.toFixed(2)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.sellNav.toFixed(2)}</td>
                <td className={`px-3 py-2 text-right tabular-nums font-medium ${r.gain >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {formatINR(r.gain)}
                </td>
                <td className="px-3 py-2 uppercase text-[11px] font-semibold">{r.term}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        {tenant?.legalName ?? tenant?.displayName} · ARN {tenant?.arn ?? "—"}. Indicative statement computed by FIFO lot matching
        on recorded transactions priced at transaction NAV; equity holding-period rules applied (&gt;12 months = long term).
        Grandfathering (NAV as on 31-Jan-2018) and the equity-vs-debt distinction are not applied — please reconcile against your
        AMC/RTA statement before filing. Not tax advice.
      </p>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "rose" }) {
  const color = tone === "emerald" ? "text-emerald-600" : tone === "rose" ? "text-rose-600" : "";
  return (
    <div className="card-surface p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
    </div>
  );
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}
