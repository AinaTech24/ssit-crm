import Link from "next/link";
import {
  IndianRupee,
  Percent,
  Crown,
  AlertTriangle,
  Info,
  PieChart,
  Landmark,
  FileUp,
} from "lucide-react";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatINR } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ALLOWED = ["owner", "branch_head", "compliance"];

/** Compact INR for big AUM numbers: ₹1.24 Cr / ₹4.50 L / ₹12,300. */
function formatCr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return formatINR(n);
}

function formatMonth(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" }).format(d);
}

// ── Data shapes ─────────────────────────────────────────────────────────────

type AmcRate = {
  amcCode: string;
  periodStart: string;
  periodEnd: string;
  stmtAum: number; // AUM as stated on the brokerage statement (period avg)
  periodBrokerage: number; // brokerage earned in that period
  annualRate: number; // blended annual trail rate, fraction (0.0072 = 72 bps)
  fromTrailRows: boolean; // derived from trail-typed rows vs all rows
};

type ClientRow = {
  investorId: string;
  name: string;
  aum: number;
  estTrail: number; // estimated annual trail, ₹
  approxAum: number; // portion of AUM priced at the firm-wide fallback rate
  bps: number; // effective annual bps on this client's AUM
};

type ReportData = {
  hasBrokerage: boolean;
  latestPeriodEnd: string | null;
  amcRates: AmcRate[];
  firmFallbackRate: number | null; // firm-wide blended annual rate (fraction)
  clients: ClientRow[];
  totalAum: number;
  totalTrail: number;
};

async function loadReport(
  tenantId: string,
  session: { userId: string; branchId?: string | null; roles: string[] }
): Promise<ReportData> {
  return withTenant(
    tenantId,
    async (tx) => {
      // ── 1. Blended annual trail rate per AMC, from each AMC's LATEST brokerage
      //      period in commission_rows (populated by the Monthly Brokerage
      //      Statement import — src/lib/rta/process.ts processBrokerageStatement).
      //      Rate = Σ brokerage_amount / Σ aum_amount for that period, annualised
      //      by the period length (a monthly statement × 12 — the same convention
      //      commission_records uses: expected = AUM × trail_rate / 12 per month).
      //      Trail-typed rows are preferred; if a statement labels everything
      //      generically ("other"), we fall back to all rows for that AMC.
      let brkRows: Array<Record<string, unknown>> = [];
      try {
        const res = await tx.execute(sql`
          WITH latest AS (
            SELECT upper(trim(amc_code)) AS amc, MAX(period_end) AS pe
            FROM commission_rows
            WHERE tenant_id = ${tenantId}
            GROUP BY upper(trim(amc_code))
          )
          SELECT
            upper(trim(c.amc_code)) AS amc_code,
            MIN(c.period_start)::text AS period_start,
            MAX(c.period_end)::text AS period_end,
            COALESCE(SUM(c.aum_amount) FILTER (WHERE c.brokerage_type = 'trail'), 0) AS trail_aum,
            COALESCE(SUM(c.brokerage_amount) FILTER (WHERE c.brokerage_type = 'trail'), 0) AS trail_brk,
            COALESCE(SUM(c.aum_amount), 0) AS all_aum,
            COALESCE(SUM(c.brokerage_amount), 0) AS all_brk
          FROM commission_rows c
          JOIN latest l ON l.amc = upper(trim(c.amc_code)) AND c.period_end = l.pe
          WHERE c.tenant_id = ${tenantId}
          GROUP BY upper(trim(c.amc_code))
        `);
        brkRows = res.rows as Array<Record<string, unknown>>;
      } catch (e: unknown) {
        // The commission_rows table is created lazily by the brokerage import on
        // some environments — degrade to the "no brokerage data" state, exactly
        // like the importer itself soft-skips (src/lib/rta/process.ts).
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("does not exist")) throw e;
        brkRows = [];
      }

      const amcRates: AmcRate[] = [];
      let fallbackNum = 0; // Σ annualised brokerage across AMCs
      let fallbackDen = 0; // Σ statement AUM across AMCs
      let latestPeriodEnd: string | null = null;

      for (const r of brkRows) {
        const trailAum = Number(r.trail_aum ?? 0);
        const trailBrk = Number(r.trail_brk ?? 0);
        const allAum = Number(r.all_aum ?? 0);
        const allBrk = Number(r.all_brk ?? 0);
        const fromTrailRows = trailAum > 0 && trailBrk > 0;
        const aum = fromTrailRows ? trailAum : allAum;
        const brk = fromTrailRows ? trailBrk : allBrk;
        if (aum <= 0 || brk <= 0) continue;

        // Annualise by actual period length; a normal monthly statement → ×12.
        const ps = new Date(String(r.period_start));
        const pe = new Date(String(r.period_end));
        const days = Math.max(1, Math.round((pe.getTime() - ps.getTime()) / 864e5) + 1);
        const months = Math.min(12, Math.max(1, Math.round(days / 30)));
        const annualFactor = 12 / months;

        const annualRate = (brk / aum) * annualFactor;
        const peStr = String(r.period_end);
        if (!latestPeriodEnd || peStr > latestPeriodEnd) latestPeriodEnd = peStr;

        amcRates.push({
          amcCode: String(r.amc_code),
          periodStart: String(r.period_start),
          periodEnd: peStr,
          stmtAum: aum,
          periodBrokerage: brk,
          annualRate,
          fromTrailRows,
        });
        fallbackNum += brk * annualFactor;
        fallbackDen += aum;
      }
      amcRates.sort((a, b) => b.stmtAum - a.stmtAum);
      const firmFallbackRate = fallbackDen > 0 ? fallbackNum / fallbackDen : null;
      const rateByAmc = new Map(amcRates.map((a) => [a.amcCode, a.annualRate]));

      // ── 2. Live AUM per client × AMC from open folios. Same expansion rule as
      //      the trail forecast: sum schemes[] values when present, else folio.aum.
      const folioRes = await tx.execute(sql`
        SELECT i.id AS investor_id, i.name AS investor_name,
               upper(trim(COALESCE(f.amc_code, ''))) AS amc_code,
               SUM(
                 CASE
                   WHEN COALESCE(jsonb_array_length(COALESCE(f.schemes, '[]'::jsonb)), 0) > 0
                     THEN (SELECT COALESCE(SUM(COALESCE((e->>'value')::numeric, 0)), 0)
                           FROM jsonb_array_elements(f.schemes) e)
                   ELSE COALESCE(f.aum, 0)::numeric
                 END
               ) AS aum
        FROM folios f
        JOIN investors i ON i.id = f.investor_id
        WHERE f.tenant_id = ${tenantId} AND f.closed_at IS NULL AND i.deleted_at IS NULL
        GROUP BY i.id, i.name, upper(trim(COALESCE(f.amc_code, '')))
      `);

      // ── 3. Per-client estimate: AUM in each AMC × that AMC's blended rate;
      //      AMCs with no brokerage data get the firm-wide blended rate ("~").
      const byClient = new Map<string, ClientRow>();
      for (const r of folioRes.rows as Array<Record<string, unknown>>) {
        const aum = Number(r.aum ?? 0);
        if (aum <= 0) continue;
        const id = String(r.investor_id);
        const row =
          byClient.get(id) ??
          ({ investorId: id, name: String(r.investor_name ?? "Unknown"), aum: 0, estTrail: 0, approxAum: 0, bps: 0 } as ClientRow);
        row.aum += aum;
        const amcRate = rateByAmc.get(String(r.amc_code ?? ""));
        if (amcRate != null) {
          row.estTrail += aum * amcRate;
        } else if (firmFallbackRate != null) {
          row.estTrail += aum * firmFallbackRate;
          row.approxAum += aum;
        } else {
          row.approxAum += aum; // no rate estimable at all
        }
        byClient.set(id, row);
      }

      const clients = [...byClient.values()];
      for (const c of clients) c.bps = c.aum > 0 ? (c.estTrail / c.aum) * 10000 : 0;
      clients.sort((a, b) => b.estTrail - a.estTrail || b.aum - a.aum);

      const totalAum = clients.reduce((s, c) => s + c.aum, 0);
      const totalTrail = clients.reduce((s, c) => s + c.estTrail, 0);

      return {
        hasBrokerage: amcRates.length > 0,
        latestPeriodEnd,
        amcRates,
        firmFallbackRate,
        clients,
        totalAum,
        totalTrail,
      };
    },
    { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles }
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default async function RevenueIntelligencePage() {
  const session = await requireSession();
  if (!session.roles.some((r) => ALLOWED.includes(r))) {
    return (
      <div className="max-w-2xl mx-auto mt-12 card-surface p-8 text-center">
        <AlertTriangle className="size-8 text-amber-600 mx-auto" />
        <h1 className="text-xl font-bold mt-3">Not available for your role</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Revenue intelligence is visible to owners, branch heads and compliance.
        </p>
      </div>
    );
  }

  const data = await loadReport(session.tenantId, {
    userId: session.userId,
    branchId: session.branchId,
    roles: session.roles,
  });

  const { clients, totalAum, totalTrail, hasBrokerage } = data;

  // KPI derivations
  const firmBps = totalAum > 0 ? (totalTrail / totalAum) * 10000 : 0;
  const top10Trail = clients.slice(0, 10).reduce((s, c) => s + c.estTrail, 0);
  const top10SharePct = totalTrail > 0 ? (top10Trail / totalTrail) * 100 : 0;
  const noTrailCount = clients.filter((c) => c.aum > 0 && c.estTrail <= 0).length;

  // Chip logic
  const aumSorted = [...clients.map((c) => c.aum)].sort((a, b) => a - b);
  const q75 = aumSorted.length > 0 ? aumSorted[Math.min(aumSorted.length - 1, Math.floor(aumSorted.length * 0.75))] : 0;
  const anchorIds = new Set(clients.filter((c) => c.estTrail > 0).slice(0, 5).map((c) => c.investorId));
  const isThin = (c: ClientRow) =>
    hasBrokerage && c.estTrail > 0 && q75 > 0 && c.aum >= q75 && firmBps > 0 && c.bps < 0.6 * firmBps;

  // Concentration: smallest N of clients producing ≥ 50% of estimated trail
  let concN = 0;
  let concPct = 0;
  if (totalTrail > 0) {
    let cum = 0;
    for (const c of clients) {
      cum += c.estTrail;
      concN += 1;
      if (cum / totalTrail >= 0.5) {
        concPct = (cum / totalTrail) * 100;
        break;
      }
    }
  }

  const top100 = clients.slice(0, 100);

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div>
        <h1 className="page-title">
          <PieChart className="size-6 text-brand-cyan" /> Revenue Intelligence
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Estimated trail revenue per client — who actually pays for the practice, and where big AUM earns thin trail.
        </p>
      </div>

      {clients.length === 0 ? (
        // Nothing on the book at all
        <div className="card-surface p-8 text-center">
          <IndianRupee className="size-8 text-muted-foreground mx-auto" />
          <h2 className="text-lg font-semibold mt-3">No AUM on the book yet</h2>
          <p className="text-muted-foreground text-sm mt-1 max-w-md mx-auto">
            Import folios with AUM (RTA file import or transaction feed) and upload a Monthly Brokerage
            Statement — per-client revenue estimates will appear here.
          </p>
          <Link href="/dashboard/rta-imports" className="btn-primary mt-4 inline-flex">
            Import RTA file
          </Link>
        </div>
      ) : (
        <>
          {/* Honest banner when there is AUM but no brokerage data */}
          {!hasBrokerage && (
            <div className="card-surface p-5 border border-amber-200 bg-amber-50/50">
              <div className="flex items-start gap-3">
                <FileUp className="size-5 text-amber-700 mt-0.5 flex-shrink-0" />
                <div>
                  <h2 className="font-semibold text-amber-900">No brokerage statement imported yet</h2>
                  <p className="text-sm text-amber-800/90 mt-1 max-w-2xl">
                    This report derives each AMC&apos;s real blended trail rate from your{" "}
                    <strong>Monthly Brokerage Statement</strong> (CAMS / KFintech), uploaded via RTA File
                    Imports. Without it, trail per client cannot be estimated honestly — so below is your
                    AUM-only client ranking, with trail shown as &ldquo;—&rdquo;. Upload last month&apos;s
                    brokerage file to light this up.
                  </p>
                  <Link href="/dashboard/rta-imports" className="btn-primary mt-3 inline-flex text-sm">
                    Upload brokerage statement
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* KPI strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi
              icon={<IndianRupee className="size-4" />}
              label="Est. annual trail"
              value={hasBrokerage ? formatINR(totalTrail) : "—"}
              sub={hasBrokerage ? `from ${formatMonth(data.latestPeriodEnd)} statement rates` : "needs brokerage import"}
              hero
            />
            <Kpi
              icon={<Percent className="size-4" />}
              label="Effective rate"
              value={hasBrokerage ? `${firmBps.toFixed(0)} bps` : "—"}
              sub={`on ${formatCr(totalAum)} total AUM`}
            />
            <Kpi
              icon={<Crown className="size-4" />}
              label="Top-10 client share"
              value={hasBrokerage ? `${top10SharePct.toFixed(0)}%` : "—"}
              sub="of estimated trail"
            />
            <Kpi
              icon={<AlertTriangle className="size-4" />}
              label="No estimable trail"
              value={String(noTrailCount)}
              sub="clients with AUM, no rate"
            />
          </div>

          {/* Concentration note */}
          {hasBrokerage && concN > 0 && (
            <div className="card-surface p-4 flex items-start gap-2.5">
              <Crown className="size-4 text-brand-cyan mt-0.5 flex-shrink-0" />
              <p className="text-sm">
                <span className="font-semibold">
                  Top {concN} client{concN === 1 ? "" : "s"} generate {concPct.toFixed(0)}% of your estimated trail
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  ({((concN / clients.length) * 100).toFixed(1)}% of {clients.length} clients). Protect these
                  relationships first — a single exit here moves the P&amp;L.
                </span>
              </p>
            </div>
          )}

          {/* Per-AMC blended rates (the inputs) */}
          {hasBrokerage && (
            <div className="card-surface p-5">
              <h2 className="section-title flex items-center gap-2 mb-3">
                <Landmark className="size-4 text-brand-cyan" /> Blended trail rate by AMC
                <span className="text-[11px] font-normal text-muted-foreground">
                  latest brokerage period per AMC
                </span>
              </h2>
              <div className="flex flex-wrap gap-2">
                {data.amcRates.map((a) => (
                  <div key={a.amcCode} className="rounded-lg border border-border bg-card px-3 py-2">
                    <div className="text-xs font-semibold">{a.amcCode}</div>
                    <div className="text-sm tabular-nums font-bold">
                      {(a.annualRate * 10000).toFixed(0)} bps
                      {!a.fromTrailRows && <span className="text-muted-foreground font-normal" title="Derived from all brokerage rows (no trail-typed rows in the statement)">*</span>}
                    </div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">
                      {formatMonth(a.periodEnd)} · {formatCr(a.stmtAum)} AUM
                    </div>
                  </div>
                ))}
                {data.firmFallbackRate != null && (
                  <div className="rounded-lg border border-dashed border-border bg-secondary/40 px-3 py-2">
                    <div className="text-xs font-semibold">Firm blended (fallback)</div>
                    <div className="text-sm tabular-nums font-bold">~{(data.firmFallbackRate * 10000).toFixed(0)} bps</div>
                    <div className="text-[10px] text-muted-foreground">used for AMCs without brokerage data</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Client table */}
          <div className="card-surface overflow-hidden">
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
              <h2 className="section-title">
                {hasBrokerage ? "Clients by estimated annual trail" : "Clients by AUM"}
              </h2>
              <span className="text-[11px] text-muted-foreground">
                top {top100.length} of {clients.length}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium w-10">#</th>
                    <th className="text-left py-2 font-medium">Client</th>
                    <th className="text-right py-2 font-medium">AUM</th>
                    <th className="text-right py-2 font-medium">Est. annual trail</th>
                    <th className="text-right py-2 font-medium">Eff. bps</th>
                    <th className="text-right py-2 font-medium">Share of firm</th>
                    <th className="text-left px-4 py-2 font-medium">Signals</th>
                  </tr>
                </thead>
                <tbody>
                  {top100.map((c, i) => {
                    const approx = c.approxAum > 0; // some AUM priced at the firm fallback rate
                    const share = totalTrail > 0 ? (c.estTrail / totalTrail) * 100 : 0;
                    const thin = isThin(c);
                    const anchor = anchorIds.has(c.investorId);
                    return (
                      <tr key={c.investorId} className="border-b last:border-0 hover:bg-secondary/40">
                        <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{i + 1}</td>
                        <td className="py-2.5">
                          <Link href={`/dashboard/investors/${c.investorId}`} className="font-medium hover:underline">
                            {c.name}
                          </Link>
                        </td>
                        <td className="py-2.5 text-right tabular-nums">{formatCr(c.aum)}</td>
                        <td className="py-2.5 text-right tabular-nums font-medium">
                          {hasBrokerage && c.estTrail > 0 ? (
                            <>
                              {approx && (
                                <span className="text-muted-foreground" title="Part of this AUM sits in AMCs without brokerage data — priced at the firm-wide blended rate">
                                  ~
                                </span>
                              )}
                              {formatINR(c.estTrail)}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                          {hasBrokerage && c.estTrail > 0 ? c.bps.toFixed(0) : "—"}
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                          {hasBrokerage && totalTrail > 0 ? `${share.toFixed(1)}%` : "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {anchor && (
                              <span className="chip text-[11px] bg-emerald-50 text-emerald-700" title="Top-5 trail contributor — an anchor client">
                                🏆 anchor
                              </span>
                            )}
                            {thin && (
                              <span
                                className="chip text-[11px] bg-amber-50 text-amber-700"
                                title={`Top-quartile AUM but only ${c.bps.toFixed(0)} bps vs firm average ${firmBps.toFixed(0)} bps — likely direct plans, liquid/debt-heavy, or an AMC paying below your blend`}
                              >
                                ⚠ thin trail
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Methodology footnote */}
          <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
            <Info className="size-3.5 mt-0.5 flex-shrink-0" />
            <span>
              <strong>Methodology:</strong> this is a blended-rate <em>estimate</em>, not your actual
              commission statement. For each AMC we take its latest imported Monthly Brokerage Statement
              period and compute blended rate = Σ brokerage ÷ Σ statement AUM, annualised by the period
              length (a monthly statement × 12). That rate is applied to each client&apos;s <em>current</em>{" "}
              live AUM in that AMC, so scheme-level rate differences within an AMC, upfront/B-30 incentives
              and mid-month flows are averaged away. AMCs with no brokerage data use the firm-wide blended
              rate, marked &ldquo;~&rdquo;. &ldquo;⚠ thin trail&rdquo; = AUM in the firm&apos;s top quartile
              but effective bps below 60% of the firm average. Reconcile actual receipts in{" "}
              <Link href="/dashboard/commission-reconciliation" className="underline">
                Commission Reconciliation
              </Link>
              .
            </span>
          </p>
        </>
      )}
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
  hero,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  hero?: boolean;
}) {
  return (
    <div className={hero ? "kpi-hero" : "kpi-card"}>
      <div
        className={`text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5 ${
          hero ? "opacity-90" : "text-muted-foreground"
        }`}
      >
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold mt-1.5 tabular-nums">{value}</div>
      <div className={`text-[11px] mt-0.5 ${hero ? "opacity-80" : "text-muted-foreground"}`}>{sub}</div>
    </div>
  );
}
