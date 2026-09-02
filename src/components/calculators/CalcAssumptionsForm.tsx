"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

type Assumptions = {
  returnPct: number;
  inflationPct: number;
  educationInflationPct: number;
  debtReturnPct: number;
};

export function CalcAssumptionsForm({
  initial,
  canManage,
}: {
  initial: Assumptions;
  canManage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [returnPct, setReturnPct] = useState(initial.returnPct);
  const [inflationPct, setInflationPct] = useState(initial.inflationPct);
  const [educationInflationPct, setEducationInflationPct] = useState(initial.educationInflationPct);
  const [debtReturnPct, setDebtReturnPct] = useState(initial.debtReturnPct);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/calculators/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          returnPct: Number(returnPct) || 0,
          inflationPct: Number(inflationPct) || 0,
          educationInflationPct: Number(educationInflationPct) || 0,
          debtReturnPct: Number(debtReturnPct) || 0,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? `Save failed (${res.status})`, "Could not save");
        return;
      }
      toast.success("Calculator assumptions updated.");
      router.refresh();
    } catch {
      toast.error("Network error. Please try again.", "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-surface p-5 space-y-5 max-w-3xl">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Default expected return %">
          <input
            type="number"
            min={0}
            max={30}
            step={0.1}
            value={returnPct}
            onChange={(e) => setReturnPct(e.target.valueAsNumber || 0)}
            disabled={!canManage}
            className="input-base"
          />
        </Field>
        <Field label="Default inflation %">
          <input
            type="number"
            min={0}
            max={25}
            step={0.1}
            value={inflationPct}
            onChange={(e) => setInflationPct(e.target.valueAsNumber || 0)}
            disabled={!canManage}
            className="input-base"
          />
        </Field>
        <Field label="Education inflation %">
          <input
            type="number"
            min={0}
            max={25}
            step={0.1}
            value={educationInflationPct}
            onChange={(e) => setEducationInflationPct(e.target.valueAsNumber || 0)}
            disabled={!canManage}
            className="input-base"
          />
        </Field>
        <Field label="Debt/conservative return %">
          <input
            type="number"
            min={0}
            max={30}
            step={0.1}
            value={debtReturnPct}
            onChange={(e) => setDebtReturnPct(e.target.valueAsNumber || 0)}
            disabled={!canManage}
            className="input-base"
          />
        </Field>
      </div>

      <p className="text-[11px] text-muted-foreground">
        These seed the default values across every calculator (SIP, goal, retirement,
        child-education, asset-allocation). Advisors can still override them per calculation.
      </p>

      {canManage ? (
        <div className="flex justify-end pt-2 border-t border-border">
          <button onClick={save} disabled={busy} className="btn-primary">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
            settings
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground border-t border-border pt-3">
          Only an owner or branch head can change these settings.
        </p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-semibold text-foreground/80 mb-1.5">{label}</div>
      {children}
    </label>
  );
}
