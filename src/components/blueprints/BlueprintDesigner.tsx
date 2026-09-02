"use client";

/**
 * BlueprintDesigner — Zoho-style "Design a Blueprint" editor.
 *
 * Two-pane layout:
 *   - Stages list (cards): add / edit / delete / reorder
 *   - Transitions list (rows): from → to, transition name, allowed roles
 *
 * Single Save button → PUT /api/blueprints/[id]/design hits an atomic
 * upsert/delete transaction. The server refuses to delete stages with
 * live instances and returns 409, surfaced inline.
 *
 * Why a list-based editor and not a node-graph canvas: 95 % of Zoho's
 * Blueprint customers use the list view because it scales past ~10
 * states better than a visual canvas and reads well on a phone. We can
 * layer a React Flow canvas on top later as an optional "Visual
 * preview" tab — it would just render the same state.
 *
 * Stage key rules:
 *   - Lowercase letters, numbers, underscore — matches what the engine
 *     accepts elsewhere.
 *   - Immutable after first save (referenced by history + instance
 *     pointer rows). To rename: delete + add new + re-route transitions.
 *   - The UI hard-locks the key field once the stage has an `id`.
 *
 * Allowed roles is a fixed enum the rest of the auth system already
 * understands — owner / branch_head / rm / back_office / ops /
 * compliance / marketing.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Plus,
  Save,
  Trash2,
  Workflow,
  Power,
  PowerOff,
} from "lucide-react";

const OWNER_ROLES = [
  { v: "", label: "—" },
  { v: "owner", label: "Owner" },
  { v: "sales", label: "Sales / RM" },
  { v: "back_office", label: "Back Office" },
  { v: "operations", label: "Operations" },
  { v: "compliance", label: "Compliance" },
];

const TRANSITION_ROLES = [
  "owner",
  "branch_head",
  "rm",
  "back_office",
  "ops",
  "compliance",
  "marketing",
];

export type StageDraft = {
  /** Present only for stages already saved. Acts as the "is persisted" flag. */
  id?: string;
  stageKey: string;
  stageName: string;
  description: string;
  stageOrder: number;
  ownerRole: string;
  slaDays: number | null;
  requiredFields: string[];
  allowedActions: string[];
  automationsOnEnter: string[];
};

export type TransitionDraft = {
  /** Present only for transitions already saved. */
  id?: string;
  fromStageKey: string;
  toStageKey: string;
  transitionName: string;
  allowedRoles: string[];
};

export function BlueprintDesigner({
  blueprintId,
  moduleName,
  initial,
}: {
  blueprintId: string;
  moduleName: string;
  initial: {
    blueprintName: string;
    description: string;
    isActive: boolean;
    stages: StageDraft[];
    transitions: TransitionDraft[];
  };
}) {
  const router = useRouter();
  const [meta, setMeta] = useState({
    blueprintName: initial.blueprintName,
    description: initial.description,
    isActive: initial.isActive,
  });
  const [stages, setStages] = useState<StageDraft[]>(initial.stages);
  const [transitions, setTransitions] = useState<TransitionDraft[]>(initial.transitions);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // ── Stage helpers ─────────────────────────────────────────────────────
  function addStage() {
    setStages((prev) => {
      const maxOrder = prev.reduce((m, s) => Math.max(m, s.stageOrder), 0);
      const draft: StageDraft = {
        stageKey: "",
        stageName: "",
        description: "",
        stageOrder: maxOrder + 1,
        ownerRole: "",
        slaDays: null,
        requiredFields: [],
        allowedActions: [],
        automationsOnEnter: [],
      };
      return [...prev, draft];
    });
  }
  function updateStage(idx: number, patch: Partial<StageDraft>) {
    setStages((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }
  function removeStage(idx: number) {
    const target = stages[idx];
    if (!target) return;
    // Cascade-remove transitions that touch this stage to keep the form
    // valid (server would reject otherwise — same effect).
    setTransitions((prev) =>
      prev.filter(
        (t) =>
          t.fromStageKey !== target.stageKey && t.toStageKey !== target.stageKey
      )
    );
    setStages((prev) => prev.filter((_, i) => i !== idx));
  }
  function moveStage(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= stages.length) return;
    setStages((prev) => {
      const copy = [...prev];
      [copy[idx], copy[j]] = [copy[j], copy[idx]];
      // Renumber so the order is stable
      return copy.map((s, i) => ({ ...s, stageOrder: i + 1 }));
    });
  }

  // ── Transition helpers ─────────────────────────────────────────────────
  function addTransition() {
    const first = stages[0]?.stageKey ?? "";
    const second = stages[1]?.stageKey ?? first;
    setTransitions((prev) => [
      ...prev,
      {
        fromStageKey: first,
        toStageKey: second,
        transitionName: "Move forward",
        allowedRoles: [],
      },
    ]);
  }
  function updateTransition(idx: number, patch: Partial<TransitionDraft>) {
    setTransitions((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  }
  function removeTransition(idx: number) {
    setTransitions((prev) => prev.filter((_, i) => i !== idx));
  }

  // ── Validation surface ─────────────────────────────────────────────────
  const validation = useMemo(() => {
    const errors: string[] = [];
    if (!meta.blueprintName.trim()) errors.push("Blueprint name is required.");
    if (stages.length === 0) errors.push("Add at least one stage.");
    const keys = new Set<string>();
    for (const s of stages) {
      const k = s.stageKey.trim();
      if (!k) {
        errors.push(`Stage "${s.stageName || "(unnamed)"}" needs a key.`);
      } else if (!/^[a-z][a-z0-9_]*$/i.test(k)) {
        errors.push(`Stage key "${k}" must be alphanumeric + underscore.`);
      } else if (keys.has(k)) {
        errors.push(`Duplicate stage key "${k}".`);
      }
      keys.add(k);
      if (!s.stageName.trim()) errors.push(`Stage "${k}" needs a name.`);
    }
    const tKeys = new Set<string>();
    for (const t of transitions) {
      if (!keys.has(t.fromStageKey)) {
        errors.push(`Transition has unknown from-stage "${t.fromStageKey}".`);
      }
      if (!keys.has(t.toStageKey)) {
        errors.push(`Transition has unknown to-stage "${t.toStageKey}".`);
      }
      if (t.fromStageKey === t.toStageKey) {
        errors.push(`Transition "${t.transitionName}" can't loop on the same stage.`);
      }
      const k = `${t.fromStageKey}->${t.toStageKey}`;
      if (tKeys.has(k)) {
        errors.push(`Duplicate transition ${t.fromStageKey} → ${t.toStageKey}.`);
      }
      tKeys.add(k);
      if (!t.transitionName.trim()) {
        errors.push(`Transition ${t.fromStageKey} → ${t.toStageKey} needs a label.`);
      }
    }
    return errors;
  }, [meta.blueprintName, stages, transitions]);

  // ── Save ───────────────────────────────────────────────────────────────
  async function save() {
    if (validation.length > 0) {
      setErr(validation[0]);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/blueprints/${blueprintId}/design`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          blueprintName: meta.blueprintName,
          description: meta.description || null,
          isActive: meta.isActive,
          stages: stages.map((s, i) => ({
            stageKey: s.stageKey.trim(),
            stageName: s.stageName,
            description: s.description || null,
            stageOrder: s.stageOrder ?? i + 1,
            ownerRole: s.ownerRole || null,
            slaDays: s.slaDays,
            requiredFields: s.requiredFields,
            allowedActions: s.allowedActions,
            automationsOnEnter: s.automationsOnEnter,
          })),
          transitions: transitions.map((t) => ({
            fromStageKey: t.fromStageKey,
            toStageKey: t.toStageKey,
            transitionName: t.transitionName,
            allowedRoles: t.allowedRoles,
          })),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      setSavedAt(new Date());
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const stageKeyOpts = stages.map((s) => ({ v: s.stageKey, label: s.stageName || s.stageKey }));

  return (
    <div className="space-y-5 pb-24">
      {/* ── Meta header ────────────────────────────────────────────────── */}
      <div className="card-surface p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <input
            value={meta.blueprintName}
            onChange={(e) => setMeta((m) => ({ ...m, blueprintName: e.target.value }))}
            className="input-base text-lg font-semibold flex-1"
            placeholder="Blueprint name"
          />
          <button
            type="button"
            onClick={() => setMeta((m) => ({ ...m, isActive: !m.isActive }))}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5 ${
              meta.isActive
                ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                : "bg-rose-100 text-rose-700 hover:bg-rose-200"
            }`}
          >
            {meta.isActive ? (
              <>
                <Power className="size-3.5" /> Active
              </>
            ) : (
              <>
                <PowerOff className="size-3.5" /> Inactive
              </>
            )}
          </button>
        </div>
        <textarea
          value={meta.description}
          onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))}
          rows={2}
          placeholder="What does this blueprint govern? (visible to your team in Settings)"
          className="input-base text-sm w-full"
        />
        <div className="text-[11px] text-muted-foreground flex items-center gap-2">
          <Workflow className="size-3" /> Module: <code className="font-mono">{moduleName}</code>
        </div>
      </div>

      {/* ── Stages ─────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Stages ({stages.length})
          </h2>
          <button
            type="button"
            onClick={addStage}
            className="btn-secondary text-xs inline-flex items-center gap-1"
          >
            <Plus className="size-3.5" /> Add stage
          </button>
        </div>

        {stages.map((s, i) => (
          <StageCard
            key={s.id ?? `new-${i}`}
            index={i}
            stage={s}
            isPersisted={!!s.id}
            isFirst={i === 0}
            isLast={i === stages.length - 1}
            onChange={(p) => updateStage(i, p)}
            onMove={(d) => moveStage(i, d)}
            onRemove={() => removeStage(i)}
          />
        ))}

        {stages.length === 0 && (
          <div className="card-surface p-8 text-center text-sm text-muted-foreground">
            No stages yet. Click "Add stage" to start designing your flow.
          </div>
        )}
      </div>

      {/* ── Transitions ────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Transitions ({transitions.length})
          </h2>
          <button
            type="button"
            onClick={addTransition}
            disabled={stages.length < 2}
            className="btn-secondary text-xs inline-flex items-center gap-1 disabled:opacity-50"
            title={stages.length < 2 ? "Add at least 2 stages first" : ""}
          >
            <Plus className="size-3.5" /> Add transition
          </button>
        </div>

        {transitions.length === 0 ? (
          <div className="card-surface p-6 text-center text-sm text-muted-foreground">
            No transitions defined. Records won't move between stages without at
            least one transition.
          </div>
        ) : (
          <div className="card-surface divide-y divide-border">
            {transitions.map((t, i) => (
              <TransitionRow
                key={t.id ?? `new-${i}`}
                transition={t}
                stages={stageKeyOpts}
                onChange={(p) => updateTransition(i, p)}
                onRemove={() => removeTransition(i)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Validation surface ─────────────────────────────────────────── */}
      {validation.length > 0 && (
        <div className="card-surface p-3 bg-amber-50/50 border-amber-300">
          <div className="text-xs font-semibold text-amber-800 flex items-center gap-1.5 mb-1.5">
            <AlertCircle className="size-3.5" /> Fix these before saving
          </div>
          <ul className="text-[11px] text-amber-700 list-disc list-inside space-y-0.5">
            {validation.slice(0, 5).map((m, i) => (
              <li key={i}>{m}</li>
            ))}
            {validation.length > 5 && (
              <li className="italic">+{validation.length - 5} more</li>
            )}
          </ul>
        </div>
      )}

      {/* ── Sticky save bar ────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 lg:left-64 bg-card border-t border-border px-6 py-3 flex items-center justify-between shadow-lg z-20">
        <div className="text-xs">
          {err && (
            <span className="text-rose-600 inline-flex items-center gap-1">
              <AlertCircle className="size-3" /> {err}
            </span>
          )}
          {!err && savedAt && (
            <span className="text-emerald-700 inline-flex items-center gap-1">
              <CheckCircle2 className="size-3" /> Saved {savedAt.toLocaleTimeString()}
            </span>
          )}
          {!err && !savedAt && (
            <span className="text-muted-foreground">
              {stages.length} stages · {transitions.length} transitions ·{" "}
              {validation.length === 0 ? "ready to save" : `${validation.length} issue(s)`}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={save}
          disabled={busy || validation.length > 0}
          className="btn-primary text-sm disabled:opacity-50"
        >
          <Save className="size-4" /> {busy ? "Saving…" : "Save blueprint"}
        </button>
      </div>
    </div>
  );
}

/* -------------------- Stage card -------------------- */

function StageCard({
  index,
  stage,
  isPersisted,
  isFirst,
  isLast,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  stage: StageDraft;
  isPersisted: boolean;
  isFirst: boolean;
  isLast: boolean;
  onChange: (p: Partial<StageDraft>) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(!isPersisted);

  return (
    <div className="card-surface p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={isFirst}
            className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
          >
            <ChevronUp className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={isLast}
            className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </div>
        <span className="chip text-[10px] bg-brand-cyan-light text-brand-cyan-deep tabular-nums">
          {index + 1}
        </span>
        <input
          value={stage.stageName}
          onChange={(e) => onChange({ stageName: e.target.value })}
          placeholder="Stage name (e.g. Document Verification)"
          className="input-base text-sm font-semibold flex-1"
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          {open ? "Collapse" : "Expand"}
          {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm(`Delete stage "${stage.stageName || stage.stageKey}"?`)) onRemove();
          }}
          className="rounded p-1.5 hover:bg-rose-50 text-rose-600"
          title="Delete stage"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {open && (
        <div className="space-y-2 pl-7">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Stage key (slug)">
              <input
                value={stage.stageKey}
                onChange={(e) =>
                  onChange({
                    stageKey: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
                  })
                }
                disabled={isPersisted}
                placeholder="e.g. document_verification"
                className="input-base text-xs w-full font-mono disabled:opacity-60"
                title={isPersisted ? "Stage key locked once saved" : ""}
              />
              {isPersisted && (
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Locked — rename = delete + re-add.
                </div>
              )}
            </Field>
            <Field label="Owner role">
              <select
                value={stage.ownerRole}
                onChange={(e) => onChange({ ownerRole: e.target.value })}
                className="input-base text-xs w-full"
              >
                {OWNER_ROLES.map((r) => (
                  <option key={r.v} value={r.v}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="SLA (days)">
              <input
                type="number"
                min={0}
                value={stage.slaDays ?? ""}
                onChange={(e) =>
                  onChange({
                    slaDays: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                placeholder="(none)"
                className="input-base text-xs w-full"
              />
            </Field>
            <Field label="On-enter recipe keys (comma-sep)">
              <input
                value={stage.automationsOnEnter.join(", ")}
                onChange={(e) =>
                  onChange({
                    automationsOnEnter: e.target.value
                      .split(",")
                      .map((v) => v.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="e.g. send_welcome"
                className="input-base text-xs w-full font-mono"
              />
            </Field>
            <Field label="Required fields (comma-sep)">
              <input
                value={stage.requiredFields.join(", ")}
                onChange={(e) =>
                  onChange({
                    requiredFields: e.target.value
                      .split(",")
                      .map((v) => v.trim())
                      .filter(Boolean),
                  })
                }
                className="input-base text-xs w-full font-mono"
              />
            </Field>
            <Field label="Allowed actions (comma-sep)">
              <input
                value={stage.allowedActions.join(", ")}
                onChange={(e) =>
                  onChange({
                    allowedActions: e.target.value
                      .split(",")
                      .map((v) => v.trim())
                      .filter(Boolean),
                  })
                }
                className="input-base text-xs w-full font-mono"
              />
            </Field>
          </div>
          <Field label="Description">
            <textarea
              value={stage.description}
              onChange={(e) => onChange({ description: e.target.value })}
              rows={1}
              placeholder="What does this stage mean? (shown as a tooltip)"
              className="input-base text-xs w-full"
            />
          </Field>
        </div>
      )}
    </div>
  );
}

/* -------------------- Transition row -------------------- */

function TransitionRow({
  transition,
  stages,
  onChange,
  onRemove,
}: {
  transition: TransitionDraft;
  stages: { v: string; label: string }[];
  onChange: (p: Partial<TransitionDraft>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="px-3 py-2.5 flex flex-wrap items-center gap-2">
      <select
        value={transition.fromStageKey}
        onChange={(e) => onChange({ fromStageKey: e.target.value })}
        className="input-base text-xs py-1 min-w-[140px]"
      >
        {stages.map((s) => (
          <option key={s.v} value={s.v}>
            {s.label}
          </option>
        ))}
      </select>
      <ArrowRight className="size-3.5 text-muted-foreground flex-shrink-0" />
      <select
        value={transition.toStageKey}
        onChange={(e) => onChange({ toStageKey: e.target.value })}
        className="input-base text-xs py-1 min-w-[140px]"
      >
        {stages.map((s) => (
          <option key={s.v} value={s.v}>
            {s.label}
          </option>
        ))}
      </select>
      <input
        value={transition.transitionName}
        onChange={(e) => onChange({ transitionName: e.target.value })}
        placeholder="Button label (e.g. Mark as Won)"
        className="input-base text-xs py-1 flex-1 min-w-[140px]"
      />
      <RoleMultiSelect
        value={transition.allowedRoles}
        onChange={(v) => onChange({ allowedRoles: v })}
      />
      <button
        type="button"
        onClick={() => {
          if (confirm(`Delete this transition?`)) onRemove();
        }}
        className="rounded p-1.5 hover:bg-rose-50 text-rose-600"
        title="Delete transition"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

function RoleMultiSelect({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  function toggle(role: string) {
    onChange(value.includes(role) ? value.filter((r) => r !== role) : [...value, role]);
  }
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-border bg-background px-2 py-1 text-[11px] inline-flex items-center gap-1 min-w-[140px]"
      >
        <span className="truncate flex-1 text-left">
          {value.length === 0
            ? "Any role"
            : value.length <= 2
            ? value.join(", ")
            : `${value.length} roles`}
        </span>
        <ChevronDown className="size-3" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-20 bg-card border border-border rounded-md shadow-lg py-1 min-w-[180px]"
          onMouseLeave={() => setOpen(false)}
        >
          {TRANSITION_ROLES.map((r) => {
            const on = value.includes(r);
            return (
              <button
                key={r}
                type="button"
                onClick={() => toggle(r)}
                className="w-full text-left px-2.5 py-1 text-xs hover:bg-accent flex items-center gap-2"
              >
                <input
                  type="checkbox"
                  checked={on}
                  readOnly
                  className="size-3"
                />
                <span className="capitalize">{r.replace(/_/g, " ")}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* -------------------- Helpers -------------------- */

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
        {label}
      </div>
      {children}
    </label>
  );
}
