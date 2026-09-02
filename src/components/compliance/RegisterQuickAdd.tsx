"use client";

/**
 * Quick-add for the three DDQ registers. One small modal per register — the
 * fields are exactly what the questionnaire asks for, nothing more, so filling
 * it takes seconds during an audit scramble.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

type Register = "dsc" | "incident" | "unsuitability";

const TITLE: Record<Register, string> = {
  dsc: "Add self-certification (DDQ 4.26)",
  incident: "Log an incident (DDQ 4.17 / 4.20b / 6.x)",
  unsuitability: "Record unsuitability (DDQ 2.4b)",
};

export function RegisterQuickAdd({ register, defaultFy }: { register: Register; defaultFy?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<Record<string, any>>({});

  const set = (k: string, v: any) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body: Record<string, any> = { register, ...f };
      if (register === "dsc") body.financialYear = f.financialYear || defaultFy;
      const res = await fetch("/api/compliance/registers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "Could not save");
      toast.success("Recorded");
      setOpen(false);
      setF({});
      router.refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Could not save", "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-secondary text-xs gap-1.5">
        <Plus className="size-3.5" /> Add
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <form onSubmit={submit} className="w-full max-w-lg rounded-xl bg-card border border-border shadow-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">{TITLE[register]}</h3>
              <button type="button" onClick={() => setOpen(false)} className="btn-icon size-7" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>

            {register === "dsc" && (
              <>
                <Field label="Financial year">
                  <input className="input-base" defaultValue={defaultFy} onChange={(e) => set("financialYear", e.target.value)} placeholder="2026-27" required />
                </Field>
                <Field label="Subject">
                  <select className="input-base" onChange={(e) => set("subjectType", e.target.value)} defaultValue="self">
                    <option value="self">Self (firm ARN)</option>
                    <option value="sub_distributor">Sub-distributor</option>
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Name (if sub-distributor)"><input className="input-base" onChange={(e) => set("subjectName", e.target.value)} /></Field>
                  <Field label="ARN"><input className="input-base" onChange={(e) => set("arn", e.target.value)} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Status">
                    <select className="input-base" onChange={(e) => set("status", e.target.value)} defaultValue="pending">
                      <option value="pending">Pending</option>
                      <option value="submitted">Submitted</option>
                      <option value="acknowledged">Acknowledged</option>
                    </select>
                  </Field>
                  <Field label="Submitted on"><input type="date" className="input-base" onChange={(e) => set("submittedOn", e.target.value)} /></Field>
                </div>
              </>
            )}

            {register === "incident" && (
              <>
                <Field label="Type">
                  <select className="input-base" onChange={(e) => set("kind", e.target.value)} defaultValue="misselling" required>
                    <option value="misselling">Mis-selling complaint (4.18)</option>
                    <option value="third_party_payment">Third-party payment (4.20b)</option>
                    <option value="regulatory_action">Regulatory action / penalty (6.1)</option>
                    <option value="litigation">Customer litigation (6.2)</option>
                    <option value="arn_euin_suspension">ARN / EUIN suspension (6.3)</option>
                    <option value="warning_letter">Warning letter / show-cause (6.3)</option>
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Occurred on"><input type="date" className="input-base" onChange={(e) => set("occurredOn", e.target.value)} required /></Field>
                  <Field label="AMC (if any)"><input className="input-base" onChange={(e) => set("amcName", e.target.value)} /></Field>
                </div>
                <Field label="What happened"><input className="input-base" onChange={(e) => set("title", e.target.value)} required /></Field>
                <Field label="Remedial action taken"><textarea rows={2} className="input-base" onChange={(e) => set("remedialAction", e.target.value)} /></Field>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" className="size-3.5 accent-brand-cyan" onChange={(e) => set("reportedToAmc", e.target.checked)} />
                  Reported to the concerned AMC
                </label>
              </>
            )}

            {register === "unsuitability" && (
              <>
                <Field label="Client ID (UUID)">
                  <input className="input-base font-mono text-xs" onChange={(e) => set("investorId", e.target.value)} placeholder="paste from the client page URL" required />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Scheme"><input className="input-base" onChange={(e) => set("schemeName", e.target.value)} /></Field>
                  <Field label="Communicated on"><input type="date" className="input-base" onChange={(e) => set("communicatedOn", e.target.value)} required /></Field>
                </div>
                <Field label="Why it's unsuitable"><textarea rows={2} className="input-base" onChange={(e) => set("reason", e.target.value)} required /></Field>
                <div className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" className="size-3.5 accent-brand-cyan" onChange={(e) => set("clientAcknowledged", e.target.checked)} />
                    Client acknowledged the communication
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" className="size-3.5 accent-brand-cyan" onChange={(e) => set("executionOnlyConfirmed", e.target.checked)} />
                    Client confirmed &ldquo;execution only&rdquo; notwithstanding
                  </label>
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setOpen(false)} className="btn-secondary text-xs">Cancel</button>
              <button type="submit" disabled={busy} className="btn-primary text-xs gap-1.5">
                {busy && <Loader2 className="size-3.5 animate-spin" />} Save
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] font-medium text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}
