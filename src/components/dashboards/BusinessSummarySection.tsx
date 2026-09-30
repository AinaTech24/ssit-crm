import Link from "next/link";
import { formatINR } from "@/lib/utils";

/**
 * BusinessSummarySection — the firm's period business MIS, sourced from the
 * Transactions ledger (mutual-fund lines by asset class + txn type, and
 * PMS/AIF/SIF by product type) plus the Insurance module (new annual premium).
 *
 * Definitions (kept visible in the footnote so the owner knows exactly what
 * each figure means and can ask for a change):
 *   Purchase   = fresh + additional + switch/STP-in   (money into an asset class)
 *   Redemption = redemption/SWP + switch/STP-out       (money out of an asset class)
 *   Net        = Purchase − Redemption
 * All figures are BOOKED business (business_entries, status ≠ cancelled) by
 * business date, scoped to the dashboard's selected period.
 */

export type BusinessSummaryData = {
  newSip: number;
  sipStop: number;
  eqPur: number;
  eqRed: number;
  liqPur: number;
  liqRed: number;
  totalPur: number;
  pms: number;
  aif: number;
  sif: number;
  insPremium: number;
  insCount: number;
};

type Tone = "muted" | "emerald" | "rose" | "brand";

function Tile({
  label,
  value,
  tone = "muted",
  strong = false,
  sub,
}: {
  label: string;
  value: number;
  tone?: Tone;
  strong?: boolean;
  sub?: string;
}) {
  const toneCls =
    tone === "emerald"
      ? "text-emerald-600"
      : tone === "rose"
        ? "text-rose-600"
        : tone === "brand"
          ? "text-brand-cyan-deep"
          : "text-foreground";
  return (
    <div
      className={`rounded-xl border px-3.5 py-2.5 ${
        strong ? "border-brand-cyan/40 bg-brand-cyan-light/25" : "border-border bg-card"
      }`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground truncate" title={label}>
        {label}
      </div>
      <div className={`mt-0.5 text-base font-bold tabular-nums ${toneCls}`}>{formatINR(value)}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

const netTone = (n: number): Tone => (n > 0 ? "emerald" : n < 0 ? "rose" : "muted");
const SubLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-1.5">{children}</div>
);

export function BusinessSummarySection({
  periodLabel,
  reportHref,
  entriesHref,
  d,
}: {
  periodLabel: string;
  reportHref: string;
  entriesHref: string;
  d: BusinessSummaryData;
}) {
  const netSip = d.newSip - d.sipStop;
  const netEq = d.eqPur - d.eqRed;
  const netLiq = d.liqPur - d.liqRed;
  const anything =
    d.newSip || d.sipStop || d.eqPur || d.eqRed || d.liqPur || d.liqRed || d.pms || d.aif || d.sif || d.insPremium;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full brand-bar" />
          <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/70">
            Business summary — {periodLabel}
          </h2>
        </div>
        <Link href={reportHref} className="text-xs text-brand-cyan-deep hover:underline font-medium">
          Net-sales report →
        </Link>
      </div>

      {!anything ? (
        <div className="card-surface p-6 text-center text-sm text-muted-foreground">
          No business booked in {periodLabel}.{" "}
          <Link href={entriesHref} className="text-brand-cyan-deep hover:underline font-medium">
            Add a business entry →
          </Link>
        </div>
      ) : (
        <div className="card-surface p-4 space-y-3.5">
          {/* SIP */}
          <div>
            <SubLabel>SIP (monthly)</SubLabel>
            <div className="grid grid-cols-3 gap-2.5">
              <Tile label="New SIP" value={d.newSip} />
              <Tile label="SIP Stop" value={d.sipStop} tone={d.sipStop > 0 ? "rose" : "muted"} />
              <Tile label="Net SIP" value={netSip} tone={netTone(netSip)} strong />
            </div>
          </div>

          {/* Equity */}
          <div>
            <SubLabel>Equity</SubLabel>
            <div className="grid grid-cols-3 gap-2.5">
              <Tile label="Equity Purchase" value={d.eqPur} />
              <Tile label="Equity Redemption" value={d.eqRed} tone={d.eqRed > 0 ? "rose" : "muted"} />
              <Tile label="Net Equity" value={netEq} tone={netTone(netEq)} strong />
            </div>
          </div>

          {/* Liquid */}
          <div>
            <SubLabel>Liquid</SubLabel>
            <div className="grid grid-cols-3 gap-2.5">
              <Tile label="Liquid Purchase" value={d.liqPur} />
              <Tile label="Liquid Redemption" value={d.liqRed} tone={d.liqRed > 0 ? "rose" : "muted"} />
              <Tile label="Net Liquid" value={netLiq} tone={netTone(netLiq)} strong />
            </div>
          </div>

          {/* Total + other products */}
          <div>
            <SubLabel>Total &amp; other products</SubLabel>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
              <Tile label="Total Business (Equity + Liquid)" value={d.totalPur} tone="brand" strong />
              <Tile label="PMS" value={d.pms} />
              <Tile label="AIF" value={d.aif} />
              <Tile label="SIF" value={d.sif} />
              <Tile
                label="Insurance Business"
                value={d.insPremium}
                sub={d.insCount ? `${d.insCount} ${d.insCount === 1 ? "policy" : "policies"}` : undefined}
              />
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground/80 leading-relaxed pt-0.5 border-t border-border/60">
            Booked business by business date (excludes cancelled entries). Purchase = fresh + additional +
            switch/STP-in; Redemption = redemption/SWP + switch/STP-out; Net = Purchase − Redemption. Total Business
            = all mutual-fund purchases (incl. equity &amp; liquid). PMS / AIF / SIF are gross business booked;
            Insurance Business is new annual premium (policies starting in this period).
          </p>
        </div>
      )}
    </div>
  );
}
