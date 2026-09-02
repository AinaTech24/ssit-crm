import { Activity, CheckCircle2 } from "lucide-react";
import {
  clientHealth,
  healthBandClasses,
  type InvestorForHealth,
} from "@/lib/investors/health";

/**
 * Client Health Card — composite score with factor breakdown.
 *
 * Pure render — caller hands over the investor row plus an optional
 * `hasOpenSrBreach` flag (computed server-side from open service requests
 * whose SLA has lapsed).
 */
export function ClientHealthCard({
  investor,
  hasOpenSrBreach = false,
}: {
  investor: InvestorForHealth & { name?: string | null };
  hasOpenSrBreach?: boolean;
}) {
  const health = clientHealth({ ...investor, hasOpenSrBreach });
  const cls = healthBandClasses(health.band);

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2">
          <div className="size-7 rounded-lg bg-emerald-50 grid place-items-center">
            <Activity className="size-3.5 text-emerald-700" />
          </div>
          Client health
        </h2>
        <span
          className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full border ${cls.chip} font-semibold`}
        >
          <span className={`size-2 rounded-full ${cls.dot}`} />
          {cls.label}
        </span>
      </div>

      <div className="flex items-center gap-4">
        {/* Big score gauge */}
        <div className="relative size-24 flex-shrink-0">
          <svg className="size-full transform -rotate-90">
            <circle
              cx="48"
              cy="48"
              r="40"
              className="stroke-slate-100 fill-none"
              strokeWidth="8"
            />
            <circle
              cx="48"
              cy="48"
              r="40"
              className={`fill-none ${
                health.band === "green"
                  ? "stroke-emerald-500"
                  : health.band === "amber"
                  ? "stroke-amber-500"
                  : "stroke-rose-500"
              }`}
              strokeWidth="8"
              strokeDasharray={`${2 * Math.PI * 40}`}
              strokeDashoffset={`${2 * Math.PI * 40 * (1 - health.score / 100)}`}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <div className="text-2xl font-bold tabular-nums">{health.score}</div>
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                / 100
              </div>
            </div>
          </div>
        </div>

        {/* Factor list */}
        <div className="flex-1 min-w-0">
          {health.factors.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="size-4" />
              <span className="font-medium">All checks green — nothing flagged.</span>
            </div>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {health.factors.slice(0, 5).map((f) => (
                <li
                  key={f.key}
                  className="flex items-start justify-between gap-3 py-0.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground/90 truncate">
                      {f.label}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {f.why}
                    </div>
                  </div>
                  <span className="text-rose-700 font-bold tabular-nums flex-shrink-0">
                    −{f.deduction}
                  </span>
                </li>
              ))}
              {health.factors.length > 5 && (
                <li className="text-[10px] text-muted-foreground italic">
                  + {health.factors.length - 5} more
                </li>
              )}
            </ul>
          )}
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed border-t border-border/40 pt-3">
        Score starts at 100 and loses points for stale contact, missed reviews,
        KYC / nominee gaps and overdue service requests — fix an item above to
        recover its points.
      </p>
    </div>
  );
}
