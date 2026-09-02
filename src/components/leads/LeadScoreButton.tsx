"use client";

import { useState } from "react";
import { Sparkles, Loader2, Flame, ThermometerSun, Snowflake } from "lucide-react";

type Result = {
  score: number;
  band: "hot" | "warm" | "cold";
  reasoning: string;
  nextAction: string;
};

const BAND = {
  hot: { icon: Flame, chip: "bg-rose-50 text-rose-700 border-rose-200", label: "Hot" },
  warm: { icon: ThermometerSun, chip: "bg-amber-50 text-amber-700 border-amber-200", label: "Warm" },
  cold: { icon: Snowflake, chip: "bg-sky-50 text-sky-700 border-sky-200", label: "Cold" },
} as const;

/**
 * AI lead-score button on the lead detail page. Posts the lead's engagement
 * signals to /api/ai/lead-score and shows the score + reasoning + next action.
 * Advisory — does not persist on the lead.
 */
export function LeadScoreButton(props: {
  name: string;
  source?: string | null;
  stage?: string | null;
  ageInStageDays?: number | null;
  lastTouchDaysAgo?: number | null;
  estimatedAumInr?: number | null;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function score() {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/ai/lead-score", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: props.name,
          source: props.source ?? undefined,
          stage: props.stage ?? undefined,
          ageInStageDays: props.ageInStageDays ?? undefined,
          lastTouchDaysAgo: props.lastTouchDaysAgo ?? undefined,
          estimatedAumInr: props.estimatedAumInr ?? undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Could not score this lead");
        return;
      }
      setResult(j);
    } finally {
      setBusy(false);
    }
  }

  const b = result ? BAND[result.band] : null;
  const BandIcon = b?.icon;

  return (
    <div>
      {!result && (
        <button onClick={score} disabled={busy} className="btn-secondary text-xs">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          AI lead score
        </button>
      )}
      {err && <p className="text-xs text-destructive mt-1">{err}</p>}
      {result && b && (
        <div className="rounded-lg border bg-card p-3 text-sm space-y-2 max-w-md">
          <div className="flex items-center gap-2">
            {BandIcon && <BandIcon className="size-4" />}
            <span className={`chip border ${b.chip}`}>{b.label}</span>
            <span className="font-bold tabular-nums">{result.score}/100</span>
            <button onClick={score} disabled={busy} className="ml-auto text-[11px] text-muted-foreground hover:underline">
              {busy ? "…" : "re-score"}
            </button>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{result.reasoning}</p>
          {result.nextAction && (
            <div className="text-xs">
              <span className="font-semibold">Next: </span>
              {result.nextAction}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground italic">AI estimate — your judgement decides.</p>
        </div>
      )}
    </div>
  );
}
