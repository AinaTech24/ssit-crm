"use client";

import { useState } from "react";
import { Loader2, Save, Check } from "lucide-react";
import { LEAVE_TYPE_LABELS } from "@/lib/leave/policy";

type Entitlements = Record<string, number | null>;

// Order shown in the form. unpaid/other are typically uncapped (blank).
const TYPES = ["casual", "sick", "earned", "comp_off", "unpaid", "other"] as const;

export function LeaveSettingsForm({
  initial,
  canManage,
}: {
  initial: { entitlements: Entitlements; carryForwardEarned: boolean };
  canManage: boolean;
}) {
  // Blank string = uncapped (null). Numeric string = capped days.
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const t of TYPES) {
      const v = initial.entitlements?.[t];
      m[t] = v == null ? "" : String(v);
    }
    return m;
  });
  const [carry, setCarry] = useState(!!initial.carryForwardEarned);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      const entitlements: Entitlements = {};
      for (const t of TYPES) {
        const raw = vals[t]?.trim();
        entitlements[t] = raw === "" || raw == null ? null : Math.max(0, Math.min(365, Math.round(Number(raw))));
      }
      const res = await fetch("/api/leave-applications/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entitlements, carryForwardEarned: carry }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? `Save failed (${res.status})`); return; }
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-surface p-5 space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        {TYPES.map((t) => (
          <label key={t} className="block">
            <div className="text-xs font-semibold text-foreground/80 mb-1.5">{LEAVE_TYPE_LABELS[t]}</div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={365}
                step={1}
                value={vals[t]}
                disabled={!canManage}
                placeholder="Uncapped"
                onChange={(e) => { setVals((v) => ({ ...v, [t]: e.target.value })); setSaved(false); }}
                className="input-base w-32 tabular-nums"
              />
              <span className="text-xs text-muted-foreground">days / year{vals[t]?.trim() === "" ? " (uncapped)" : ""}</span>
            </div>
          </label>
        ))}
      </div>

      <label className="flex items-center gap-2 text-sm pt-1">
        <input
          type="checkbox"
          checked={carry}
          disabled={!canManage}
          onChange={(e) => { setCarry(e.target.checked); setSaved(false); }}
          className="size-4"
        />
        Carry forward unused earned leave to next financial year
      </label>

      <p className="text-[11px] text-muted-foreground">
        Leave blank for uncapped (no annual limit). Per-employee custom entitlements override these firm-wide values.
      </p>

      {err && <div className="border border-destructive/30 bg-destructive/5 text-destructive rounded-lg px-3 py-2 text-sm">{err}</div>}

      {canManage ? (
        <div className="flex items-center gap-3 justify-end pt-2 border-t border-border">
          {saved && <span className="text-sm text-emerald-600 inline-flex items-center gap-1"><Check className="size-4" /> Saved</span>}
          <button onClick={save} disabled={busy} className="btn-primary">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save policy
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground pt-2 border-t border-border">Only an owner or branch head can change the leave policy.</p>
      )}
    </div>
  );
}
