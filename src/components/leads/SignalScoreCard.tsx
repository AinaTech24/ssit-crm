/**
 * SignalScoreCard — behavioural engagement score for a lead (Zoho scoring
 * parity). Server component: computes the signal bonus + breakdown and renders
 * a compact card on the lead detail.
 */

import { Activity, Flame } from "lucide-react";
import { withTenant } from "@/db/client";
import { leadSignalScore, type SignalScore } from "@/lib/leads/signal-score";

const BAND_TONE: Record<string, string> = { hot: "bg-rose-50 text-rose-700", warm: "bg-amber-50 text-amber-700", cold: "bg-slate-100 text-slate-600" };

export async function SignalScoreCard({ session, leadId }: { session: { tenantId: string; userId: string; branchId?: string | null; roles: string[] }; leadId: string }) {
  const score: SignalScore = await withTenant(
    session.tenantId,
    (tx) => leadSignalScore(tx as any, { tenantId: session.tenantId, leadId }),
    { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles }
  );

  // Empty state — keep it to a single slim line so it doesn't eat a whole card
  // when there's nothing to show yet.
  if (score.lines.length === 0) {
    return (
      <div className="border rounded-lg bg-card px-4 py-2.5 flex items-center gap-2 text-xs text-muted-foreground">
        <Activity className="size-4 text-brand-cyan shrink-0" />
        <span><span className="font-medium text-foreground">Engagement signals:</span> none yet — log a call, message, or meeting to build this lead&apos;s behavioural score.</span>
      </div>
    );
  }

  return (
    <div className="border rounded-lg bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-sm flex items-center gap-2"><Activity className="size-4 text-brand-cyan" /> Engagement signals</div>
        <span className={`chip text-[11px] capitalize inline-flex items-center gap-1 ${BAND_TONE[score.band]}`}><Flame className="size-3" /> {score.band} · +{score.total}</span>
      </div>
      {score.lines.length === 0 ? (
        <p className="text-xs text-muted-foreground">No engagement signals yet — log a call, message, or meeting to build this lead&apos;s behavioural score.</p>
      ) : (
        <ul className="space-y-1">
          {score.lines.map((l) => (
            <li key={l.label} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{l.label} <span className="opacity-60">×{l.count}</span></span>
              <span className="font-semibold tabular-nums text-emerald-700">+{l.points}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-muted-foreground mt-2 italic">Behavioural bonus on top of the deterministic lead score.</p>
    </div>
  );
}
