/**
 * SIP-bounce health for the Client 360.
 *
 * The whole platform is built around rejected-SIP automation, so an RM should
 * see a client's SIP reliability at a glance. We combine two signals:
 *   · bounces in the last 6 months  (rejected/failed SIP transactions)
 *   · the worst "consecutive failures" counter across the client's live SIPs
 *
 * A bounced SIP is the single strongest leading indicator of churn /
 * mandate trouble — surfacing it here lets the RM act before the SIP stops.
 *
 * Presentational + server-safe. The detail page computes the counts.
 */

import { AlertTriangle, CheckCircle2, Repeat } from "lucide-react";

export type SipHealth = {
  activeSips: number;
  bounces6mo: number;
  maxConsecutiveFailures: number;
  /** Monthly committed SIP amount across active SIPs (₹). */
  monthlyCommitted: number;
};

function band(h: SipHealth): "green" | "amber" | "red" {
  if (h.bounces6mo >= 2 || h.maxConsecutiveFailures >= 2) return "red";
  if (h.bounces6mo === 1 || h.maxConsecutiveFailures === 1) return "amber";
  return "green";
}

export function SipHealthCard({ health }: { health: SipHealth }) {
  // Nothing to say if the client has never had a SIP.
  if (health.activeSips === 0 && health.bounces6mo === 0) return null;

  const b = band(health);
  const tone =
    b === "red"
      ? { box: "border-rose-200 bg-rose-50/40", chip: "bg-rose-100 text-rose-700", Icon: AlertTriangle, label: "At risk" }
      : b === "amber"
      ? { box: "border-amber-200 bg-amber-50/40", chip: "bg-amber-100 text-amber-700", Icon: AlertTriangle, label: "Watch" }
      : { box: "border-emerald-200 bg-emerald-50/40", chip: "bg-emerald-100 text-emerald-700", Icon: CheckCircle2, label: "Healthy" };

  return (
    <div className={`border rounded-lg p-4 ${tone.box}`}>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold flex items-center gap-2 text-sm">
          <Repeat className="size-4" /> SIP health
        </h2>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${tone.chip}`}>
          <tone.Icon className="size-3" /> {tone.label}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3 text-center">
        <Metric value={String(health.activeSips)} label="Active SIPs" />
        <Metric
          value={String(health.bounces6mo)}
          label="Bounces · 6 mo"
          danger={health.bounces6mo > 0}
        />
        <Metric
          value={String(health.maxConsecutiveFailures)}
          label="Worst streak"
          danger={health.maxConsecutiveFailures > 0}
        />
      </div>
      {b !== "green" && (
        <p className="text-[11px] text-muted-foreground mt-2.5">
          {b === "red"
            ? "Repeated SIP failures — check the mandate / bank balance and call the client before the SIP is auto-stopped."
            : "A recent SIP bounce — a quick nudge now usually prevents the next one from failing."}
        </p>
      )}
    </div>
  );
}

function Metric({ value, label, danger }: { value: string; label: string; danger?: boolean }) {
  return (
    <div>
      <div className={`text-xl font-bold tabular-nums ${danger ? "text-rose-600" : ""}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}
