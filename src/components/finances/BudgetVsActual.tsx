"use client";

/**
 * Budget vs actual — set a monthly budget per expense category and track this
 * month's spend against it. A category over budget shows red; the totals row
 * rolls everything up. Budgets persist to /api/business-expenses/budgets.
 */

import { useState } from "react";
import { Loader2, Pencil, Check } from "lucide-react";
import { formatINR } from "@/lib/utils";

const CATEGORIES = [
  { value: "office_rent", label: "Office Rent" },
  { value: "team_salaries", label: "Team Salaries" },
  { value: "team_welfare", label: "Team Welfare" },
  { value: "utilities", label: "Utilities / Internet" },
  { value: "travel", label: "Travel / Meetings" },
  { value: "tech", label: "Tech / Software" },
  { value: "knowledge", label: "Knowledge / Training" },
  { value: "marketing", label: "Marketing" },
  { value: "gst", label: "GST Paid" },
  { value: "others", label: "Others" },
];

export function BudgetVsActual({
  monthLabel,
  actuals,
  initialBudgets,
}: {
  monthLabel: string;
  actuals: Record<string, number>;
  initialBudgets: Record<string, number>;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [budgets, setBudgets] = useState<Record<string, number>>(initialBudgets);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(CATEGORIES.map((c) => [c.value, String(initialBudgets[c.value] ?? "")]))
  );

  // Only show rows that have a budget or some actual spend, unless editing.
  const visible = CATEGORIES.filter((c) => editing || (budgets[c.value] ?? 0) > 0 || (actuals[c.value] ?? 0) > 0);

  const totalBudget = CATEGORIES.reduce((s, c) => s + (budgets[c.value] ?? 0), 0);
  const totalActual = CATEGORIES.reduce((s, c) => s + (actuals[c.value] ?? 0), 0);

  async function save() {
    setBusy(true);
    try {
      const payload: Record<string, number> = {};
      for (const c of CATEGORIES) {
        const n = Number(draft[c.value]);
        if (Number.isFinite(n) && n >= 0) payload[c.value] = n;
      }
      const res = await fetch("/api/business-expenses/budgets", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ budgets: payload }),
      });
      if (res.ok) {
        setBudgets(payload);
        setEditing(false);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-surface overflow-hidden">
      <div className="border-b px-4 py-2.5 flex items-center justify-between">
        <span className="font-semibold text-sm">Budget vs actual <span className="text-xs text-muted-foreground font-normal">· {monthLabel}</span></span>
        {editing ? (
          <button onClick={save} disabled={busy} className="btn-primary text-xs">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Save budgets
          </button>
        ) : (
          <button onClick={() => setEditing(true)} className="btn-ghost text-xs">
            <Pencil className="size-3.5" /> Set budgets
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="p-6 text-center text-xs text-muted-foreground">
          No budgets set yet. Click <span className="font-medium">Set budgets</span> to add a monthly cap per category and track spend against it.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Category</th>
              <th className="text-right py-2 font-medium">Spent ({monthLabel})</th>
              <th className="text-right py-2 font-medium">Budget</th>
              <th className="text-left py-2 font-medium pl-4 pr-4 w-1/3">Usage</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => {
              const actual = actuals[c.value] ?? 0;
              const budget = editing ? Number(draft[c.value]) || 0 : budgets[c.value] ?? 0;
              const pct = budget > 0 ? (actual / budget) * 100 : actual > 0 ? 100 : 0;
              const over = budget > 0 && actual > budget;
              return (
                <tr key={c.value} className="border-b last:border-0">
                  <td className="px-4 py-2.5">{c.label}</td>
                  <td className={`py-2.5 text-right tabular-nums ${over ? "text-rose-600 font-medium" : ""}`}>{formatINR(actual)}</td>
                  <td className="py-2.5 text-right tabular-nums">
                    {editing ? (
                      <input
                        type="number"
                        value={draft[c.value]}
                        onChange={(e) => setDraft((d) => ({ ...d, [c.value]: e.target.value }))}
                        className="input-base text-xs w-28 text-right tabular-nums"
                        placeholder="0"
                      />
                    ) : budget > 0 ? (
                      formatINR(budget)
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2.5 pl-4 pr-4">
                    <div className="h-2 rounded-full bg-secondary overflow-hidden">
                      <div
                        className={`h-full rounded-full ${over ? "bg-rose-500" : pct > 80 ? "bg-amber-500" : "bg-emerald-500"}`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                    {budget > 0 && (
                      <div className={`text-[10px] mt-0.5 ${over ? "text-rose-600" : "text-muted-foreground"}`}>
                        {pct.toFixed(0)}% used{over ? ` · over by ${formatINR(actual - budget)}` : ` · ${formatINR(Math.max(0, budget - actual))} left`}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            <tr className="bg-secondary/30 font-semibold">
              <td className="px-4 py-2.5">Total</td>
              <td className={`py-2.5 text-right tabular-nums ${totalBudget > 0 && totalActual > totalBudget ? "text-rose-600" : ""}`}>{formatINR(totalActual)}</td>
              <td className="py-2.5 text-right tabular-nums">{totalBudget > 0 ? formatINR(totalBudget) : "—"}</td>
              <td className="pl-4 pr-4" />
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
