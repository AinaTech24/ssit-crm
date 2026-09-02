"use client";

/**
 * Recurring expense templates — define fixed monthly costs once (rent, salaries,
 * software) and post them all to the ledger for the current month with one
 * click. Posting is idempotent server-side, so the button is safe to re-press.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, Repeat, CheckCircle2 } from "lucide-react";
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
const PAID_FROM = [
  { value: "current_account", label: "Current A/c" },
  { value: "savings_account", label: "Savings A/c" },
  { value: "credit_card", label: "Credit Card" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
];
const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));

type Template = {
  id: string;
  description: string;
  category: string;
  paidFrom: string;
  amount: string;
  dayOfMonth: number;
  active: boolean;
};

export function RecurringExpenses({ initial, currentPeriod }: { initial: Template[]; currentPeriod: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<Template[]>(initial);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postMsg, setPostMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ description: "", category: "office_rent", paidFrom: "current_account", amount: "", dayOfMonth: "1" });

  const monthlyTotal = rows.filter((r) => r.active).reduce((s, r) => s + Number(r.amount), 0);

  async function add() {
    if (!form.description.trim() || !Number(form.amount)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/business-expenses/recurring", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "create",
          description: form.description.trim(),
          category: form.category,
          paidFrom: form.paidFrom,
          amount: Number(form.amount),
          dayOfMonth: Math.max(1, Math.min(31, Number(form.dayOfMonth) || 1)),
        }),
      });
      if (res.ok) {
        const { template } = await res.json();
        setRows((r) => [template, ...r]);
        setForm({ description: "", category: "office_rent", paidFrom: "current_account", amount: "", dayOfMonth: "1" });
        setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggle(t: Template) {
    setRows((r) => r.map((x) => (x.id === t.id ? { ...x, active: !x.active } : x)));
    await fetch(`/api/business-expenses/recurring/${t.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !t.active }),
    });
  }

  async function remove(id: string) {
    setRows((r) => r.filter((x) => x.id !== id));
    await fetch(`/api/business-expenses/recurring/${id}`, { method: "DELETE" });
  }

  async function postMonth() {
    setPosting(true);
    setPostMsg(null);
    try {
      const res = await fetch("/api/business-expenses/recurring", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "post-month", period: currentPeriod }),
      });
      if (res.ok) {
        const { posted } = await res.json();
        setPostMsg(posted > 0 ? `Posted ${posted} expense${posted === 1 ? "" : "s"} for ${currentPeriod}.` : `All recurring expenses for ${currentPeriod} are already posted.`);
        router.refresh();
      } else {
        setPostMsg("Could not post — please try again.");
      }
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="card-surface overflow-hidden">
      <div className="border-b px-4 py-2.5 flex items-center justify-between flex-wrap gap-2">
        <span className="font-semibold text-sm flex items-center gap-1.5">
          <Repeat className="size-4 text-brand-cyan" /> Recurring expenses
          {monthlyTotal > 0 && <span className="text-xs text-muted-foreground font-normal">· {formatINR(monthlyTotal)}/mo</span>}
        </span>
        <div className="flex items-center gap-2">
          <button onClick={() => setOpen((o) => !o)} className="btn-ghost text-xs">
            <Plus className="size-3.5" /> Add template
          </button>
          <button onClick={postMonth} disabled={posting || rows.filter((r) => r.active).length === 0} className="btn-secondary text-xs">
            {posting ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />} Post this month
          </button>
        </div>
      </div>

      {postMsg && <div className="px-4 py-2 text-[11px] text-emerald-700 bg-emerald-50/60 border-b">{postMsg}</div>}

      {open && (
        <div className="px-4 py-3 border-b bg-secondary/20 grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
          <label className="col-span-2 md:col-span-2 block">
            <div className="text-[11px] text-muted-foreground mb-1">Description</div>
            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="input-base text-sm w-full" placeholder="Office rent" />
          </label>
          <label className="block">
            <div className="text-[11px] text-muted-foreground mb-1">Category</div>
            <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="input-base text-sm w-full">
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="text-[11px] text-muted-foreground mb-1">Amount (₹)</div>
            <input type="number" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="input-base text-sm w-full tabular-nums" />
          </label>
          <label className="block">
            <div className="text-[11px] text-muted-foreground mb-1">Day of month</div>
            <input type="number" min={1} max={31} value={form.dayOfMonth} onChange={(e) => setForm((f) => ({ ...f, dayOfMonth: e.target.value }))} className="input-base text-sm w-full tabular-nums" />
          </label>
          <button onClick={add} disabled={busy} className="btn-primary text-xs h-9">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="p-6 text-center text-xs text-muted-foreground">
          No recurring templates yet. Add your fixed monthly costs (rent, salaries, software) once, then post them each month with one click.
        </div>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className={`border-b last:border-0 ${t.active ? "" : "opacity-50"}`}>
                <td className="px-4 py-2.5">
                  <div className="font-medium">{t.description}</div>
                  <div className="text-[11px] text-muted-foreground">{CAT_LABEL[t.category] ?? t.category} · day {t.dayOfMonth}</div>
                </td>
                <td className="py-2.5 text-right tabular-nums font-medium pr-2">{formatINR(Number(t.amount))}</td>
                <td className="py-2.5 pr-2 text-right">
                  <button onClick={() => toggle(t)} className={`text-[11px] px-2 py-0.5 rounded-full ${t.active ? "bg-emerald-50 text-emerald-700" : "bg-secondary text-muted-foreground"}`}>
                    {t.active ? "Active" : "Paused"}
                  </button>
                </td>
                <td className="py-2.5 pr-4 text-right">
                  <button onClick={() => remove(t.id)} className="text-muted-foreground hover:text-rose-600 p-1" title="Delete template" aria-label="Delete">
                    <Trash2 className="size-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
