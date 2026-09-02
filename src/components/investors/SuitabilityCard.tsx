import { ShieldCheck, AlertTriangle, HelpCircle } from "lucide-react";

/**
 * Risk-suitability card for the investor-360 page. Shows a severity-coloured
 * status badge and, when an equity exposure and a comfort band are known,
 * a thin horizontal exposure bar with the band shaded and a marker at the
 * client's current equity percentage.
 *
 * Presentational (server-rendered) — no client interactivity.
 */

type Severity = "ok" | "warn" | "breach" | "unknown";

const SEVERITY_STYLES: Record<
  Severity,
  { badge: string; tile: string; icon: string; label: string }
> = {
  ok: {
    badge: "bg-emerald-50 text-emerald-700",
    tile: "bg-emerald-50",
    icon: "text-emerald-700",
    label: "On track",
  },
  warn: {
    badge: "bg-amber-50 text-amber-700",
    tile: "bg-amber-50",
    icon: "text-amber-700",
    label: "Watch",
  },
  breach: {
    badge: "bg-rose-50 text-rose-700",
    tile: "bg-rose-50",
    icon: "text-rose-700",
    label: "Breach",
  },
  unknown: {
    badge: "bg-slate-100 text-slate-600",
    tile: "bg-slate-100",
    icon: "text-slate-500",
    label: "Unknown",
  },
};

function humanizeProfile(profile: string): string {
  return profile
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function SeverityIcon({
  severity,
  className,
}: {
  severity: Severity;
  className?: string;
}) {
  if (severity === "ok") return <ShieldCheck className={className} />;
  if (severity === "unknown") return <HelpCircle className={className} />;
  return <AlertTriangle className={className} />;
}

export function SuitabilityCard({
  suitability,
}: {
  suitability: {
    severity: Severity;
    message: string;
    equityPct: number | null;
    profile: string | null;
    band: { floor: number; ceiling: number } | null;
  };
}) {
  const { severity, message, equityPct, profile, band } = suitability;
  const styles = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.unknown;
  const showBar = equityPct != null && band != null;

  const clamp = (v: number) => Math.max(0, Math.min(100, v));

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center justify-between mb-3 gap-3">
        <h2 className="font-semibold flex items-center gap-2">
          <div className={`size-7 rounded-lg ${styles.tile} grid place-items-center`}>
            <SeverityIcon severity={severity} className={`size-3.5 ${styles.icon}`} />
          </div>
          Risk suitability
        </h2>
        <span
          className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${styles.badge}`}
        >
          <SeverityIcon severity={severity} className="size-3" />
          {styles.label}
        </span>
      </div>

      <p className="text-sm text-muted-foreground leading-relaxed">{message}</p>

      {showBar && band && equityPct != null && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="font-medium">
              Equity exposure {equityPct.toFixed(0)}%
            </span>
            {profile && (
              <span className="text-muted-foreground">
                {humanizeProfile(profile)} band {band.floor}–{band.ceiling}%
              </span>
            )}
          </div>
          <div className="relative h-2 rounded-full bg-secondary overflow-hidden">
            {/* Comfort band */}
            <div
              className="absolute inset-y-0 bg-emerald-200/70"
              style={{
                left: `${clamp(band.floor)}%`,
                width: `${clamp(band.ceiling) - clamp(band.floor)}%`,
              }}
            />
          </div>
          {/* Marker at current equity exposure */}
          <div className="relative h-0">
            <div
              className="absolute -top-2.5 -translate-x-1/2"
              style={{ left: `${clamp(equityPct)}%` }}
            >
              <div className="size-1.5 rounded-full bg-foreground" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
