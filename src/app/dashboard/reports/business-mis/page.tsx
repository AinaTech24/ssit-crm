import Link from "next/link";
import { ChevronLeft, Info } from "lucide-react";
import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { MisFyPicker } from "@/components/reports/MisFyPicker";
import {
  buildMisSummary,
  MIS_MONTH_LABELS,
  type MisLine,
  type MisFolio,
  type MisTarget,
  type MisCell,
} from "@/lib/business/mis";

export const dynamic = "force-dynamic";

const money = (n: number) =>
  (n < 0 ? "−₹" : "₹") + Math.abs(Math.round(n)).toLocaleString("en-IN");

/** Current Indian FY as 'YYYY-YY' — Apr-start. */
function currentFy(): string {
  const d = new Date();
  const startYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}
function fyOptions(): string[] {
  const cur = parseInt(currentFy().slice(0, 4), 10);
  return Array.from({ length: 6 }, (_, i) => {
    const y = cur - i;
    return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  });
}

export default async function BusinessMisPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>;
}) {
  const session = await requireSession();
  // Manager-grade MIS (renders firm financials inline) — restrict to the report
  // audience. The area layout admits RMs for their own tools, so this page must
  // gate itself.
  if (
    !can(session.roles, "reports.business", session.permissions) &&
    !can(session.roles, "reports.manage", session.permissions)
  ) {
    redirect("/dashboard");
  }
  const sp = await searchParams;
  const opts = fyOptions();
  const fy = sp.fy && opts.includes(sp.fy) ? sp.fy : currentFy();
  const startYear = parseInt(fy.slice(0, 4), 10);
  const start = `${startYear}-04-01`;
  const end = `${startYear + 1}-04-01`;

  const data = await withTenant(session.tenantId, async (tx) => {
    const lineRows = await tx.execute(sql`
      SELECT be.product_type AS "productType",
             be.business_date AS "businessDate",
             COALESCE(bel.asset_class, 'other') AS "assetClass",
             bel.txn_type AS "txnType",
             bel.amount AS amount
      FROM business_entries be
      JOIN business_entry_lines bel ON bel.entry_id = be.id
      WHERE be.tenant_id = ${session.tenantId}
        AND be.status IN ('confirmed', 'emailed')
        AND be.business_date >= ${start} AND be.business_date < ${end}
    `);
    const folioRows = await tx.execute(sql`
      SELECT aum, schemes FROM folios WHERE tenant_id = ${session.tenantId}
    `);
    const targetRows = await tx.execute(sql`
      SELECT metric, annual_target AS "annualTarget"
      FROM business_targets
      WHERE tenant_id = ${session.tenantId} AND fiscal_year = ${fy}
    `);
    return {
      lines: lineRows.rows as unknown as MisLine[],
      folios: (folioRows.rows as Array<{ aum: unknown; schemes: unknown }>).map((r) => ({
        aum: Number(r.aum ?? 0),
        schemes: (r.schemes as MisFolio["schemes"]) ?? null,
      })),
      targets: (targetRows.rows as Array<{ metric: string; annualTarget: unknown }>).map((r) => ({
        metric: r.metric,
        annualTarget: Number(r.annualTarget ?? 0),
      })) as MisTarget[],
    };
  });

  const mis = buildMisSummary({ fy, lines: data.lines, folios: data.folios, targets: data.targets });
  const hasData = mis.products.length > 0 || mis.totalAum > 0;

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="print:hidden">
        <Link
          href="/dashboard/reports"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"
        >
          <ChevronLeft className="size-3.5" /> Reports &amp; MIS
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Results MIS — Business Summary</h1>
        <p className="text-muted-foreground text-sm">
          Product × asset-class AUM, Gross Sales, Redemption and Net Sales for the full financial
          year. Flows come from Transactions; AUM from your RTA-imported folios.
        </p>
      </div>

      <MisFyPicker fy={fy} options={opts} />

      {/* Headline strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Headline label="AUM (RTA)" value={money(mis.totalAum)} tone="cyan" />
        <Headline label="Gross Sales" value={money(mis.grandTotal.gross)} />
        <Headline label="Redemption" value={money(mis.grandTotal.redemption)} tone="rose" />
        <Headline
          label="Net Sales"
          value={money(mis.grandTotal.net)}
          tone={mis.grandTotal.net >= 0 ? "emerald" : "rose"}
        />
      </div>

      {!hasData ? (
        <div className="rounded-xl border border-border p-10 text-center text-sm text-muted-foreground">
          No confirmed business entries or imported folios for FY {fy}.
        </div>
      ) : (
        <>
          {/* Results grid — one block per product */}
          <div className="card-surface table-scroll">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="text-xs text-muted-foreground text-left border-b border-border">
                  <th className="py-2 px-3">Product / Asset class</th>
                  <th className="py-2 px-3 text-right">AUM</th>
                  <th className="py-2 px-3 text-right">Gross Sales</th>
                  <th className="py-2 px-3 text-right">Redemption</th>
                  <th className="py-2 px-3 text-right">Net Sales</th>
                </tr>
              </thead>
              <tbody>
                {mis.products.map((p) => (
                  <ProductBlock key={p.key} label={p.label} rows={p.rows} subtotal={p.subtotal} />
                ))}
                <tr className="border-t-2 border-foreground/40 font-bold bg-muted/40">
                  <td className="py-2 px-3">Grand Total</td>
                  <Cells c={mis.grandTotal} />
                </tr>
              </tbody>
            </table>
          </div>

          {/* Monthly Net Sales */}
          <div className="card-surface p-4 overflow-x-auto">
            <h2 className="text-sm font-semibold mb-2">Net Sales by month</h2>
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  {MIS_MONTH_LABELS.map((m) => (
                    <th key={m} className="py-1 px-2 text-right font-medium">
                      {m}
                    </th>
                  ))}
                  <th className="py-1 px-2 text-right font-semibold">FY</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  {mis.monthlyNet.map((v, i) => (
                    <td
                      key={i}
                      className={`py-1.5 px-2 text-right tabular-nums ${v < 0 ? "text-rose-600" : ""}`}
                    >
                      {v ? money(v) : "—"}
                    </td>
                  ))}
                  <td className="py-1.5 px-2 text-right tabular-nums font-semibold">
                    {money(mis.grandTotal.net)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Plan vs Actual */}
          {mis.planVsActual.length > 0 && (
            <div className="card-surface p-4">
              <h2 className="text-sm font-semibold mb-3">Plan vs Actual</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {mis.planVsActual.map((m) => {
                  const pct = m.plan > 0 ? (m.actual / m.plan) * 100 : null;
                  return (
                    <div key={m.metric} className="rounded-lg border border-border p-3">
                      <div className="text-xs text-muted-foreground">{m.label}</div>
                      <div className="mt-1 flex items-baseline justify-between">
                        <span className="font-semibold tabular-nums">{money(m.actual)}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          / {m.plan > 0 ? money(m.plan) : "no target"}
                        </span>
                      </div>
                      {pct != null && (
                        <div className="mt-2">
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full ${pct >= 100 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-rose-500"}`}
                              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                            />
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-1 tabular-nums">
                            {pct.toFixed(0)}% of plan
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
        <Info className="size-3.5 shrink-0 mt-px" />
        AUM is sourced from RTA-imported folios (CAMS / Kfintech) and split by scheme category, so
        it reflects mutual-fund holdings. Gross / Redemption / Net Sales are derived from confirmed
        Transactions (switch &amp; STP count as gross; SIP-stop is excluded). Net Sales = Gross −
        Redemption.
      </p>
    </div>
  );
}

function Headline({ label, value, tone }: { label: string; value: string; tone?: "cyan" | "rose" | "emerald" }) {
  const toneCls =
    tone === "cyan" ? "text-cyan-700" : tone === "rose" ? "text-rose-600" : tone === "emerald" ? "text-emerald-600" : "";
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${toneCls}`}>{value}</div>
    </div>
  );
}

function Cells({ c }: { c: MisCell }) {
  return (
    <>
      <td className="py-2 px-3 text-right tabular-nums">{c.aum ? money(c.aum) : "—"}</td>
      <td className="py-2 px-3 text-right tabular-nums">{c.gross ? money(c.gross) : "—"}</td>
      <td className="py-2 px-3 text-right tabular-nums">{c.redemption ? money(c.redemption) : "—"}</td>
      <td className={`py-2 px-3 text-right tabular-nums ${c.net < 0 ? "text-rose-600" : ""}`}>
        {c.net ? money(c.net) : "—"}
      </td>
    </>
  );
}

function ProductBlock({
  label,
  rows,
  subtotal,
}: {
  label: string;
  rows: { label: string; aum: number; gross: number; redemption: number; net: number }[];
  subtotal: MisCell;
}) {
  return (
    <>
      <tr className="border-t border-border bg-muted/30 font-semibold">
        <td className="py-1.5 px-3" colSpan={5}>
          {label}
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.label} className="border-t border-border/40">
          <td className="py-1.5 px-3 pl-6 text-muted-foreground">{r.label}</td>
          <Cells c={r} />
        </tr>
      ))}
      <tr className="border-t border-border/60 text-[13px] font-medium">
        <td className="py-1.5 px-3 pl-3">Sub-total — {label}</td>
        <Cells c={subtotal} />
      </tr>
    </>
  );
}
