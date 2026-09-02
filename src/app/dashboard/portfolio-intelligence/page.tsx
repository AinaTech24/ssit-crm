import Link from "next/link";
import { PieChart, Building2, Layers, AlertTriangle, IndianRupee, Boxes, Download, UserX, BadgePercent } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { getPortfolioIntel, type Slice } from "@/lib/portfolio/intelligence";
import { PortfolioDrillBar } from "@/components/portfolio/PortfolioDrillBar";
import { DownloadButton } from "@/components/common/SecureLinkButtons";

export const dynamic = "force-dynamic";

const inr = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`);
const CLASS_COLOR: Record<string, string> = {
  Equity: "bg-emerald-500", Debt: "bg-amber-500", Hybrid: "bg-blue-500", Liquid: "bg-cyan-500",
  Commodity: "bg-orange-500", International: "bg-violet-500", Other: "bg-slate-400",
};

export default async function PortfolioIntelligencePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const canFirm = can(session.roles, "dashboard.view.owner", (session as any).permissions);
  const sp = await searchParams;
  const mine = sp.mine === "1" || !canFirm;

  const intel = await withTenant(
    session.tenantId,
    (tx) => getPortfolioIntel(tx as any, { tenantId: session.tenantId, userId: session.userId, firmWide: !mine }),
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const hrefMine = (v?: string) => (v ? "/dashboard/portfolio-intelligence?mine=1" : "/dashboard/portfolio-intelligence");

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><PieChart className="size-6 text-brand-cyan" /> Portfolio Intelligence</h1>
        </div>
        <div className="flex items-center gap-2">
          {intel.totalAum > 0 && (
            <DownloadButton url={`/api/portfolio-intelligence/export${mine ? "?mine=1" : ""}`} className="btn-secondary text-xs inline-flex items-center gap-1.5">
              <Download className="size-3.5" /> Export CSV
            </DownloadButton>
          )}
          {canFirm && (
            <div className="inline-flex rounded-lg border bg-secondary/40 p-0.5 gap-0.5 text-xs">
              <Link href={hrefMine()} className={`px-2.5 py-1 rounded-md font-medium ${!mine ? "bg-card shadow-sm" : "text-muted-foreground"}`}>Firm-wide</Link>
              <Link href={hrefMine("1")} className={`px-2.5 py-1 rounded-md font-medium ${mine ? "bg-card shadow-sm" : "text-muted-foreground"}`}>My book</Link>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={IndianRupee} label="Book AUM" value={inr(intel.totalAum)} tone="emerald" />
        <Kpi icon={Boxes} label="Folios" value={String(intel.folioCount)} />
        <Kpi icon={Building2} label="AMCs" value={String(intel.byAmc.length)} />
        <Kpi icon={Layers} label="Asset classes" value={String(intel.byClass.length)} />
      </div>

      {intel.totalAum === 0 ? (
        <div className="card-surface p-12 text-center text-sm text-muted-foreground">
          <PieChart className="size-8 mx-auto text-muted-foreground/40" />
          <div className="mt-2 font-medium">No folio holdings to analyse {mine ? "in your book" : "yet"}.</div>
          <p className="mt-1 text-xs">Holdings flow in from RTA/CAS imports. Once folios carry AUM, this page lights up.</p>
        </div>
      ) : (
        <>
          {intel.warnings.length > 0 && (
            <div className="card-surface p-4">
              <div className="font-semibold text-sm flex items-center gap-2 mb-2"><AlertTriangle className="size-4 text-amber-600" /> Concentration &amp; risk signals</div>
              <ul className="space-y-1.5">
                {intel.warnings.map((w, i) => (
                  <li key={i} className={`text-sm flex items-start gap-2 ${w.level === "high" ? "text-rose-700" : "text-amber-700"}`}>
                    <span className={`mt-1 size-1.5 rounded-full shrink-0 ${w.level === "high" ? "bg-rose-500" : "bg-amber-500"}`} />{w.text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Coverage + direct-plan signals */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Kpi icon={Layers} label="Holdings classified" value={`${intel.classifiedPct}%`} tone={intel.classifiedPct >= 80 ? "emerald" : undefined} />
            <Kpi icon={PieChart} label="AUM with detail" value={`${intel.coveragePct}%`} />
            <Kpi icon={BadgePercent} label="Direct-plan AUM" value={intel.directPlanValue > 0 ? `${inr(intel.directPlanValue)} · ${intel.directPlanPct}%` : "—"} tone={intel.directPlanPct >= 10 ? undefined : undefined} />
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            <Panel title="Asset-class allocation" icon={Layers}>
              {intel.byClass.length === 0 ? <Empty>Scheme-level category data not available yet.</Empty> : (
                <div className="space-y-2.5">
                  <StackedBar slices={intel.byClass} />
                  {intel.byClass.map((c) => (
                    <PortfolioDrillBar key={c.label} by="class" label={c.label} pct={c.pct} value={c.value} color={CLASS_COLOR[c.label] ?? "bg-slate-400"} mine={mine} />
                  ))}
                  {intel.classifiedPct < 100 && (
                    <p className="text-[11px] text-muted-foreground pt-1">{intel.classifiedPct}% of measured holdings classified · {intel.coveragePct}% of book AUM has scheme detail.</p>
                  )}
                </div>
              )}
            </Panel>

            <Panel title="AMC concentration" icon={Building2}>
              <div className="space-y-2.5">
                {intel.byAmc.slice(0, 8).map((a, i) => (
                  <PortfolioDrillBar key={a.label} by="amc" label={a.label} pct={a.pct} value={a.value} color={a.pct >= 30 ? "bg-rose-500" : a.pct >= 20 ? "bg-amber-500" : "bg-brand-cyan"} rank={i + 1} mine={mine} />
                ))}
              </div>
            </Panel>
          </div>

          {intel.concentratedClients.length > 0 && (
            <Panel title="Concentrated clients — act on these" icon={UserX}>
              <p className="text-xs text-muted-foreground mb-3">Clients whose own portfolio is over-concentrated (single AMC &gt; 40%, or equity &gt; 90%) — the firm-level risk, by name.</p>
              <div className="table-scroll">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
                    <tr><th className="text-left py-2 font-medium">Client</th><th className="text-left py-2 font-medium">Flag</th><th className="text-right py-2 font-medium pr-2">AUM</th></tr>
                  </thead>
                  <tbody>
                    {intel.concentratedClients.map((c) => (
                      <tr key={c.id} className="border-b last:border-0 hover:bg-secondary/40">
                        <td className="py-2"><Link href={`/dashboard/investors/${c.id}`} className="font-medium hover:underline">{c.name}</Link></td>
                        <td className="py-2"><span className="chip text-[10px] bg-amber-50 text-amber-700">{c.reason}</span></td>
                        <td className="py-2 text-right tabular-nums pr-2">{inr(c.aum)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          <Panel title="Top holdings" icon={PieChart}>
            {intel.topSchemes.length === 0 ? <Empty>Scheme-level holdings not available yet.</Empty> : (
              <div className="table-scroll">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
                    <tr><th className="text-left py-2 font-medium">#</th><th className="text-left py-2 font-medium">Scheme</th><th className="text-left py-2 font-medium">AMC</th><th className="text-left py-2 font-medium">Class</th><th className="text-right py-2 font-medium">Value</th><th className="text-right py-2 font-medium">% of holdings</th></tr>
                  </thead>
                  <tbody>
                    {intel.topSchemes.map((s, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2 text-muted-foreground tabular-nums">{i + 1}</td>
                        <td className="py-2 font-medium max-w-[280px] truncate">{s.scheme}</td>
                        <td className="py-2 text-xs">{s.amc ?? "—"}</td>
                        <td className="py-2"><span className={`chip text-[10px] text-white ${CLASS_COLOR[s.klass] ?? "bg-slate-400"}`}>{s.klass}</span></td>
                        <td className="py-2 text-right tabular-nums">{inr(s.value)}</td>
                        <td className="py-2 text-right tabular-nums font-semibold">{s.pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

function StackedBar({ slices }: { slices: Slice[] }) {
  return (
    <div className="flex h-3 rounded-full overflow-hidden">
      {slices.map((s) => <div key={s.label} className={CLASS_COLOR[s.label] ?? "bg-slate-400"} style={{ width: `${s.pct}%` }} title={`${s.label} ${s.pct}%`} />)}
    </div>
  );
}
function Bar({ label, pct, value, color, rank }: { label: string; pct: number; value: number; color: string; rank?: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-0.5">
        <span className="font-medium truncate">{rank ? `${rank}. ` : ""}{label}</span>
        <span className="tabular-nums text-muted-foreground">{inr(value)} · {pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-secondary overflow-hidden"><div className={`h-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
    </div>
  );
}
function Panel({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return <div className="card-surface p-5"><div className="font-semibold text-sm flex items-center gap-2 mb-3"><Icon className="size-4 text-brand-cyan" /> {title}</div>{children}</div>;
}
function Empty({ children }: { children: React.ReactNode }) { return <div className="text-xs text-muted-foreground py-4 text-center">{children}</div>; }
function Kpi({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone?: "emerald" }) {
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{label}</span><Icon className="size-3.5 text-muted-foreground" /></div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${tone === "emerald" ? "text-emerald-600" : "text-foreground"}`}>{value}</div>
    </div>
  );
}
