"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trophy, FlaskConical } from "lucide-react";

export interface VariantStat {
  label: string;
  templateName?: string | null;
  sent: number;
  opened: number;
  clicked: number;
}

/**
 * A/B results — A vs B funnel with open/click rates, plus a "pick winner"
 * control. Picking a winner PATCHes `abWinner`; the dispatcher then sends the
 * winning template to everyone still unsent.
 */
export function CampaignAbResults({
  campaignId,
  a,
  b,
  currentWinner,
  canPick,
}: {
  campaignId: string;
  a: VariantStat;
  b: VariantStat;
  currentWinner: "a" | "b" | null;
  canPick: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function pick(winner: "a" | "b") {
    setBusy(winner);
    setErr(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ abWinner: winner }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? `Failed (${res.status})`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const rate = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");
  const openRate = (v: VariantStat) => (v.sent > 0 ? v.opened / v.sent : 0);
  const leader: "a" | "b" | null = a.sent && b.sent ? (openRate(a) >= openRate(b) ? "a" : "b") : null;

  return (
    <div className="border rounded-lg bg-card p-5">
      <h2 className="font-semibold mb-3 flex items-center gap-2">
        <FlaskConical className="size-4 text-brand-cyan" /> A/B test results
      </h2>
      <div className="grid grid-cols-2 gap-4">
        {([a, b] as VariantStat[]).map((v, i) => {
          const key = (i === 0 ? "a" : "b") as "a" | "b";
          const won = currentWinner === key;
          const isLeader = leader === key;
          return (
            <div key={key} className={`rounded-lg border p-4 ${won ? "border-emerald-400 bg-emerald-50/40" : "bg-background"}`}>
              <div className="flex items-center justify-between">
                <div className="font-medium flex items-center gap-1.5">
                  {v.label}
                  {won && <Trophy className="size-3.5 text-emerald-600" />}
                  {!won && isLeader && <span className="text-[10px] text-emerald-700 font-normal">leading</span>}
                </div>
              </div>
              {v.templateName && <div className="text-[11px] text-muted-foreground truncate">{v.templateName}</div>}
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-lg font-bold">{v.sent.toLocaleString("en-IN")}</div>
                  <div className="text-[10px] text-muted-foreground">sent</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-blue-600">{rate(v.opened, v.sent)}</div>
                  <div className="text-[10px] text-muted-foreground">open rate</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-violet-600">{rate(v.clicked, v.sent)}</div>
                  <div className="text-[10px] text-muted-foreground">click rate</div>
                </div>
              </div>
              {canPick && !currentWinner && (
                <button
                  type="button"
                  className="btn-secondary text-xs w-full mt-3 inline-flex items-center justify-center gap-1"
                  disabled={!!busy}
                  onClick={() => pick(key)}
                >
                  {busy === key ? <Loader2 className="size-3.5 animate-spin" /> : <Trophy className="size-3.5" />} Pick {v.label} as winner
                </button>
              )}
            </div>
          );
        })}
      </div>
      {currentWinner && (
        <p className="text-[11px] text-emerald-700 mt-3">
          Winner locked to Variant {currentWinner.toUpperCase()} — remaining unsent recipients receive it.
        </p>
      )}
      {err && <p className="text-xs text-rose-600 mt-2">{err}</p>}
    </div>
  );
}
