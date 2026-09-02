"use client";

/**
 * Expected inflows for one client — add "he gets ₹12L in March" in ~10 seconds,
 * while still on the call. Saving schedules the reminder task automatically.
 */

import { useEffect, useState } from "react";
import { IndianRupee, Plus, Loader2, Trash2, BellRing, CheckCircle2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";

type Row = {
  id: string;
  sourceType: string;
  expectedAmount: string | null;
  expectedOn: string;
  confidence: string;
  status: string;
  notes: string | null;
  ownerName?: string | null;
};

const SOURCES: [string, string][] = [
  ["fd_maturity", "FD maturity"],
  ["insurance_maturity", "Insurance / LIC maturity"],
  ["bonus", "Annual bonus"],
  ["property_sale", "Property sale"],
  ["gratuity", "Gratuity / retirement"],
  ["esop", "ESOP / RSU"],
  ["ppf_epf", "PPF / EPF maturity"],
  ["inheritance", "Inheritance"],
  ["rent", "Rental income"],
  ["business_income", "Business income"],
  ["other", "Other"],
];
const LABEL = Object.fromEntries(SOURCES);
const inr = (n: any) => (n == null || n === "" ? "—" : "₹" + Math.round(Number(n)).toLocaleString("en-IN"));

export function ExpectedInflowsCard({ investorId }: { investorId: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [sourceType, setSourceType] = useState("fd_maturity");
  const [amount, setAmount] = useState("");
  const [expectedOn, setExpectedOn] = useState("");
  const [confidence, setConfidence] = useState("medium");
  const [remindDays, setRemindDays] = useState("14");
  const [notes, setNotes] = useState("");

  async function load() {
    try {
      const r = await fetch(`/api/expected-inflows?investorId=${investorId}`);
      const j = await r.json().catch(() => ({}));
      if (r.ok) setRows(Array.isArray(j.inflows) ? j.inflows : []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [investorId]);

  async function save() {
    if (!expectedOn) return toast.error("Pick the date the money is expected", "Date required");
    setBusy(true);
    try {
      const res = await fetch("/api/expected-inflows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          investorId,
          sourceType,
          expectedAmount: amount.trim() ? Number(amount.replace(/[^\d.]/g, "")) : null,
          expectedOn,
          confidence,
          remindDaysBefore: Number(remindDays) || 14,
          notes: notes.trim() || null,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not save");
      toast.success("Saved — a reminder task is scheduled for the owner", "Inflow tracked");
      setOpen(false);
      setAmount(""); setExpectedOn(""); setNotes(""); setConfidence("medium"); setRemindDays("14");
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save", "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: string) {
    const res = await fetch(`/api/expected-inflows/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) { toast.success(`Marked ${status.replace(/_/g, " ")}`); load(); }
    else toast.error("Could not update", "Update failed");
  }

  async function remove(id: string) {
    const res = await fetch(`/api/expected-inflows/${id}`, { method: "DELETE" });
    if (res.ok) { toast.success("Removed"); load(); }
  }

  const openRows = rows.filter((r) => ["expected", "confirmed"].includes(r.status));
  const total = openRows.reduce((n, r) => n + (Number(r.expectedAmount) || 0), 0);

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-semibold flex items-center gap-2">
          <IndianRupee className="size-4 text-emerald-600" /> Expected inflows
          {openRows.length > 0 && (
            <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full tabular-nums">
              {inr(total)} upcoming
            </span>
          )}
        </h3>
        <button type="button" onClick={() => setOpen((v) => !v)} className="btn-secondary text-xs inline-flex items-center gap-1.5">
          <Plus className="size-3.5" /> Add
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground mt-1">
        &ldquo;My FD matures in March&rdquo; — capture it here and the CRM reminds the owner before the date.
      </p>

      {open && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/30 p-3 space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Source</span>
              <SelectField value={sourceType} onChange={(e) => setSourceType(e.target.value)} size="sm" className="w-full">
                {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </SelectField>
            </label>
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Amount (₹)</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1200000" inputMode="numeric" className="input-base h-8 text-xs w-full" />
            </label>
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Expected on</span>
              <DateField value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} size="sm" className="w-full" />
            </label>
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Remind me (days before)</span>
              <input value={remindDays} onChange={(e) => setRemindDays(e.target.value)} inputMode="numeric" className="input-base h-8 text-xs w-full" />
            </label>
          </div>
          <label className="block">
            <span className="text-[11px] text-muted-foreground">Confidence</span>
            <SelectField value={confidence} onChange={(e) => setConfidence(e.target.value)} size="sm" className="w-full">
              <option value="high">High — he confirmed the date</option>
              <option value="medium">Medium — roughly that month</option>
              <option value="low">Low — vague, worth tracking</option>
            </SelectField>
          </label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note (e.g. HDFC FD, wants to stagger into equity)" className="input-base h-8 text-xs w-full" />
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={busy} className="btn-primary text-xs inline-flex items-center gap-1 disabled:opacity-50">
              {busy ? <Loader2 className="size-3 animate-spin" /> : <BellRing className="size-3" />} Save & set reminder
            </button>
            <button onClick={() => setOpen(false)} className="btn-ghost text-xs">Cancel</button>
          </div>
        </div>
      )}

      <div className="mt-4">
        {loading ? (
          <div className="text-xs text-muted-foreground py-4 text-center inline-flex items-center gap-2 justify-center w-full">
            <Loader2 className="size-3.5 animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center">Nothing tracked yet for this client.</p>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => {
              const past = r.expectedOn < new Date().toISOString().slice(0, 10);
              const isOpen = ["expected", "confirmed"].includes(r.status);
              return (
                <li key={r.id} className="py-2.5 flex items-start gap-3 group">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {LABEL[r.sourceType] ?? r.sourceType} · <span className="tabular-nums">{inr(r.expectedAmount)}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {new Date(`${r.expectedOn}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      {past && isOpen && <span className="text-rose-600 font-semibold"> · date passed</span>}
                      {" · "}{r.confidence} confidence
                      {r.notes ? ` · ${r.notes}` : ""}
                    </div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${isOpen ? "bg-secondary text-muted-foreground" : "bg-emerald-50 text-emerald-700"}`}>
                    {r.status.replace(/_/g, " ")}
                  </span>
                  {isOpen && (
                    <button onClick={() => setStatus(r.id, "invested")} title="Mark invested"
                      className="shrink-0 text-muted-foreground hover:text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity">
                      <CheckCircle2 className="size-4" />
                    </button>
                  )}
                  <button onClick={() => remove(r.id)} title="Remove"
                    className="shrink-0 text-muted-foreground hover:text-rose-600 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Trash2 className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
