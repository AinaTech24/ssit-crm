"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, AlertCircle, CheckCircle2, ArrowRight, Workflow, Clock } from "lucide-react";

interface Stage {
  id: string;
  stageKey: string;
  stageName: string;
  description: string;
  stageOrder: number;
  ownerRole: string;
  slaDays: number | null;
  requiredFields: string[];
  allowedActions: string[];
  automationsOnEnter: string[];
}
interface Transition {
  fromStageKey: string;
  toStageKey: string;
  transitionName: string;
}

export function BlueprintStageEditor({
  blueprintId,
  stages: initial,
  transitions,
}: {
  blueprintId: string;
  stages: Stage[];
  transitions: Transition[];
}) {
  const router = useRouter();
  const [stages, setStages] = useState<Stage[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function update<K extends keyof Stage>(i: number, k: K, v: Stage[K]) {
    setStages((p) => p.map((s, ix) => (ix === i ? { ...s, [k]: v } : s)));
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const r = await fetch(`/api/blueprints/${blueprintId}/stages`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stages }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setSaved(true);
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="card-surface p-3 text-xs text-rose-700 bg-rose-50/40 flex items-start gap-2">
          <AlertCircle className="size-3.5 mt-0.5" /> {error}
        </div>
      )}
      {saved && (
        <div className="card-surface p-3 text-xs text-emerald-700 bg-emerald-50/40 flex items-center gap-2">
          <CheckCircle2 className="size-3.5" /> Saved
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Stages ({stages.length})
        </h3>
        <button onClick={save} disabled={busy} className="btn-primary text-sm">
          <Save className="size-4" /> {busy ? "Saving…" : "Save changes"}
        </button>
      </div>

      <div className="space-y-3">
        {stages.map((s, i) => (
          <div key={s.id} className="card-surface p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="chip text-[10px] bg-brand-cyan-light text-brand-cyan-deep">{s.stageOrder}</span>
              <input
                value={s.stageName}
                onChange={(e) => update(i, "stageName", e.target.value)}
                className="input-base text-sm font-semibold flex-1"
              />
              <span className="text-[10px] text-muted-foreground font-mono">{s.stageKey}</span>
            </div>
            <textarea
              value={s.description}
              onChange={(e) => update(i, "description", e.target.value)}
              rows={1}
              placeholder="Stage description"
              className="input-base text-xs w-full"
            />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Owner role">
                <select
                  value={s.ownerRole}
                  onChange={(e) => update(i, "ownerRole", e.target.value)}
                  className="input-base text-xs w-full"
                >
                  <option value="">Select…</option>
                  <option value="sales">Sales / RM</option>
                  <option value="back_office">Back Office</option>
                  <option value="operations">Operations</option>
                  <option value="compliance">Compliance</option>
                  <option value="owner">Owner</option>
                </select>
              </Field>
              <Field label="SLA (days)">
                <input
                  type="number"
                  min={0}
                  value={s.slaDays ?? ""}
                  onChange={(e) => update(i, "slaDays", e.target.value === "" ? null : Number(e.target.value))}
                  className="input-base text-xs w-full"
                  placeholder="(none)"
                />
              </Field>
              <Field label="Required fields (comma-separated)">
                <input
                  value={s.requiredFields.join(", ")}
                  onChange={(e) => update(i, "requiredFields", e.target.value.split(",").map((v) => v.trim()).filter(Boolean))}
                  className="input-base text-xs w-full font-mono"
                />
              </Field>
              <Field label="Allowed actions (comma-separated)">
                <input
                  value={s.allowedActions.join(", ")}
                  onChange={(e) => update(i, "allowedActions", e.target.value.split(",").map((v) => v.trim()).filter(Boolean))}
                  className="input-base text-xs w-full font-mono"
                />
              </Field>
              <Field label="Recipes to fire on enter (comma-separated recipe keys)">
                <input
                  value={s.automationsOnEnter.join(", ")}
                  onChange={(e) =>
                    update(i, "automationsOnEnter", e.target.value.split(",").map((v) => v.trim()).filter(Boolean))
                  }
                  className="input-base text-xs w-full font-mono"
                  placeholder="e.g. lead_welcome"
                />
              </Field>
            </div>
          </div>
        ))}
      </div>

      <div className="card-surface p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Transitions ({transitions.length})
        </h3>
        <ul className="space-y-1.5">
          {transitions.map((t, i) => (
            <li key={i} className="text-xs flex items-center gap-2">
              <span className="font-mono text-muted-foreground">{t.fromStageKey}</span>
              <ArrowRight className="size-3 text-muted-foreground" />
              <span className="font-mono text-muted-foreground">{t.toStageKey}</span>
              <span className="text-muted-foreground italic">— {t.transitionName}</span>
            </li>
          ))}
        </ul>
        <p className="text-[10px] text-muted-foreground italic mt-2">
          Transitions are seeded with the default flow. Editing transitions is a Phase-2 capability — for now,
          stage order in the editor dictates the implicit forward flow.
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}
