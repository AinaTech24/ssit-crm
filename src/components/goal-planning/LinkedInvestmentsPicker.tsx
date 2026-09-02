"use client";

/**
 * Pick + allocate existing investments to a goal.
 *
 * Each folio / SIP row has a checkbox (linked yes/no) and an allocation %
 * field (0..100) that controls how much of that folio's AUM / SIP amount
 * counts toward this goal. Default = 100 %. Useful when one folio is split
 * across multiple goals — e.g. ₹10 L folio → 60 % retirement, 40 % child ed.
 *
 * On save we PATCH the goal with:
 *   - linkedFolios + linkedSips (id arrays — back-compat)
 *   - folioAllocations + sipAllocations (per-row %)
 *   - currentValue = Σ folio.aum × pct
 *   - existingMonthlySip = Σ sip.monthlyEq × pct
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Link2, Save, Wallet, Repeat, Percent } from "lucide-react";
import { formatINR } from "@/lib/utils";

type Folio = {
  id: string;
  folioNumber: string;
  amcName: string;
  aum: number;
};

type Sip = {
  id: string;
  schemeName: string | null;
  amount: number;
  status: string;
  frequency: string;
};

type FolioPick = { picked: boolean; pct: number };
type SipPick = { picked: boolean; pct: number };

export function LinkedInvestmentsPicker({
  goalId,
  initiallyLinkedFolioIds,
  initiallyLinkedSipIds,
  initialFolioAllocations,
  initialSipAllocations,
  folios,
  sips,
}: {
  goalId: string;
  initiallyLinkedFolioIds: string[];
  initiallyLinkedSipIds: string[];
  initialFolioAllocations?: { folioId: string; allocationPct: number }[];
  initialSipAllocations?: { sipId: string; allocationPct: number }[];
  folios: Folio[];
  sips: Sip[];
}) {
  const router = useRouter();
  const allocByFolio = new Map<string, number>(
    (initialFolioAllocations ?? []).map((a) => [a.folioId, a.allocationPct])
  );
  const allocBySip = new Map<string, number>(
    (initialSipAllocations ?? []).map((a) => [a.sipId, a.allocationPct])
  );

  const [folioPicks, setFolioPicks] = useState<Record<string, FolioPick>>(() => {
    const out: Record<string, FolioPick> = {};
    for (const f of folios) {
      const picked = initiallyLinkedFolioIds.includes(f.id);
      out[f.id] = {
        picked,
        pct: allocByFolio.get(f.id) ?? (picked ? 100 : 100),
      };
    }
    return out;
  });
  const [sipPicks, setSipPicks] = useState<Record<string, SipPick>>(() => {
    const out: Record<string, SipPick> = {};
    for (const s of sips) {
      const picked = initiallyLinkedSipIds.includes(s.id);
      out[s.id] = {
        picked,
        pct: allocBySip.get(s.id) ?? (picked ? 100 : 100),
      };
    }
    return out;
  });

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function setFolio(id: string, p: Partial<FolioPick>) {
    setFolioPicks((s) => ({ ...s, [id]: { ...s[id], ...p } }));
  }
  function setSip(id: string, p: Partial<SipPick>) {
    setSipPicks((s) => ({ ...s, [id]: { ...s[id], ...p } }));
  }

  const totals = useMemo(() => {
    let aum = 0;
    let monthly = 0;
    let folioCount = 0;
    let sipCount = 0;
    for (const f of folios) {
      const p = folioPicks[f.id];
      if (!p?.picked) continue;
      folioCount += 1;
      aum += f.aum * (p.pct / 100);
    }
    for (const s of sips) {
      const p = sipPicks[s.id];
      if (!p?.picked) continue;
      sipCount += 1;
      const norm =
        s.frequency === "weekly"
          ? s.amount * 4
          : s.frequency === "fortnightly"
          ? s.amount * 2
          : s.frequency === "quarterly"
          ? s.amount / 3
          : s.frequency === "yearly"
          ? s.amount / 12
          : s.amount;
      monthly += norm * (p.pct / 100);
    }
    return { aum, monthly, folioCount, sipCount };
  }, [folioPicks, sipPicks, folios, sips]);

  async function apply() {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const linkedFolios: string[] = [];
      const folioAllocations: { folioId: string; allocationPct: number }[] = [];
      for (const f of folios) {
        const p = folioPicks[f.id];
        if (!p?.picked) continue;
        linkedFolios.push(f.id);
        folioAllocations.push({ folioId: f.id, allocationPct: Math.round(p.pct) });
      }
      const linkedSips: string[] = [];
      const sipAllocations: { sipId: string; allocationPct: number }[] = [];
      for (const s of sips) {
        const p = sipPicks[s.id];
        if (!p?.picked) continue;
        linkedSips.push(s.id);
        sipAllocations.push({ sipId: s.id, allocationPct: Math.round(p.pct) });
      }

      const res = await fetch(`/api/goals/${goalId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          linkedFolios,
          linkedSips,
          folioAllocations,
          sipAllocations,
          currentValue: Math.round(totals.aum),
          existingMonthlySip: Math.round(totals.monthly),
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      setOk(
        `Linked ${totals.folioCount} folio${totals.folioCount === 1 ? "" : "s"} + ${totals.sipCount} SIP${
          totals.sipCount === 1 ? "" : "s"
        } · ${formatINR(Math.round(totals.aum))} allocated.`
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-surface p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold flex items-center gap-2">
          <Link2 className="size-4 text-brand-cyan" /> Linked investments
        </h3>
        <div className="text-xs text-muted-foreground">
          {totals.folioCount} folio · {totals.sipCount} SIP · partial allocation supported
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Folios */}
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="bg-secondary/60 px-3 py-2 text-xs font-semibold flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Wallet className="size-3.5" /> Folios ({folios.length})
            </span>
            <span className="text-[10px] text-muted-foreground font-normal">% allocated →</span>
          </div>
          {folios.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground text-center">No folios.</p>
          ) : (
            <ul className="divide-y max-h-80 overflow-y-auto scrollbar-thin">
              {folios.map((f) => {
                const p = folioPicks[f.id];
                const allocated = (f.aum * p.pct) / 100;
                return (
                  <li
                    key={f.id}
                    className={`px-3 py-2 ${p.picked ? "bg-brand-cyan-light/15" : ""} hover:bg-secondary/40`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={p.picked}
                        onChange={(e) => setFolio(f.id, { picked: e.target.checked })}
                        className="mt-0.5 size-4 rounded border-border text-brand-cyan focus:ring-brand-cyan"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{f.amcName}</div>
                        <div className="text-[11px] text-muted-foreground font-mono">
                          {f.folioNumber}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          AUM <span className="font-semibold text-foreground">{formatINR(f.aum)}</span>
                        </div>
                      </div>
                      {p.picked && (
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={5}
                              value={p.pct}
                              onChange={(e) =>
                                setFolio(f.id, {
                                  pct: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                                })
                              }
                              className="w-14 rounded border border-border bg-card text-right text-xs px-1.5 py-1 tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-cyan/30"
                            />
                            <Percent className="size-3 text-muted-foreground" />
                          </div>
                          <div className="text-[10px] text-brand-cyan-deep font-semibold tabular-nums">
                            = {formatINR(Math.round(allocated))}
                          </div>
                        </div>
                      )}
                    </div>
                    {p.picked && (
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={p.pct}
                        onChange={(e) => setFolio(f.id, { pct: Number(e.target.value) })}
                        className="w-full mt-2 accent-brand-cyan"
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* SIPs */}
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="bg-secondary/60 px-3 py-2 text-xs font-semibold flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Repeat className="size-3.5" /> Active SIPs ({sips.length})
            </span>
            <span className="text-[10px] text-muted-foreground font-normal">% allocated →</span>
          </div>
          {sips.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground text-center">No active SIPs.</p>
          ) : (
            <ul className="divide-y max-h-80 overflow-y-auto scrollbar-thin">
              {sips.map((s) => {
                const p = sipPicks[s.id];
                const norm =
                  s.frequency === "weekly"
                    ? s.amount * 4
                    : s.frequency === "fortnightly"
                    ? s.amount * 2
                    : s.frequency === "quarterly"
                    ? s.amount / 3
                    : s.frequency === "yearly"
                    ? s.amount / 12
                    : s.amount;
                const allocated = (norm * p.pct) / 100;
                return (
                  <li
                    key={s.id}
                    className={`px-3 py-2 ${p.picked ? "bg-brand-cyan-light/15" : ""} hover:bg-secondary/40`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={p.picked}
                        onChange={(e) => setSip(s.id, { picked: e.target.checked })}
                        className="mt-0.5 size-4 rounded border-border text-brand-cyan focus:ring-brand-cyan"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {s.schemeName ?? "Scheme"}
                        </div>
                        <div className="text-[11px] text-muted-foreground capitalize">
                          {s.frequency} · {s.status}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {formatINR(s.amount)}/{s.frequency.slice(0, 3)}
                          {s.frequency !== "monthly" && (
                            <span className="opacity-70">
                              {" "}
                              ≈ {formatINR(Math.round(norm))}/mo
                            </span>
                          )}
                        </div>
                      </div>
                      {p.picked && (
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={5}
                              value={p.pct}
                              onChange={(e) =>
                                setSip(s.id, {
                                  pct: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                                })
                              }
                              className="w-14 rounded border border-border bg-card text-right text-xs px-1.5 py-1 tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-cyan/30"
                            />
                            <Percent className="size-3 text-muted-foreground" />
                          </div>
                          <div className="text-[10px] text-brand-cyan-deep font-semibold tabular-nums">
                            = {formatINR(Math.round(allocated))}/mo
                          </div>
                        </div>
                      )}
                    </div>
                    {p.picked && (
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={p.pct}
                        onChange={(e) => setSip(s.id, { pct: Number(e.target.value) })}
                        className="w-full mt-2 accent-brand-cyan"
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Running total */}
      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border">
        <div className="rounded-lg bg-brand-cyan-light/40 border border-brand-cyan/20 p-3">
          <div className="text-xs text-muted-foreground">Allocated current value</div>
          <div className="text-xl font-bold tabular-nums mt-0.5">
            {formatINR(Math.round(totals.aum))}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">
            Σ folio AUM × allocation %
          </div>
        </div>
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
          <div className="text-xs text-muted-foreground">Allocated monthly SIP</div>
          <div className="text-xl font-bold tabular-nums mt-0.5">
            {formatINR(Math.round(totals.monthly))}/mo
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">
            Σ SIP monthly-equivalent × allocation %
          </div>
        </div>
      </div>

      {err && (
        <div className="border border-destructive/30 bg-destructive/5 text-destructive rounded-lg px-3 py-2 text-sm">
          {err}
        </div>
      )}
      {ok && (
        <div className="border border-emerald-200 bg-emerald-50 text-emerald-700 rounded-lg px-3 py-2 text-sm">
          {ok}
        </div>
      )}

      <div className="flex justify-end pt-2 border-t border-border">
        <button onClick={apply} disabled={busy} className="btn-primary">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {busy ? "Saving…" : "Save allocations"}
        </button>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        An investment can be linked to multiple goals — set each row's <strong>%</strong> to control
        how much of its value flows into this particular goal. The same folio can sit at 60 % here and
        40 % under another goal.
      </p>
    </div>
  );
}
