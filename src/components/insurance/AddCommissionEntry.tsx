"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, X } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { useToast } from "@/components/ui/Toast";

export const COMMISSION_TYPE_LABELS: Record<string, string> = {
  first_year: "First-year",
  trail_renewal: "Trail / Renewal",
  override: "Override",
  bonus: "Bonus",
  reward: "Reward",
  other: "Other",
};

/** Button + modal to record a manual commission receipt. */
export function AddCommissionEntry() {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [f, setF] = useState({
    entryDate: today,
    insurer: "",
    commissionType: "first_year",
    grossAmount: "",
    tdsAmount: "",
    netAmount: "",
    periodLabel: "",
    referenceNo: "",
    policyNumber: "",
    notes: "",
  });
  function set<K extends keyof typeof f>(k: K, v: string) {
    setF((s) => {
      const next = { ...s, [k]: v };
      // Auto-fill net = gross − TDS unless the user typed a net themselves.
      if (k === "grossAmount" || k === "tdsAmount") {
        const g = Number(k === "grossAmount" ? v : next.grossAmount) || 0;
        const t = Number(k === "tdsAmount" ? v : next.tdsAmount) || 0;
        if (s.netAmount === "" || s.netAmount === String(Math.max(0, (Number(s.grossAmount) || 0) - (Number(s.tdsAmount) || 0)))) {
          next.netAmount = String(Math.max(0, g - t));
        }
      }
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/insurance/commission-entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entryDate: f.entryDate,
          insurer: f.insurer || undefined,
          commissionType: f.commissionType,
          grossAmount: Number(f.grossAmount) || 0,
          tdsAmount: Number(f.tdsAmount) || 0,
          netAmount: f.netAmount === "" ? undefined : Number(f.netAmount),
          periodLabel: f.periodLabel || undefined,
          referenceNo: f.referenceNo || undefined,
          policyNumber: f.policyNumber || undefined,
          notes: f.notes || undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Could not save");
        return;
      }
      toast.success("Commission recorded");
      setOpen(false);
      setF({ ...f, grossAmount: "", tdsAmount: "", netAmount: "", referenceNo: "", policyNumber: "", notes: "" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-primary text-sm">
        <Plus className="size-4" /> Add commission
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 grid place-items-center p-4" onClick={() => !busy && setOpen(false)}>
          <div className="card-surface w-full max-w-lg p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Record commission received</h2>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Date *">
                <input type="date" value={f.entryDate} onChange={(e) => set("entryDate", e.target.value)} className="input-base" />
              </Field>
              <Field label="Type">
                <SelectField value={f.commissionType} onChange={(e) => set("commissionType", e.target.value)} className="w-full">
                  {Object.entries(COMMISSION_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </SelectField>
              </Field>
              <Field label="Insurer">
                <input value={f.insurer} onChange={(e) => set("insurer", e.target.value)} placeholder="HDFC Life, Star Health…" className="input-base" />
              </Field>
              <Field label="Policy number (optional)">
                <input value={f.policyNumber} onChange={(e) => set("policyNumber", e.target.value)} className="input-base" />
              </Field>
              <Field label="Gross amount ₹ *">
                <input type="number" min={0} value={f.grossAmount} onChange={(e) => set("grossAmount", e.target.value)} className="input-base tabular-nums" />
              </Field>
              <Field label="TDS ₹">
                <input type="number" min={0} value={f.tdsAmount} onChange={(e) => set("tdsAmount", e.target.value)} className="input-base tabular-nums" />
              </Field>
              <Field label="Net amount ₹">
                <input type="number" min={0} value={f.netAmount} onChange={(e) => set("netAmount", e.target.value)} className="input-base tabular-nums" />
              </Field>
              <Field label="Period (optional)">
                <input value={f.periodLabel} onChange={(e) => set("periodLabel", e.target.value)} placeholder="Jun 2026 / FY25-26 Q1" className="input-base" />
              </Field>
              <Field label="Reference / statement no.">
                <input value={f.referenceNo} onChange={(e) => set("referenceNo", e.target.value)} className="input-base" />
              </Field>
            </div>
            <Field label="Notes">
              <textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className="input-base" />
            </Field>

            {err && <div className="text-sm text-rose-600">{err}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setOpen(false)} className="btn-secondary text-sm">Cancel</button>
              <button onClick={save} disabled={busy || !f.entryDate} className="btn-primary text-sm disabled:opacity-50">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-foreground/80 mb-1">{label}</span>
      {children}
    </label>
  );
}
