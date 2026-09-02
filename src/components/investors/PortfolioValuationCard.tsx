import { TrendingUp, TrendingDown, Activity, Info } from "lucide-react";
import { formatINR } from "@/lib/utils";
import type { InvestorValuation } from "@/lib/finance/valuation";

/**
 * Live portfolio valuation card — current market value (units × latest AMFI
 * NAV), net invested, gain, absolute return and XIRR. Returns + gain are
 * computed over PRICED holdings only; any scheme we couldn't price is surfaced
 * as a coverage gap so the percentages are never quietly distorted.
 *
 * Presentational (server-rendered) — no client interactivity needed.
 */
export function PortfolioValuationCard({
  valuation,
}: {
  valuation: InvestorValuation;
}) {
  const {
    currentValue,
    pricedInvested,
    gain,
    absoluteReturn,
    xirr,
    asOf,
    holdings,
    unpricedSchemes,
    unpricedInvested,
  } = valuation;

  // Nothing to show — no completed transactions at all.
  if (currentValue <= 0 && holdings.length === 0) return null;

  const up = gain >= 0;
  const pct = (v: number | null) =>
    v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Activity className="size-4 text-primary" />
          Live portfolio value
        </h3>
        {asOf && (
          <span className="text-[11px] text-muted-foreground">
            NAV as of {asOf}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <div className="text-xs text-muted-foreground">Current value</div>
          <div className="text-2xl font-bold tabular-nums">
            {formatINR(Math.round(currentValue))}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Invested</div>
          <div className="text-2xl font-bold tabular-nums">
            {formatINR(Math.round(pricedInvested))}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Unrealised gain</div>
          <div
            className={`text-2xl font-bold tabular-nums flex items-center gap-1 ${
              up ? "text-emerald-600" : "text-red-600"
            }`}
          >
            {up ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
            {formatINR(Math.round(Math.abs(gain)))}
          </div>
          <div className={`text-xs ${up ? "text-emerald-600" : "text-red-600"}`}>
            {pct(absoluteReturn)} absolute
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">XIRR</div>
          <div
            className={`text-2xl font-bold tabular-nums ${
              xirr == null ? "" : xirr >= 0 ? "text-emerald-600" : "text-red-600"
            }`}
          >
            {pct(xirr)}
          </div>
          <div className="text-xs text-muted-foreground">annualised</div>
        </div>
      </div>

      {unpricedSchemes > 0 && (
        <div className="mt-3 flex items-start gap-2 text-[11px] text-muted-foreground bg-muted/50 rounded p-2">
          <Info className="size-3.5 mt-0.5 shrink-0" />
          <span>
            {unpricedSchemes} scheme{unpricedSchemes > 1 ? "s" : ""} ({formatINR(Math.round(unpricedInvested))} invested)
            couldn&apos;t be priced — no matching AMFI scheme code. Returns above exclude these.
            Importing folios with AMFI codes / ISINs resolves them automatically.
          </span>
        </div>
      )}
    </div>
  );
}
