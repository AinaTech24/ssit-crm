"use client";

import { useState } from "react";
import { ShieldAlert, Loader2, Sparkles, Phone, MessageCircle, Mail, CalendarDays } from "lucide-react";
import type { ChurnResult } from "@/lib/churn/score";
import { churnBandClasses } from "@/lib/churn/score";

type Retention = {
  summary: string;
  talkingPoints: string[];
  actions: string[];
  suggestedChannel: "call" | "whatsapp" | "email" | "meeting";
};

const CHANNEL_ICON = {
  call: Phone,
  whatsapp: MessageCircle,
  email: Mail,
  meeting: CalendarDays,
} as const;

/**
 * Churn-risk card on the investor 360. Shows the explainable score + factors,
 * and (for medium/high risk) a button to fetch an AI-suggested retention play.
 * The score is deterministic; the AI play is advisory.
 */
export function ChurnRiskCard({
  result,
  investorId,
  name,
  serviceTier,
  currentValueInr,
}: {
  result: ChurnResult;
  investorId: string;
  name: string;
  serviceTier?: string | null;
  currentValueInr?: number | null;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [play, setPlay] = useState<Retention | null>(null);
  const cls = churnBandClasses(result.band);

  async function suggest() {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/ai/retention-action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          investorId,
          name,
          score: result.score,
          band: result.band,
          factors: result.factors.map((f) => ({ label: f.label, why: f.why })),
          serviceTier: serviceTier ?? null,
          currentValueInr: currentValueInr ?? null,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Could not generate a retention play");
        return;
      }
      setPlay(j);
    } finally {
      setBusy(false);
    }
  }

  const ChannelIcon = play ? CHANNEL_ICON[play.suggestedChannel] : null;

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <ShieldAlert className="size-4 text-rose-500" />
          Churn risk
        </h3>
        <div className="flex items-center gap-2">
          <span className={`chip border ${cls.chip}`}>{cls.label}</span>
          <span className="text-sm font-bold tabular-nums">{result.score}</span>
        </div>
      </div>

      <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
        <div className={`h-full ${cls.bar}`} style={{ width: `${result.score}%` }} />
      </div>

      {result.factors.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {result.factors.map((f) => (
            <li key={f.key} className="flex items-start gap-2 text-xs">
              <span className="mt-1 size-1.5 rounded-full bg-rose-400 shrink-0" />
              <span>
                <span className="font-medium">{f.label}</span>
                <span className="text-muted-foreground"> — {f.why}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          No churn signals — this is a sticky client. Keep the relationship warm.
        </p>
      )}

      {result.band !== "low" && (
        <div className="mt-4 pt-4 border-t">
          {!play && (
            <button onClick={suggest} disabled={busy} className="btn-secondary text-xs">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              Suggest a retention play
            </button>
          )}
          {err && <p className="text-xs text-destructive mt-2">{err}</p>}
          {play && (
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-2">
                {ChannelIcon && <ChannelIcon className="size-4 mt-0.5 text-brand-cyan shrink-0" />}
                <p className="leading-relaxed">{play.summary}</p>
              </div>
              {play.talkingPoints.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Talking points</div>
                  <ul className="space-y-1">
                    {play.talkingPoints.map((t, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs">
                        <span className="mt-1 size-1.5 rounded-full bg-brand-cyan shrink-0" />
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {play.actions.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Next steps</div>
                  <ul className="space-y-1">
                    {play.actions.map((a, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs">
                        <span className="mt-1 size-1.5 rounded-full bg-emerald-500 shrink-0" />
                        {a}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground italic">AI suggestion — review before acting. No assured returns / inducements (SEBI).</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
