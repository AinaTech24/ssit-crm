"use client";

/**
 * Portfolio review worksheet — Network FP "3.4 Portfolio Review" parity.
 *
 * One row per folio. The RM walks the table during the meeting,
 * filling qualitative cells. Save persists everything as snapshot
 * values so historical reviews freeze.
 *
 * Each row auto-prefills:
 *   - scheme name, category from folio.schemes[0]
 *   - current value from folio.aum
 *   - start date from folio.openedAt
 *   - holding period computed from openedAt → meeting date
 * The RM can override any field.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Printer } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";

type RecommendedAction =
  | "hold"
  | "no_action"
  | "switch"
  | "exit"
  | "increase"
  | "decrease"
  | "pause_sip"
  | "resume_sip"
  | "new_sip"
  | "step_up"
  | "step_down";

type FolioRow = {
  id: string;
  folioNumber: string;
  amcName: string;
  amcCode: string;
  openedAt: string | null;
  aum: number | null;
  schemes: Array<{
    schemeCode?: string;
    schemeName?: string;
    category?: string;
    units?: number;
    nav?: number;
    value?: number;
  }>;
};

type ItemRow = {
  id?: string;
  folioId: string;
  schemeName: string | null;
  fundCategory: string | null;
  investmentType: "sip" | "lumpsum" | "mixed" | null;
  snapshotCurrentValue: number | null;
  snapshotInvestedAmount: number | null;
  startDate: string | null;
  holdingPeriodMonths: number | null;
  returnPct: number | null;
  exitLoadNote: string | null;
  taxImplicationNote: string | null;
  pastPerformanceNote: string | null;
  suitabilityNote: string | null;
  recommendedAction: RecommendedAction;
  rationale: string | null;
  remarks: string | null;
};

const ACTION_OPTIONS: Array<{ value: RecommendedAction; label: string }> = [
  { value: "hold", label: "Hold" },
  { value: "no_action", label: "No action" },
  { value: "switch", label: "Switch" },
  { value: "exit", label: "Exit" },
  { value: "increase", label: "Increase" },
  { value: "decrease", label: "Decrease" },
  { value: "pause_sip", label: "Pause SIP" },
  { value: "resume_sip", label: "Resume SIP" },
  { value: "new_sip", label: "New SIP" },
  { value: "step_up", label: "Step Up SIP" },
  { value: "step_down", label: "Step Down SIP" },
];

const ACTION_TONE: Record<string, string> = {
  hold: "bg-emerald-50 text-emerald-700",
  no_action: "bg-slate-50 text-slate-600",
  switch: "bg-violet-50 text-violet-700",
  exit: "bg-rose-50 text-rose-700",
  increase: "bg-blue-50 text-blue-700",
  decrease: "bg-amber-50 text-amber-700",
  pause_sip: "bg-amber-50 text-amber-700",
  resume_sip: "bg-emerald-50 text-emerald-700",
  new_sip: "bg-blue-50 text-blue-700",
  step_up: "bg-blue-50 text-blue-700",
  step_down: "bg-amber-50 text-amber-700",
};

function monthsBetween(from: Date, to: Date): number {
  return (
    (to.getFullYear() - from.getFullYear()) * 12 +
    (to.getMonth() - from.getMonth())
  );
}

export function PortfolioReviewWorksheet({
  meetingId,
  meetingDate,
  folios,
  initialItems,
}: {
  meetingId: string;
  meetingDate: string;
  folios: FolioRow[];
  initialItems: ItemRow[];
}) {
  const router = useRouter();
  const meetingDateObj = useMemo(() => new Date(meetingDate), [meetingDate]);

  // Seed one row per folio. Existing items take precedence; otherwise
  // prefill from the folio.
  const initial = useMemo(() => {
    const byFolio = new Map(initialItems.map((i) => [i.folioId, i]));
    return folios.map<ItemRow>((f) => {
      const existing = byFolio.get(f.id);
      if (existing) return existing;
      const first = f.schemes[0];
      const start = f.openedAt ? new Date(f.openedAt) : null;
      const holdingMonths = start
        ? monthsBetween(start, meetingDateObj)
        : null;
      return {
        folioId: f.id,
        schemeName: first?.schemeName ?? f.amcName,
        fundCategory: first?.category ?? null,
        investmentType: null,
        snapshotCurrentValue: f.aum,
        snapshotInvestedAmount: null,
        startDate: f.openedAt,
        holdingPeriodMonths: holdingMonths,
        returnPct: null,
        exitLoadNote: null,
        taxImplicationNote: null,
        pastPerformanceNote: null,
        suitabilityNote: null,
        recommendedAction: "hold",
        rationale: null,
        remarks: null,
      };
    });
  }, [folios, initialItems, meetingDateObj]);

  const [items, setItems] = useState<ItemRow[]>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function setItem(i: number, patch: Partial<ItemRow>) {
    setItems((prev) =>
      prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row))
    );
    setOk(null);
  }

  async function saveAll() {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const res = await fetch(
        `/api/review-meetings/${meetingId}/portfolio`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ items }),
        }
      );
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      setOk(`Saved ${j.items?.length ?? 0} entries.`);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  const totals = useMemo(() => {
    let cur = 0;
    let inv = 0;
    for (const r of items) {
      cur += r.snapshotCurrentValue ?? 0;
      inv += r.snapshotInvestedAmount ?? 0;
    }
    return { cur, inv, gain: cur - inv };
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="card-surface p-12 text-center text-sm text-muted-foreground">
        This client has no folios on record. Add at least one folio to run a
        portfolio review.
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-3 text-xs">
          <Stat label="Current value" value={fmtInr(totals.cur)} />
          <Stat label="Invested" value={fmtInr(totals.inv)} />
          <Stat
            label="Net gain"
            value={fmtInr(totals.gain)}
            tone={totals.gain >= 0 ? "emerald" : "rose"}
          />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => window.print()} className="btn-ghost text-xs">
            <Printer className="size-3.5" /> Print
          </button>
          <button onClick={saveAll} disabled={busy} className="btn-primary text-sm">
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Save all
          </button>
        </div>
      </div>

      {err && (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
          {err}
        </div>
      )}
      {ok && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
          ✓ {ok}
        </div>
      )}

      <div className="overflow-x-auto card-surface">
        <table className="w-full text-xs min-w-[1400px]">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-2 py-2 text-left w-8">#</th>
              <th className="px-2 py-2 text-left min-w-[180px]">Fund / Folio</th>
              <th className="px-2 py-2 text-left">Category</th>
              <th className="px-2 py-2 text-left">Type</th>
              <th className="px-2 py-2 text-right">Current ₹</th>
              <th className="px-2 py-2 text-right">Invested ₹</th>
              <th className="px-2 py-2 text-left">Start</th>
              <th className="px-2 py-2 text-right">Months</th>
              <th className="px-2 py-2 text-right">Return %</th>
              <th className="px-2 py-2 text-left">Exit load</th>
              <th className="px-2 py-2 text-left">Tax</th>
              <th className="px-2 py-2 text-left">Past perf.</th>
              <th className="px-2 py-2 text-left">Suitability</th>
              <th className="px-2 py-2 text-left">Action</th>
              <th className="px-2 py-2 text-left">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r, i) => {
              const folio = folios.find((f) => f.id === r.folioId);
              return (
                <tr key={r.folioId} className="border-t align-top">
                  <td className="px-2 py-2 text-muted-foreground">{i + 1}</td>
                  <td className="px-2 py-2">
                    <input
                      value={r.schemeName ?? ""}
                      onChange={(e) =>
                        setItem(i, { schemeName: e.target.value || null })
                      }
                      placeholder="Scheme name"
                      className="input-base text-xs w-full"
                    />
                    <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                      {folio?.amcName ?? "—"} · {folio?.folioNumber ?? "—"}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={r.fundCategory ?? ""}
                      onChange={(e) =>
                        setItem(i, { fundCategory: e.target.value || null })
                      }
                      placeholder="e.g. Large Cap"
                      className="input-base text-xs w-full"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <SelectField
                      value={r.investmentType ?? ""}
                      onChange={(e) =>
                        setItem(i, {
                          investmentType:
                            (e.target.value as ItemRow["investmentType"]) || null,
                        })
                      }
                      size="sm"
                      className="w-full"
                    >
                      <option value="">Select…</option>
                      <option value="sip">SIP</option>
                      <option value="lumpsum">Lumpsum</option>
                      <option value="mixed">Mixed</option>
                    </SelectField>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <input
                      type="number"
                      value={r.snapshotCurrentValue ?? ""}
                      onChange={(e) =>
                        setItem(i, {
                          snapshotCurrentValue:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                      className="input-base text-xs w-full text-right"
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <input
                      type="number"
                      value={r.snapshotInvestedAmount ?? ""}
                      onChange={(e) =>
                        setItem(i, {
                          snapshotInvestedAmount:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                      className="input-base text-xs w-full text-right"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <DateField
                      value={r.startDate ?? ""}
                      onChange={(e) =>
                        setItem(i, { startDate: e.target.value || null })
                      }
                      size="sm"
                      className="w-full"
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <input
                      type="number"
                      value={r.holdingPeriodMonths ?? ""}
                      onChange={(e) =>
                        setItem(i, {
                          holdingPeriodMonths:
                            e.target.value === ""
                              ? null
                              : parseInt(e.target.value, 10),
                        })
                      }
                      className="input-base text-xs w-full text-right"
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <input
                      type="number"
                      step="0.01"
                      value={r.returnPct ?? ""}
                      onChange={(e) =>
                        setItem(i, {
                          returnPct:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                      className="input-base text-xs w-full text-right"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <textarea
                      value={r.exitLoadNote ?? ""}
                      onChange={(e) =>
                        setItem(i, { exitLoadNote: e.target.value || null })
                      }
                      rows={2}
                      className="input-base text-xs w-full"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <textarea
                      value={r.taxImplicationNote ?? ""}
                      onChange={(e) =>
                        setItem(i, {
                          taxImplicationNote: e.target.value || null,
                        })
                      }
                      rows={2}
                      className="input-base text-xs w-full"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <textarea
                      value={r.pastPerformanceNote ?? ""}
                      onChange={(e) =>
                        setItem(i, {
                          pastPerformanceNote: e.target.value || null,
                        })
                      }
                      rows={2}
                      className="input-base text-xs w-full"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <textarea
                      value={r.suitabilityNote ?? ""}
                      onChange={(e) =>
                        setItem(i, {
                          suitabilityNote: e.target.value || null,
                        })
                      }
                      rows={2}
                      className="input-base text-xs w-full"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <SelectField
                      value={r.recommendedAction}
                      onChange={(e) =>
                        setItem(i, {
                          recommendedAction: e.target.value as RecommendedAction,
                        })
                      }
                      size="sm"
                      className="w-full"
                    >
                      {ACTION_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </SelectField>
                  </td>
                  <td className="px-2 py-2">
                    <textarea
                      value={r.remarks ?? ""}
                      onChange={(e) =>
                        setItem(i, { remarks: e.target.value || null })
                      }
                      rows={2}
                      className="input-base text-xs w-full"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "emerald" | "rose";
}) {
  const cls =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "rose"
        ? "text-rose-700"
        : "text-foreground";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`font-semibold ${cls}`}>{value}</div>
    </div>
  );
}

function fmtInr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}
