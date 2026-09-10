import { PieChart as PieChartIcon, Building2 } from "lucide-react";
import { formatINR } from "@/lib/utils";

type FolioWithSchemes = {
  amcName?: string | null;
  aum?: string | number | null;
  schemes?: Array<{
    schemeCode?: string;
    schemeName?: string;
    category?: string;
    value?: number;
  }> | null;
};

const CATEGORY_BUCKETS: Array<{
  label: string;
  match: RegExp[];
  color: string;
  bgClass: string;
}> = [
  { label: "Equity", match: [/equity/i, /large.?cap/i, /mid.?cap/i, /small.?cap/i, /flexi.?cap/i, /multi.?cap/i, /focused/i, /thematic/i, /sectoral/i], color: "#d22e32", bgClass: "bg-sky-500" },
  { label: "ELSS / Tax", match: [/elss/i, /tax.?saver/i, /tax.?save/i], color: "#8b5cf6", bgClass: "bg-violet-500" },
  { label: "Hybrid", match: [/hybrid/i, /balanced/i, /aggressive.?hybrid/i, /conservative.?hybrid/i], color: "#f59e0b", bgClass: "bg-amber-500" },
  { label: "Debt", match: [/debt/i, /bond/i, /gilt/i, /income/i, /credit.?risk/i, /short.?duration/i, /medium.?duration/i, /long.?duration/i, /banking.?psu/i], color: "#10b981", bgClass: "bg-emerald-500" },
  { label: "Liquid", match: [/liquid/i, /overnight/i, /money.?market/i, /ultra.?short/i], color: "#0d9488", bgClass: "bg-teal-500" },
  { label: "Index / ETF", match: [/index/i, /etf/i, /nifty/i, /sensex/i, /passive/i], color: "#6366f1", bgClass: "bg-indigo-500" },
  { label: "International", match: [/international/i, /global/i, /us.?\b/i, /nasdaq/i, /world/i, /emerging.?market/i], color: "#ec4899", bgClass: "bg-pink-500" },
  { label: "Gold / Other", match: [/gold/i, /silver/i, /commodity/i], color: "#f97316", bgClass: "bg-orange-500" },
];

function bucketize(category: string | undefined): string {
  if (!category) return "Other";
  for (const b of CATEGORY_BUCKETS) {
    if (b.match.some((rx) => rx.test(category))) return b.label;
  }
  return "Other";
}

export function PortfolioAllocation({
  folios,
}: {
  folios: FolioWithSchemes[];
}) {
  // Aggregate by asset-class bucket and by AMC
  const byBucket: Record<string, number> = {};
  const byAmc: Record<string, number> = {};
  let totalSchemeValue = 0;
  let totalFolioAum = 0;

  for (const f of folios) {
    const folAum = Number(f.aum ?? 0);
    totalFolioAum += folAum;
    if (f.amcName) byAmc[f.amcName] = (byAmc[f.amcName] ?? 0) + folAum;

    // Within folio.schemes — split AUM by scheme.value when present;
    // otherwise distribute the folio AUM evenly across schemes as a fallback.
    const schemes = f.schemes ?? [];
    if (schemes.length === 0) continue;
    const haveValues = schemes.some((s) => s.value && s.value > 0);
    for (const s of schemes) {
      const v = haveValues
        ? Number(s.value ?? 0)
        : folAum / schemes.length;
      if (!v || v <= 0) continue;
      const bucket = bucketize(s.category);
      byBucket[bucket] = (byBucket[bucket] ?? 0) + v;
      totalSchemeValue += v;
    }
  }

  const allocationEntries = Object.entries(byBucket)
    .map(([label, value]) => ({
      label,
      value,
      pct: totalSchemeValue > 0 ? (value / totalSchemeValue) * 100 : 0,
      meta: CATEGORY_BUCKETS.find((b) => b.label === label),
    }))
    .sort((a, b) => b.value - a.value);

  const amcEntries = Object.entries(byAmc)
    .map(([name, value]) => ({
      name,
      value,
      pct: totalFolioAum > 0 ? (value / totalFolioAum) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2">
          <div className="size-7 rounded-lg bg-violet-50 grid place-items-center">
            <PieChartIcon className="size-3.5 text-violet-700" />
          </div>
          Portfolio allocation
        </h2>
        <span className="text-xs text-muted-foreground">
          Asset class + AMC concentration
        </span>
      </div>

      {folios.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No folios yet — allocation will appear once transactions are imported.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Asset class breakdown */}
          <div>
            <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
              By asset class
            </div>
            {allocationEntries.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3">
                Folio schemes are missing asset-class metadata.
              </p>
            ) : (
              <>
                {/* Horizontal stacked bar */}
                <div className="h-3 rounded-full bg-secondary overflow-hidden flex mb-3">
                  {allocationEntries.map((e) => (
                    <div
                      key={e.label}
                      className={`${e.meta?.bgClass ?? "bg-slate-400"}`}
                      style={{ width: `${e.pct}%` }}
                      title={`${e.label}: ${e.pct.toFixed(1)}%`}
                    />
                  ))}
                </div>
                <ul className="space-y-1.5 text-xs">
                  {allocationEntries.map((e) => (
                    <li key={e.label} className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`size-2 rounded-full ${e.meta?.bgClass ?? "bg-slate-400"}`}
                        />
                        <span className="font-medium">{e.label}</span>
                      </div>
                      <span className="tabular-nums">
                        {formatINR(e.value)}{" "}
                        <span className="text-muted-foreground">· {e.pct.toFixed(1)}%</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {/* AMC concentration */}
          <div>
            <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
              <Building2 className="size-3" /> Top AMCs
            </div>
            {amcEntries.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3">
                No AMC AUM yet.
              </p>
            ) : (
              <ul className="space-y-2.5 text-xs">
                {amcEntries.map((a) => {
                  const tone =
                    a.pct > 40 ? "rose" : a.pct > 25 ? "amber" : "brand";
                  const bar =
                    tone === "rose"
                      ? "bg-rose-500"
                      : tone === "amber"
                      ? "bg-amber-500"
                      : "bg-brand-cyan";
                  const label =
                    tone === "rose"
                      ? "text-rose-700"
                      : tone === "amber"
                      ? "text-amber-700"
                      : "text-muted-foreground";
                  return (
                    <li key={a.name}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium truncate max-w-[55%]">
                          {a.name}
                        </span>
                        <span className="tabular-nums">
                          {formatINR(a.value)}{" "}
                          <span className={`font-semibold ${label}`}>
                            · {a.pct.toFixed(1)}%
                          </span>
                        </span>
                      </div>
                      <div className="h-1 rounded-full bg-secondary overflow-hidden">
                        <div
                          className={`h-full rounded-full ${bar}`}
                          style={{ width: `${Math.min(100, a.pct)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {amcEntries.length > 0 && amcEntries[0].pct > 40 && (
              <p className="text-[10px] text-rose-700 mt-2 leading-relaxed">
                ⚠ {amcEntries[0].name} holds {amcEntries[0].pct.toFixed(0)}% of
                this client's book — diversify before the next review.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
