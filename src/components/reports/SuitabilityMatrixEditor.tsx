"use client";

/**
 * Inline editor for the 3×3 suitability matrix. Each cell toggles open
 * for editing — categories as multi-select chips, optional allocation %,
 * and a free-text IC rationale. Save persists via PUT /api/suitability-matrix.
 *
 * Print-friendly: edit chrome hidden via `print:hidden`; the rendered
 * grid stays clean for IC presentations.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, X, Pencil, Printer, Sparkles } from "lucide-react";

type Entry = {
  id?: string;
  riskProfile: "low" | "moderate" | "high";
  timeHorizon: "short" | "medium" | "long";
  coarseCategories: string[];
  allocationHints: Record<string, number> | null;
  notes: string | null;
  updatedAt?: string | null;
};

const RISKS: Array<{ value: "low" | "moderate" | "high"; label: string }> = [
  { value: "low", label: "Low Risk" },
  { value: "moderate", label: "Moderate Risk" },
  { value: "high", label: "High Risk" },
];

const HORIZONS: Array<{
  value: "short" | "medium" | "long";
  label: string;
  hint: string;
}> = [
  { value: "short", label: "Short Term", hint: "< 1 year" },
  { value: "medium", label: "Medium Term", hint: "1-3 years" },
  { value: "long", label: "Long Term", hint: "> 3 years" },
];

const COARSE = [
  { value: "equity", label: "Equity" },
  { value: "hybrid", label: "Hybrid" },
  { value: "debt", label: "Debt" },
  { value: "liquid", label: "Liquid" },
  { value: "commodity", label: "Commodity" },
  { value: "international", label: "International" },
  { value: "other", label: "Other" },
];

const COARSE_TONE: Record<string, string> = {
  equity: "bg-emerald-100 text-emerald-800 border-emerald-300",
  hybrid: "bg-blue-100 text-blue-800 border-blue-300",
  debt: "bg-amber-100 text-amber-800 border-amber-300",
  liquid: "bg-cyan-100 text-cyan-800 border-cyan-300",
  commodity: "bg-orange-100 text-orange-800 border-orange-300",
  international: "bg-violet-100 text-violet-800 border-violet-300",
  other: "bg-slate-100 text-slate-800 border-slate-300",
};

const RISK_TONE: Record<string, string> = {
  low: "bg-emerald-50",
  moderate: "bg-amber-50",
  high: "bg-rose-50",
};

export function SuitabilityMatrixEditor({
  initialEntries,
}: {
  initialEntries: Entry[];
}) {
  // Build a 9-cell map keyed by `${risk}|${horizon}`
  const entriesMap = useMemo(() => {
    const m = new Map<string, Entry>();
    for (const r of RISKS) {
      for (const h of HORIZONS) {
        const key = `${r.value}|${h.value}`;
        const found = initialEntries.find(
          (e) => e.riskProfile === r.value && e.timeHorizon === h.value
        );
        m.set(
          key,
          found ?? {
            riskProfile: r.value,
            timeHorizon: h.value,
            coarseCategories: [],
            allocationHints: null,
            notes: null,
          }
        );
      }
    }
    return m;
  }, [initialEntries]);

  const router = useRouter();
  const [entries, setEntries] = useState<Map<string, Entry>>(entriesMap);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Entry | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [prefilling, setPrefilling] = useState(false);

  // How many of the 9 cells are still empty — drives the prefill CTA.
  const emptyCount = useMemo(
    () =>
      Array.from(entries.values()).filter(
        (e) => e.coarseCategories.length === 0
      ).length,
    [entries]
  );

  async function prefillDefaults() {
    setPrefilling(true);
    setErr(null);
    try {
      const res = await fetch("/api/suitability-matrix/prefill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force: false }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Prefill failed (${res.status})`);
        return;
      }
      // Re-fetch from the server so the freshly-seeded cells render.
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setPrefilling(false);
    }
  }

  function startEdit(key: string) {
    const cur = entries.get(key);
    if (!cur) return;
    setDraft({
      ...cur,
      coarseCategories: [...cur.coarseCategories],
      allocationHints: cur.allocationHints
        ? { ...cur.allocationHints }
        : null,
    });
    setEditingKey(key);
    setErr(null);
  }

  function toggleCategory(cat: string) {
    if (!draft) return;
    setDraft({
      ...draft,
      coarseCategories: draft.coarseCategories.includes(cat)
        ? draft.coarseCategories.filter((c) => c !== cat)
        : [...draft.coarseCategories, cat],
    });
  }

  async function save() {
    if (!draft || !editingKey) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/suitability-matrix", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          riskProfile: draft.riskProfile,
          timeHorizon: draft.timeHorizon,
          coarseCategories: draft.coarseCategories,
          allocationHints: draft.allocationHints,
          notes: draft.notes || null,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      const newMap = new Map(entries);
      newMap.set(editingKey, {
        ...draft,
        id: j.entry.id,
        updatedAt: j.entry.updatedAt,
      });
      setEntries(newMap);
      setEditingKey(null);
      setDraft(null);
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex justify-between items-center gap-2 print:hidden">
        <div>
          {emptyCount > 0 && (
            <button
              onClick={prefillDefaults}
              disabled={prefilling}
              className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md border border-brand-cyan/40 bg-brand-cyan-light/50 text-brand-cyan-deep px-3 py-1.5 hover:bg-brand-cyan-light disabled:opacity-50"
            >
              {prefilling ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              Prefill {emptyCount} empty cell{emptyCount === 1 ? "" : "s"} with recommended defaults
            </button>
          )}
        </div>
        <button onClick={() => window.print()} className="btn-ghost text-xs">
          <Printer className="size-3.5" /> Print
        </button>
      </div>
      {err && (
        <div className="rounded-md border border-rose-200 bg-rose-50 text-rose-700 text-xs px-3 py-2 print:hidden">
          {err}
        </div>
      )}

      {/* Print header */}
      <div className="hidden print:block text-center mb-3">
        <h1 className="text-xl font-bold">MF Suitability Matrix</h1>
        <p className="text-xs text-slate-500">
          Generated {new Date().toLocaleDateString("en-GB")}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs min-w-[800px]">
          <thead>
            <tr>
              <th className="border border-slate-300 bg-slate-100 px-3 py-2 text-left w-[140px]">
                <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-600">
                  Client Risk Profile
                </div>
                <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-600 mt-3">
                  ↓ × Time Horizon →
                </div>
              </th>
              {HORIZONS.map((h) => (
                <th
                  key={h.value}
                  className="border border-slate-300 bg-slate-100 px-3 py-2 text-left"
                >
                  <div className="font-semibold text-sm">{h.label}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {h.hint}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RISKS.map((r) => (
              <tr key={r.value}>
                <th
                  className={`border border-slate-300 px-3 py-2 text-left ${RISK_TONE[r.value]}`}
                >
                  <div className="font-semibold text-sm">{r.label}</div>
                </th>
                {HORIZONS.map((h) => {
                  const key = `${r.value}|${h.value}`;
                  const cell = entries.get(key)!;
                  return (
                    <td
                      key={h.value}
                      className="border border-slate-300 align-top p-3 min-w-[180px]"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {r.label} · {h.label}
                        </div>
                        <button
                          onClick={() => startEdit(key)}
                          className="btn-ghost text-[10px] py-0.5 print:hidden"
                          title="Edit cell"
                        >
                          <Pencil className="size-3" />
                        </button>
                      </div>
                      {cell.coarseCategories.length > 0 ? (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {cell.coarseCategories.map((c) => {
                            const label =
                              COARSE.find((x) => x.value === c)?.label ?? c;
                            const pct = cell.allocationHints?.[c];
                            return (
                              <span
                                key={c}
                                className={`chip text-[10px] border ${COARSE_TONE[c] ?? "bg-slate-100"}`}
                              >
                                {label}
                                {pct != null && (
                                  <span className="ml-1 opacity-70">
                                    {pct}%
                                  </span>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-[11px] text-muted-foreground italic">
                          No categories set.
                        </p>
                      )}
                      {cell.notes && (
                        <div className="text-[11px] text-slate-700 italic">
                          “{cell.notes}”
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground print:hidden">
        Click the pencil icon on any cell to edit. Categories are picked
        from the same vocabulary as the AMC shortlist
        (equity / hybrid / debt / liquid / commodity / international /
        other) so the two tools stay aligned.
      </p>

      {/* Edit modal */}
      {editingKey && draft && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto">
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">
                  {RISKS.find((r) => r.value === draft.riskProfile)?.label} ·{" "}
                  {HORIZONS.find((h) => h.value === draft.timeHorizon)?.label}
                </h2>
                <button
                  onClick={() => {
                    setEditingKey(null);
                    setDraft(null);
                  }}
                  className="text-slate-400 hover:text-slate-700"
                >
                  <X className="size-4" />
                </button>
              </div>

              {err && (
                <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                  {err}
                </div>
              )}

              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
                  Coarse categories
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {COARSE.map((c) => {
                    const on = draft.coarseCategories.includes(c.value);
                    return (
                      <button
                        key={c.value}
                        onClick={() => toggleCategory(c.value)}
                        className={`chip text-xs border ${
                          on
                            ? COARSE_TONE[c.value] ??
                              "bg-slate-200 text-slate-900"
                            : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {draft.coarseCategories.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
                    Allocation hints (optional, % of portfolio)
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {draft.coarseCategories.map((c) => (
                      <label key={c} className="flex items-center gap-2">
                        <span className="text-xs w-24 capitalize">{c}</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={5}
                          value={draft.allocationHints?.[c] ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            const next = {
                              ...(draft.allocationHints ?? {}),
                            };
                            if (v === "") delete next[c];
                            else next[c] = Number(v);
                            setDraft({
                              ...draft,
                              allocationHints:
                                Object.keys(next).length > 0 ? next : null,
                            });
                          }}
                          placeholder="e.g. 60"
                          className="input-base text-sm flex-1"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
                  IC rationale (optional)
                </div>
                <textarea
                  value={draft.notes ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, notes: e.target.value })
                  }
                  rows={3}
                  placeholder="Why this allocation for this client profile?"
                  className="input-base text-sm w-full"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t">
                <button
                  onClick={() => {
                    setEditingKey(null);
                    setDraft(null);
                  }}
                  disabled={busy}
                  className="btn-ghost text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={busy}
                  className="btn-primary text-sm"
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  Save cell
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
