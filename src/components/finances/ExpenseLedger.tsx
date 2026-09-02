"use client";

/**
 * Expense ledger (8.2) — add-expense form + month-grouped ledger + category
 * totals. Talks to /api/business-expenses.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { formatINR, formatDate } from "@/lib/utils";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";

const CATEGORIES: Array<{ value: string; label: string }> = [
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

const PAID_FROM: Array<{ value: string; label: string }> = [
  { value: "current_account", label: "Current A/c" },
  { value: "savings_account", label: "Savings A/c" },
  { value: "credit_card", label: "Credit Card" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
];

const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));
const PAID_LABEL = Object.fromEntries(PAID_FROM.map((p) => [p.value, p.label]));

type Expense = {
  id: string;
  expenseDate: string;
  description: string;
  category: string;
  paidFrom: string;
  amount: string;
  notes: string | null;
};

export function ExpenseLedger({
  fy,
  initial,
}: {
  fy: string;
  initial: Expense[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Expense[]>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    expenseDate: today,
    description: "",
    category: "office_rent",
    paidFrom: "current_account",
    amount: "",
    notes: "",
  });

  const total = useMemo(() => rows.reduce((s, r) => s + Number(r.amount), 0), [rows]);
  const byCategory = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r.category] = (m[r.category] ?? 0) + Number(r.amount);
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  // Group rows by calendar month (YYYY-MM) for display.
  const byMonth = useMemo(() => {
    const m = new Map<string, Expense[]>();
    for (const r of rows) {
      const k = r.expenseDate.slice(0, 7);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [rows]);

  async function add() {
    const amt = parseFloat(form.amount.replace(/[^0-9.]/g, ""));
    if (!form.description.trim() || !amt || amt <= 0) {
      setErr("Enter a description and a positive amount.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/business-expenses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expenseDate: form.expenseDate,
          description: form.description.trim(),
          category: form.category,
          paidFrom: form.paidFrom,
          amount: amt,
          notes: form.notes.trim() || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      setRows((s) => [j.expense, ...s]);
      setForm((s) => ({ ...s, description: "", amount: "", notes: "" }));
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setRows((s) => s.filter((r) => r.id !== id));
    try {
      await fetch(`/api/business-expenses/${id}`, { method: "DELETE" });
      router.refresh();
    } catch {
      /* optimistic; ignore */
    }
  }

  return (
    <div className="space-y-5">
      {/* Add form */}
      <div className="card-surface p-5">
        <h2 className="font-semibold text-sm mb-3">Add expense</h2>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <label className="block">
            <div className="text-[11px] font-medium text-muted-foreground mb-1">Date</div>
            <DateField
              value={form.expenseDate}
              onChange={(e) => setForm((s) => ({ ...s, expenseDate: e.target.value }))}
              className="w-full"
            />
          </label>
          <label className="block md:col-span-2">
            <div className="text-[11px] font-medium text-muted-foreground mb-1">Description</div>
            <input
              value={form.description}
              onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))}
              placeholder="e.g. Office rent, Canva Pro…"
              className="input-base text-sm w-full"
            />
          </label>
          <label className="block">
            <div className="text-[11px] font-medium text-muted-foreground mb-1">Category</div>
            <SelectField
              value={form.category}
              onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))}
              className="w-full"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </SelectField>
          </label>
          <label className="block">
            <div className="text-[11px] font-medium text-muted-foreground mb-1">Paid from</div>
            <SelectField
              value={form.paidFrom}
              onChange={(e) => setForm((s) => ({ ...s, paidFrom: e.target.value }))}
              className="w-full"
            >
              {PAID_FROM.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </SelectField>
          </label>
          <label className="block">
            <div className="text-[11px] font-medium text-muted-foreground mb-1">Amount (₹)</div>
            <input
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm((s) => ({ ...s, amount: e.target.value }))}
              placeholder="0"
              className="input-base text-sm w-full tabular-nums"
            />
          </label>
        </div>
        <div className="flex items-center justify-between mt-3">
          {err ? <span className="text-xs text-rose-600">{err}</span> : <span />}
          <button onClick={add} disabled={busy} className="btn-primary text-sm">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add expense
          </button>
        </div>
      </div>

      {/* Category totals */}
      {byCategory.length > 0 && (
        <div className="card-surface p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-sm">Category totals — {fy}</h2>
            <span className="text-sm font-bold tabular-nums">Total: {formatINR(total)}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {byCategory.map(([cat, amt]) => (
              <span key={cat} className="chip bg-secondary text-xs">
                {CAT_LABEL[cat] ?? cat}:{" "}
                <span className="font-semibold tabular-nums ml-1">{formatINR(amt)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Ledger, grouped by month */}
      <div className="card-surface overflow-hidden">
        <div className="border-b px-4 py-2.5 font-semibold text-sm">
          Expense ledger ({rows.length})
        </div>
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No expenses recorded for {fy}. Add your first above.
          </div>
        ) : (
          byMonth.map(([month, items]) => {
            const mTotal = items.reduce((s, r) => s + Number(r.amount), 0);
            const mLabel = new Date(month + "-01").toLocaleDateString("en-IN", {
              month: "long",
              year: "numeric",
            });
            return (
              <div key={month}>
                <div className="bg-secondary/40 px-4 py-1.5 flex items-center justify-between text-xs font-semibold">
                  <span>{mLabel}</span>
                  <span className="tabular-nums">{formatINR(mTotal)}</span>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {items.map((r) => (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-secondary/30 group">
                        <td className="px-4 py-2 whitespace-nowrap text-xs text-muted-foreground tabular-nums w-24">
                          {formatDate(r.expenseDate)}
                        </td>
                        <td className="py-2 font-medium">{r.description}</td>
                        <td className="py-2 text-xs">
                          <span className="chip bg-secondary text-[10px]">{CAT_LABEL[r.category] ?? r.category}</span>
                        </td>
                        <td className="py-2 text-xs text-muted-foreground">{PAID_LABEL[r.paidFrom] ?? r.paidFrom}</td>
                        <td className="py-2 text-right tabular-nums font-semibold pr-2">{formatINR(Number(r.amount))}</td>
                        <td className="py-2 pr-4 text-right w-10">
                          <button
                            onClick={() => remove(r.id)}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-rose-600 transition-opacity"
                            title="Delete"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
