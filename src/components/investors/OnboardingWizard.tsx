"use client";

/**
 * OnboardingWizard — a guided, multi-step client-onboarding flow (Zoho
 * "Wizards" / Guided Selling parity) for the #1 MFD pain: getting a client
 * fully set up. Walks Contact → KYC → Risk → Nominee → Bank, saving each step
 * via the existing investor PATCH, with a progress bar + per-step completeness.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X, ArrowRight, ArrowLeft, Check, ClipboardList, CheckCircle2 } from "lucide-react";

type Inv = Record<string, any>;
const STEPS = [
  { key: "contact", label: "Contact", fields: ["email", "phone", "whatsappPhone"], required: ["phone"] },
  { key: "kyc", label: "KYC", fields: ["kycStatus", "panAadhaarLinkStatus", "nameAsPerPan"], required: ["kycStatus"] },
  { key: "risk", label: "Risk profile", fields: ["riskProfile"], required: ["riskProfile"] },
  { key: "nominee", label: "Nominee", fields: ["nomineeName", "nomineeRelation"], required: ["nomineeName"] },
  { key: "bank", label: "Bank", fields: ["bankName", "bankAccountNumberMasked", "bankIfsc"], required: ["bankAccountNumberMasked"] },
] as const;

const OPTS: Record<string, [string, string][]> = {
  kycStatus: [["pending", "Pending"], ["registered", "Registered"], ["verified", "Verified"], ["hold", "On hold"], ["rejected", "Rejected"], ["re_kyc_required", "Re-KYC required"]],
  panAadhaarLinkStatus: [["linked", "Linked"], ["not_linked", "Not linked"], ["pending", "Pending"], ["not_applicable", "N/A"]],
  riskProfile: [["conservative", "Conservative"], ["moderate", "Moderate"], ["aggressive", "Aggressive"], ["very_aggressive", "Very aggressive"]],
};
const LABELS: Record<string, string> = {
  email: "Email", phone: "Phone", whatsappPhone: "WhatsApp number", kycStatus: "KYC status", panAadhaarLinkStatus: "PAN–Aadhaar link", nameAsPerPan: "Name as per PAN",
  riskProfile: "Risk profile", nomineeName: "Nominee name", nomineeRelation: "Nominee relation", bankName: "Bank name", bankAccountNumberMasked: "Account no.", bankIfsc: "IFSC",
};

export function OnboardingWizardButton({ investor, investorId }: { investor: Inv; investorId: string }) {
  const [open, setOpen] = useState(false);
  const doneCount = STEPS.filter((s) => s.required.every((f) => investor[f])).length;
  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-secondary text-xs inline-flex items-center gap-1" title="Guided onboarding">
        <ClipboardList className="size-3.5" /> Onboarding {doneCount < STEPS.length ? `(${doneCount}/${STEPS.length})` : "✓"}
      </button>
      {open && <Wizard investor={investor} investorId={investorId} onClose={() => setOpen(false)} />}
    </>
  );
}

function Wizard({ investor, investorId, onClose }: { investor: Inv; investorId: string; onClose: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Inv>(() => ({ ...investor }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [doneAll, setDoneAll] = useState(false);
  const set = (k: string, v: any) => setF((s) => ({ ...s, [k]: v }));
  const cur = STEPS[step];
  const isDone = (s: (typeof STEPS)[number]) => s.required.every((k) => f[k]);

  async function saveStep(advance: boolean) {
    setBusy(true); setErr(null);
    try {
      const payload: Inv = {};
      for (const k of cur.fields) if (f[k] !== undefined && f[k] !== investor[k]) payload[k] = f[k] === "" ? undefined : f[k];
      if (Object.keys(payload).length) {
        const res = await fetch(`/api/investors/${investorId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
        if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Save failed"); return; }
      }
      if (advance) { if (step < STEPS.length - 1) setStep(step + 1); else { setDoneAll(true); router.refresh(); } }
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg h-full bg-card border-l shadow-2xl flex flex-col">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <div className="font-semibold flex items-center gap-2"><ClipboardList className="size-4 text-brand-cyan" /> Client onboarding</div>
          <button onClick={onClose} className="rounded p-1 hover:bg-accent"><X className="size-4" /></button>
        </div>

        {/* Stepper */}
        <div className="px-4 py-3 border-b flex items-center gap-1">
          {STEPS.map((s, i) => (
            <button key={s.key} onClick={() => setStep(i)} className="flex items-center gap-1 flex-1 min-w-0">
              <span className={`size-6 shrink-0 rounded-full grid place-items-center text-[11px] font-bold ${i === step ? "bg-brand-cyan text-white" : isDone(s) ? "bg-emerald-100 text-emerald-700" : "bg-secondary text-muted-foreground"}`}>
                {isDone(s) ? <Check className="size-3" /> : i + 1}
              </span>
              {i < STEPS.length - 1 && <span className={`h-0.5 flex-1 ${isDone(s) ? "bg-emerald-300" : "bg-border"}`} />}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {doneAll ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
              <CheckCircle2 className="size-12 text-emerald-500" />
              <div className="font-semibold">Onboarding saved.</div>
              <p className="text-sm text-muted-foreground">{STEPS.filter(isDone).length} of {STEPS.length} steps complete.</p>
              <button onClick={onClose} className="btn-primary text-sm mt-2">Done</button>
            </div>
          ) : (
            <>
              <div className="text-sm font-semibold">{cur.label} <span className="text-xs text-muted-foreground font-normal">· step {step + 1} of {STEPS.length}</span></div>
              {cur.fields.map((k) => (
                <label key={k} className="block">
                  <div className="text-[11px] text-muted-foreground mb-0.5">{LABELS[k] ?? k}{(cur.required as readonly string[]).includes(k) ? " *" : ""}</div>
                  {OPTS[k] ? (
                    <select value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} className="input-base"><option value="">Select…</option>{OPTS[k].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  ) : (
                    <input value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} className="input-base" />
                  )}
                </label>
              ))}
              {err && <div className="text-sm text-rose-600">{err}</div>}
            </>
          )}
        </div>

        {!doneAll && (
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-t">
            <button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0} className="btn-secondary text-xs inline-flex items-center gap-1 disabled:opacity-40"><ArrowLeft className="size-3.5" /> Back</button>
            <div className="flex gap-2">
              <button onClick={() => saveStep(false)} disabled={busy} className="btn-ghost text-xs">Save</button>
              <button onClick={() => saveStep(true)} disabled={busy} className="btn-primary text-xs inline-flex items-center gap-1">{busy ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />} {step < STEPS.length - 1 ? "Save & next" : "Finish"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
