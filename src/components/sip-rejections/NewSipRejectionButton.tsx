"use client";

/**
 * "New rejection" — manually log a SIP rejection (for rejections that didn't
 * arrive via the RTA feed). Posts to /api/sip-rejections, which creates the
 * recovery row + auto-task + RM notification, same as a feed-ingested one.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Plus, Loader2, X } from "lucide-react";
import { InvestorLookup } from "@/components/common/InvestorLookup";
import { DateField } from "@/components/ui/DateField";
import { SelectField } from "@/components/ui/SelectField";
import { useToast } from "@/components/ui/Toast";

const REASONS = [
  "Mandate expired / inactive",
  "Insufficient balance",
  "Technical / bank issue",
  "Other",
];

export function NewSipRejectionButton() {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [investorId, setInvestorId] = useState<string | null>(null);
  const [investorName, setInvestorName] = useState<string | null>(null);
  const [form, setForm] = useState({
    rejectionDate: new Date().toISOString().slice(0, 10),
    rejectionAmount: "",
    rejectionReason: "",
    schemeName: "",
    folioNumber: "",
    amcName: "",
    remarks: "",
  });
  const set = (k: keyof typeof form, v: string) => setForm((s) => ({ ...s, [k]: v }));

  function reset() {
    setInvestorId(null);
    setInvestorName(null);
    setForm({ rejectionDate: new Date().toISOString().slice(0, 10), rejectionAmount: "", rejectionReason: "", schemeName: "", folioNumber: "", amcName: "", remarks: "" });
    setErr(null);
  }

  async function save() {
    if (!investorId) { setErr("Pick a client."); return; }
    const amt = Number(form.rejectionAmount);
    if (!(amt > 0)) { setErr("Enter a valid rejection amount."); return; }
    if (!form.rejectionDate) { setErr("Pick the rejection date."); return; }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/sip-rejections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          investorId,
          rejectionDate: new Date(form.rejectionDate).toISOString(),
          rejectionAmount: amt,
          rejectionReason: form.rejectionReason || undefined,
          schemeName: form.schemeName || undefined,
          folioNumber: form.folioNumber || undefined,
          amcName: form.amcName || undefined,
          remarks: form.remarks || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j.error ?? "Failed to save"); return; }
      toast.success("SIP rejection logged.");
      setOpen(false);
      reset();
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  const modal = (
    <div className="fixed inset-0 z-[100] bg-black/40 grid place-items-center p-4 animate-fade-in" onClick={() => !busy && setOpen(false)}>
      <div className="bg-card rounded-xl shadow-xl border border-border/60 max-w-lg w-full max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border px-5 py-3 flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2"><Plus className="size-4 text-brand-cyan" /> Log SIP rejection</h2>
          <button onClick={() => setOpen(false)} className="rounded p-1 hover:bg-secondary text-muted-foreground" aria-label="Close"><X className="size-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3 scrollbar-thin">
          <label className="block">
            <div className="text-xs font-medium mb-1">Client <span className="text-rose-600">*</span></div>
            <InvestorLookup
              value={investorId}
              displayName={investorName}
              onSelect={(id, name) => { setInvestorId(id); setInvestorName(name); }}
              onClear={() => { setInvestorId(null); setInvestorName(null); }}
              placeholder="Search a client…"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <div className="text-xs font-medium mb-1">Rejection date <span className="text-rose-600">*</span></div>
              <DateField value={form.rejectionDate} onChange={(e) => set("rejectionDate", e.target.value)} className="w-full" />
            </label>
            <label className="block">
              <div className="text-xs font-medium mb-1">Amount (₹) <span className="text-rose-600">*</span></div>
              <input type="number" min={1} value={form.rejectionAmount} onChange={(e) => set("rejectionAmount", e.target.value)} placeholder="e.g. 10000" className="input-base tabular-nums" />
            </label>
          </div>

          <label className="block">
            <div className="text-xs font-medium mb-1">Reason</div>
            <SelectField value={form.rejectionReason} onChange={(e) => set("rejectionReason", e.target.value)} placeholder="Pick a reason…" className="w-full">
              <option value="">Select…</option>
              {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </SelectField>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <div className="text-xs font-medium mb-1">Scheme</div>
              <input value={form.schemeName} onChange={(e) => set("schemeName", e.target.value)} placeholder="Scheme name" className="input-base" />
            </label>
            <label className="block">
              <div className="text-xs font-medium mb-1">AMC</div>
              <input value={form.amcName} onChange={(e) => set("amcName", e.target.value)} placeholder="AMC" className="input-base" />
            </label>
            <label className="block">
              <div className="text-xs font-medium mb-1">Folio no.</div>
              <input value={form.folioNumber} onChange={(e) => set("folioNumber", e.target.value)} className="input-base" />
            </label>
          </div>

          <label className="block">
            <div className="text-xs font-medium mb-1">Remarks</div>
            <textarea value={form.remarks} onChange={(e) => set("remarks", e.target.value)} rows={2} className="input-base" />
          </label>

          {err && <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-xs px-3 py-2">{err}</div>}
        </div>

        <div className="border-t border-border px-5 py-3 flex justify-end gap-2">
          <button onClick={() => setOpen(false)} className="btn-secondary text-sm">Cancel</button>
          <button onClick={save} disabled={busy || !investorId} className="btn-primary text-sm">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {busy ? "Saving…" : "Log rejection"}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-primary text-xs">
        <Plus className="size-3.5" /> New rejection
      </button>
      {open && typeof document !== "undefined" && createPortal(modal, document.body)}
    </>
  );
}
