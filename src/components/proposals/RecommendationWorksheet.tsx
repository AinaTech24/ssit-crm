"use client";

/**
 * 4-section recommendation worksheet — Network FP "3.6 Product
 * Recommendation" parity.
 *
 * One section per recommendation type. Each row is a proposal_schemes
 * entry tagged with the matching type. The user adds/removes rows
 * inline; Save All bulk-replaces via PUT.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Plus, Trash2, Printer } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

type RecType = "sip" | "lumpsum" | "swp" | "stp";
type PlanType = "regular" | "direct";

type Row = {
  id?: string;
  amc: string | null;
  schemeName: string;
  schemeCode: string | null;
  schemeCategory: string | null;
  assetClass: string | null;
  schemeRiskLevel: string | null;
  recommendationType: RecType;
  planType: PlanType | null;
  sipAmount: number | null;
  lumpsumAmount: number | null;
  expectedReturnPct: number | null;
  expectedHoldingYears: number | null;
  stepUpPct: number | null;
  goalOrObjective: string | null;
  // SWP
  corpusRequired: number | null;
  monthlyWithdrawal: number | null;
  swpPeriodMonths: number | null;
  // STP
  toSchemeName: string | null;
  toSchemeCode: string | null;
  monthlyTransfer: number | null;
  numInstallments: number | null;
  totalCorpusForStp: number | null;
};

const EMPTY_BASE: Omit<Row, "recommendationType"> = {
  amc: null,
  schemeName: "",
  schemeCode: null,
  schemeCategory: null,
  assetClass: null,
  schemeRiskLevel: null,
  planType: null,
  sipAmount: null,
  lumpsumAmount: null,
  expectedReturnPct: null,
  expectedHoldingYears: null,
  stepUpPct: null,
  goalOrObjective: null,
  corpusRequired: null,
  monthlyWithdrawal: null,
  swpPeriodMonths: null,
  toSchemeName: null,
  toSchemeCode: null,
  monthlyTransfer: null,
  numInstallments: null,
  totalCorpusForStp: null,
};

const RISK_OPTIONS = [
  { value: "", label: "—" },
  { value: "low", label: "Low" },
  { value: "moderate", label: "Moderate" },
  { value: "moderately_high", label: "Mod. High" },
  { value: "high", label: "High" },
  { value: "very_high", label: "Very High" },
];

export function RecommendationWorksheet({
  proposalId,
  initialRows,
}: {
  proposalId: string;
  initialRows: Row[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(initialRows);
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  function updateRow(idx: number, patch: Partial<Row>) {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, ...patch } : r))
    );
  }
  function addRow(type: RecType) {
    setRows((prev) => [...prev, { ...EMPTY_BASE, recommendationType: type }]);
  }
  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  async function saveAll() {
    setBusy(true);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/schemes`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? `Save failed (${res.status})`, "Couldn't save");
        return;
      }
      const n = j.rows?.length ?? 0;
      toast.success(`Saved ${n} recommendation${n === 1 ? "" : "s"}.`);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Network error", "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-end gap-2 print:hidden">
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
      <SipSection rows={rows} updateRow={updateRow} addRow={addRow} removeRow={removeRow} />
      <LumpsumSection rows={rows} updateRow={updateRow} addRow={addRow} removeRow={removeRow} />
      <SwpSection rows={rows} updateRow={updateRow} addRow={addRow} removeRow={removeRow} />
      <StpSection rows={rows} updateRow={updateRow} addRow={addRow} removeRow={removeRow} />
    </>
  );
}

type SectionProps = {
  rows: Row[];
  updateRow: (idx: number, patch: Partial<Row>) => void;
  addRow: (type: RecType) => void;
  removeRow: (idx: number) => void;
};

/* ─────────────────────── 1) SIP ─────────────────────── */
function SipSection({ rows, updateRow, addRow, removeRow }: SectionProps) {
  const entries = useMemo(
    () =>
      rows
        .map((r, i) => ({ row: r, idx: i }))
        .filter((e) => e.row.recommendationType === "sip"),
    [rows]
  );
  const total = entries.reduce((s, e) => s + (e.row.sipAmount ?? 0), 0);

  return (
    <Section
      title="SIP Investment Recommendation"
      tone="emerald"
      onAdd={() => addRow("sip")}
    >
      {entries.length === 0 ? (
        <Empty label="No SIP recommendations yet" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[1100px]">
            <thead className="bg-emerald-50 text-emerald-900">
              <tr>
                <th className="px-2 py-2 text-left">Scheme</th>
                <th className="px-2 py-2 text-left">Category</th>
                <th className="px-2 py-2 text-left">Risk</th>
                <th className="px-2 py-2 text-left">Type</th>
                <th className="px-2 py-2 text-right">Monthly SIP ₹</th>
                <th className="px-2 py-2 text-right">Years</th>
                <th className="px-2 py-2 text-right">Step-up %</th>
                <th className="px-2 py-2 text-left">Goal</th>
                <th className="px-2 py-2 print:hidden"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={`sip-${e.idx}`} className="border-t align-top">
                  <td className="px-2 py-2">
                    <input
                      value={e.row.schemeName}
                      onChange={(ev) =>
                        updateRow(e.idx, { schemeName: ev.target.value })
                      }
                      className="input-base text-xs w-full"
                    />
                    {e.row.amc && (
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {e.row.amc}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={e.row.schemeCategory ?? ""}
                      onChange={(ev) =>
                        updateRow(e.idx, {
                          schemeCategory: ev.target.value || null,
                        })
                      }
                      className="input-base text-xs w-full"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={e.row.schemeRiskLevel ?? ""}
                      onChange={(ev) =>
                        updateRow(e.idx, {
                          schemeRiskLevel: ev.target.value || null,
                        })
                      }
                      className="input-base text-xs w-full"
                    >
                      {RISK_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={e.row.planType ?? ""}
                      onChange={(ev) =>
                        updateRow(e.idx, {
                          planType: (ev.target.value || null) as PlanType | null,
                        })
                      }
                      className="input-base text-xs w-full"
                    >
                      <option value="">Select…</option>
                      <option value="regular">Regular</option>
                      <option value="direct">Direct</option>
                    </select>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <NumberCell
                      value={e.row.sipAmount}
                      onChange={(v) => updateRow(e.idx, { sipAmount: v })}
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <NumberCell
                      value={e.row.expectedHoldingYears}
                      onChange={(v) =>
                        updateRow(e.idx, { expectedHoldingYears: v })
                      }
                      step={1}
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <NumberCell
                      value={e.row.stepUpPct}
                      onChange={(v) => updateRow(e.idx, { stepUpPct: v })}
                      step={1}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={e.row.goalOrObjective ?? ""}
                      onChange={(ev) =>
                        updateRow(e.idx, {
                          goalOrObjective: ev.target.value || null,
                        })
                      }
                      className="input-base text-xs w-full"
                    />
                  </td>
                  <td className="px-2 py-2 print:hidden">
                    <button
                      onClick={() => removeRow(e.idx)}
                      className="p-1.5 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 rounded-md"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="border-t border-emerald-300 bg-emerald-50/60">
                <td className="px-2 py-2 font-semibold" colSpan={4}>
                  Total monthly SIP
                </td>
                <td className="px-2 py-2 text-right font-semibold">
                  {inr(total)}
                </td>
                <td colSpan={4}></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/* ─────────────────────── 2) Lumpsum ─────────────────────── */
function LumpsumSection({ rows, updateRow, addRow, removeRow }: SectionProps) {
  const entries = useMemo(
    () =>
      rows
        .map((r, i) => ({ row: r, idx: i }))
        .filter((e) => e.row.recommendationType === "lumpsum"),
    [rows]
  );
  const total = entries.reduce((s, e) => s + (e.row.lumpsumAmount ?? 0), 0);

  return (
    <Section
      title="Lumpsum Investment Recommendation"
      tone="blue"
      onAdd={() => addRow("lumpsum")}
    >
      {entries.length === 0 ? (
        <Empty label="No lumpsum recommendations yet" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[1000px]">
            <thead className="bg-blue-50 text-blue-900">
              <tr>
                <th className="px-2 py-2 text-left">Scheme</th>
                <th className="px-2 py-2 text-left">Category</th>
                <th className="px-2 py-2 text-left">Risk</th>
                <th className="px-2 py-2 text-left">Type</th>
                <th className="px-2 py-2 text-right">Lumpsum ₹</th>
                <th className="px-2 py-2 text-right">Years</th>
                <th className="px-2 py-2 text-left">Goal</th>
                <th className="px-2 py-2 print:hidden"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={`lump-${e.idx}`} className="border-t align-top">
                  <td className="px-2 py-2">
                    <input
                      value={e.row.schemeName}
                      onChange={(ev) =>
                        updateRow(e.idx, { schemeName: ev.target.value })
                      }
                      className="input-base text-xs w-full"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={e.row.schemeCategory ?? ""}
                      onChange={(ev) =>
                        updateRow(e.idx, {
                          schemeCategory: ev.target.value || null,
                        })
                      }
                      className="input-base text-xs w-full"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={e.row.schemeRiskLevel ?? ""}
                      onChange={(ev) =>
                        updateRow(e.idx, {
                          schemeRiskLevel: ev.target.value || null,
                        })
                      }
                      className="input-base text-xs w-full"
                    >
                      {RISK_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={e.row.planType ?? ""}
                      onChange={(ev) =>
                        updateRow(e.idx, {
                          planType: (ev.target.value || null) as PlanType | null,
                        })
                      }
                      className="input-base text-xs w-full"
                    >
                      <option value="">Select…</option>
                      <option value="regular">Regular</option>
                      <option value="direct">Direct</option>
                    </select>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <NumberCell
                      value={e.row.lumpsumAmount}
                      onChange={(v) => updateRow(e.idx, { lumpsumAmount: v })}
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <NumberCell
                      value={e.row.expectedHoldingYears}
                      onChange={(v) =>
                        updateRow(e.idx, { expectedHoldingYears: v })
                      }
                      step={1}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={e.row.goalOrObjective ?? ""}
                      onChange={(ev) =>
                        updateRow(e.idx, {
                          goalOrObjective: ev.target.value || null,
                        })
                      }
                      className="input-base text-xs w-full"
                    />
                  </td>
                  <td className="px-2 py-2 print:hidden">
                    <button
                      onClick={() => removeRow(e.idx)}
                      className="p-1.5 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 rounded-md"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="border-t border-blue-300 bg-blue-50/60">
                <td className="px-2 py-2 font-semibold" colSpan={4}>
                  Total lumpsum
                </td>
                <td className="px-2 py-2 text-right font-semibold">
                  {inr(total)}
                </td>
                <td colSpan={3}></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/* ─────────────────────── 3) SWP ─────────────────────── */
function SwpSection({ rows, updateRow, addRow, removeRow }: SectionProps) {
  const entries = useMemo(
    () =>
      rows
        .map((r, i) => ({ row: r, idx: i }))
        .filter((e) => e.row.recommendationType === "swp"),
    [rows]
  );

  return (
    <Section
      title="SWP Investment Recommendation"
      tone="amber"
      onAdd={() => addRow("swp")}
    >
      {entries.length === 0 ? (
        <Empty label="No SWP recommendations yet" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[1100px]">
            <thead className="bg-amber-50 text-amber-900">
              <tr>
                <th className="px-2 py-2 text-left">Scheme</th>
                <th className="px-2 py-2 text-left">Category</th>
                <th className="px-2 py-2 text-left">Risk</th>
                <th className="px-2 py-2 text-left">Type</th>
                <th className="px-2 py-2 text-right">Corpus ₹</th>
                <th className="px-2 py-2 text-right">Monthly withdrawal ₹</th>
                <th className="px-2 py-2 text-right">Months</th>
                <th className="px-2 py-2 text-left">Goal</th>
                <th className="px-2 py-2 print:hidden"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={`swp-${e.idx}`} className="border-t align-top">
                  <td className="px-2 py-2">
                    <input
                      value={e.row.schemeName}
                      onChange={(ev) =>
                        updateRow(e.idx, { schemeName: ev.target.value })
                      }
                      className="input-base text-xs w-full"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={e.row.schemeCategory ?? ""}
                      onChange={(ev) =>
                        updateRow(e.idx, {
                          schemeCategory: ev.target.value || null,
                        })
                      }
                      className="input-base text-xs w-full"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={e.row.schemeRiskLevel ?? ""}
                      onChange={(ev) =>
                        updateRow(e.idx, {
                          schemeRiskLevel: ev.target.value || null,
                        })
                      }
                      className="input-base text-xs w-full"
                    >
                      {RISK_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={e.row.planType ?? ""}
                      onChange={(ev) =>
                        updateRow(e.idx, {
                          planType: (ev.target.value || null) as PlanType | null,
                        })
                      }
                      className="input-base text-xs w-full"
                    >
                      <option value="">Select…</option>
                      <option value="regular">Regular</option>
                      <option value="direct">Direct</option>
                    </select>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <NumberCell
                      value={e.row.corpusRequired}
                      onChange={(v) => updateRow(e.idx, { corpusRequired: v })}
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <NumberCell
                      value={e.row.monthlyWithdrawal}
                      onChange={(v) =>
                        updateRow(e.idx, { monthlyWithdrawal: v })
                      }
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <NumberCell
                      value={e.row.swpPeriodMonths}
                      onChange={(v) =>
                        updateRow(e.idx, { swpPeriodMonths: v })
                      }
                      step={1}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={e.row.goalOrObjective ?? ""}
                      onChange={(ev) =>
                        updateRow(e.idx, {
                          goalOrObjective: ev.target.value || null,
                        })
                      }
                      className="input-base text-xs w-full"
                    />
                  </td>
                  <td className="px-2 py-2 print:hidden">
                    <button
                      onClick={() => removeRow(e.idx)}
                      className="p-1.5 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 rounded-md"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/* ─────────────────────── 4) STP ─────────────────────── */
function StpSection({ rows, updateRow, addRow, removeRow }: SectionProps) {
  const entries = useMemo(
    () =>
      rows
        .map((r, i) => ({ row: r, idx: i }))
        .filter((e) => e.row.recommendationType === "stp"),
    [rows]
  );

  return (
    <Section
      title="STP Investment Recommendation"
      tone="violet"
      onAdd={() => addRow("stp")}
    >
      {entries.length === 0 ? (
        <Empty label="No STP recommendations yet" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[1100px]">
            <thead className="bg-violet-50 text-violet-900">
              <tr>
                <th className="px-2 py-2 text-left">From scheme</th>
                <th className="px-2 py-2 text-left">To scheme</th>
                <th className="px-2 py-2 text-left">Type</th>
                <th className="px-2 py-2 text-right">Monthly transfer ₹</th>
                <th className="px-2 py-2 text-right">Installments</th>
                <th className="px-2 py-2 text-right">Months</th>
                <th className="px-2 py-2 text-right">Total corpus ₹</th>
                <th className="px-2 py-2 print:hidden"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={`stp-${e.idx}`} className="border-t align-top">
                  <td className="px-2 py-2">
                    <input
                      value={e.row.schemeName}
                      onChange={(ev) =>
                        updateRow(e.idx, { schemeName: ev.target.value })
                      }
                      className="input-base text-xs w-full"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={e.row.toSchemeName ?? ""}
                      onChange={(ev) =>
                        updateRow(e.idx, {
                          toSchemeName: ev.target.value || null,
                        })
                      }
                      className="input-base text-xs w-full"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={e.row.planType ?? ""}
                      onChange={(ev) =>
                        updateRow(e.idx, {
                          planType: (ev.target.value || null) as PlanType | null,
                        })
                      }
                      className="input-base text-xs w-full"
                    >
                      <option value="">Select…</option>
                      <option value="regular">Regular</option>
                      <option value="direct">Direct</option>
                    </select>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <NumberCell
                      value={e.row.monthlyTransfer}
                      onChange={(v) =>
                        updateRow(e.idx, { monthlyTransfer: v })
                      }
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <NumberCell
                      value={e.row.numInstallments}
                      onChange={(v) =>
                        updateRow(e.idx, { numInstallments: v })
                      }
                      step={1}
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <NumberCell
                      value={e.row.expectedHoldingYears}
                      onChange={(v) =>
                        updateRow(e.idx, { expectedHoldingYears: v })
                      }
                      step={1}
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <NumberCell
                      value={e.row.totalCorpusForStp}
                      onChange={(v) =>
                        updateRow(e.idx, { totalCorpusForStp: v })
                      }
                    />
                  </td>
                  <td className="px-2 py-2 print:hidden">
                    <button
                      onClick={() => removeRow(e.idx)}
                      className="p-1.5 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 rounded-md"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function Section({
  title,
  tone,
  onAdd,
  children,
}: {
  title: string;
  tone: "emerald" | "blue" | "amber" | "violet";
  onAdd: () => void;
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50/40"
      : tone === "blue"
        ? "border-blue-200 bg-blue-50/40"
        : tone === "amber"
          ? "border-amber-200 bg-amber-50/40"
          : "border-violet-200 bg-violet-50/40";
  return (
    <section className={`card-surface p-4 space-y-2 border ${toneClass}`}>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        <button onClick={onAdd} className="btn-ghost text-xs print:hidden">
          <Plus className="size-3.5" /> Add row
        </button>
      </div>
      {children}
    </section>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <p className="text-xs text-muted-foreground text-center py-4">{label}</p>
  );
}

function NumberCell({
  value,
  onChange,
  step = 100,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={value ?? ""}
      step={step}
      onChange={(e) =>
        onChange(e.target.value === "" ? null : Number(e.target.value))
      }
      className="input-base text-xs w-full text-right"
    />
  );
}

function inr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}
