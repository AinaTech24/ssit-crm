"use client";

/**
 * Task Templates designer — list + add/edit drawer with a sub-task checklist
 * builder. The owner designs SOPs ("New client onboarding" → collect docs →
 * KYC → UCC → mandate…); the team applies them from the New Task form.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { MfdTemplateLibrary } from "@/components/settings/MfdTemplateLibrary";

export type TaskTemplateRow = {
  id: string;
  name: string;
  description: string | null;
  taskType: string | null;
  department: string | null;
  priority: string | null;
  dueOffsetDays: number | null;
  subtasks: { id: string; text: string }[];
  isActive: boolean;
};

const TASK_TYPES: { value: string; label: string }[] = [
  { value: "follow_up", label: "Follow-up" },
  { value: "review_meeting", label: "Review meeting" },
  { value: "collect_document", label: "Collect document" },
  { value: "kyc_renewal", label: "KYC renewal" },
  { value: "custom", label: "Custom" },
];

const DEPARTMENTS: { value: string; label: string }[] = [
  { value: "sales", label: "Sales" },
  { value: "operations", label: "Operations" },
  { value: "back_office", label: "Back office" },
  { value: "compliance", label: "Compliance" },
  { value: "marketing", label: "Marketing" },
  { value: "advisory", label: "Advisory" },
  { value: "support", label: "Support" },
  { value: "leadership", label: "Leadership" },
  { value: "other", label: "Other" },
];

const PRIORITIES: { value: string; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

const labelOf = (list: { value: string; label: string }[], v: string | null) =>
  v ? (list.find((x) => x.value === v)?.label ?? v) : null;

/** One row in the sub-task builder — `sid` is the server id (kept on edit). */
type SubtaskDraft = { key: string; sid?: string; text: string };

type DraftForm = {
  name: string;
  description: string;
  taskType: string;
  department: string;
  priority: string;
  dueOffsetDays: string;
  isActive: boolean;
  subtasks: SubtaskDraft[];
};

const emptyForm = (): DraftForm => ({
  name: "",
  description: "",
  taskType: "",
  department: "",
  priority: "",
  dueOffsetDays: "",
  isActive: true,
  subtasks: [],
});

const formFromTemplate = (t: TaskTemplateRow): DraftForm => ({
  name: t.name,
  description: t.description ?? "",
  taskType: t.taskType ?? "",
  department: t.department ?? "",
  priority: t.priority ?? "",
  dueOffsetDays: t.dueOffsetDays != null ? String(t.dueOffsetDays) : "",
  isActive: t.isActive,
  subtasks: t.subtasks.map((s) => ({
    key: `srv-${s.id}`,
    sid: s.id,
    text: s.text,
  })),
});

let draftSeq = 0;
const nextKey = () => `new-${++draftSeq}`;

export function TaskTemplatesManager({
  templates,
}: {
  templates: TaskTemplateRow[];
}) {
  const router = useRouter();
  // null = closed, "new" = create, otherwise the template id being edited
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<DraftForm>(emptyForm());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const editingTemplate = useMemo(
    () => (editing && editing !== "new" ? templates.find((t) => t.id === editing) ?? null : null),
    [editing, templates]
  );

  const openNew = () => {
    setForm(emptyForm());
    setError(null);
    setFocusKey(null);
    setEditing("new");
  };

  const openEdit = (t: TaskTemplateRow) => {
    setForm(formFromTemplate(t));
    setError(null);
    setFocusKey(null);
    setEditing(t.id);
  };

  const close = () => {
    if (busy) return;
    setEditing(null);
    setError(null);
  };

  const set = <K extends keyof DraftForm>(k: K, v: DraftForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // ----- sub-task builder helpers -----

  const addSubtask = () => {
    const key = nextKey();
    setForm((f) => ({ ...f, subtasks: [...f.subtasks, { key, text: "" }] }));
    setFocusKey(key);
  };

  const setSubtaskText = (key: string, text: string) =>
    setForm((f) => ({
      ...f,
      subtasks: f.subtasks.map((s) => (s.key === key ? { ...s, text } : s)),
    }));

  const removeSubtask = (key: string) =>
    setForm((f) => ({ ...f, subtasks: f.subtasks.filter((s) => s.key !== key) }));

  const moveSubtask = (idx: number, dir: -1 | 1) =>
    setForm((f) => {
      const next = [...f.subtasks];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return f;
      [next[idx], next[j]] = [next[j], next[idx]];
      return { ...f, subtasks: next };
    });

  // ----- save / delete -----

  const save = async () => {
    const name = form.name.trim();
    if (!name) {
      setError("Give the template a name.");
      return;
    }
    const subtasks = form.subtasks
      .map((s) => ({ id: s.sid, text: s.text.trim() }))
      .filter((s) => s.text.length > 0)
      .map((s) => (s.id ? { id: s.id, text: s.text } : { text: s.text }));

    const due = form.dueOffsetDays.trim();
    const dueNum = due === "" ? null : Number(due);
    if (dueNum != null && (!Number.isInteger(dueNum) || dueNum < 0 || dueNum > 365)) {
      setError("Due offset must be a whole number between 0 and 365 days.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const isNew = editing === "new";
      const payload: Record<string, unknown> = isNew
        ? {
            name,
            ...(form.description.trim() ? { description: form.description.trim() } : {}),
            ...(form.taskType ? { taskType: form.taskType } : {}),
            ...(form.department ? { department: form.department } : {}),
            ...(form.priority ? { priority: form.priority } : {}),
            ...(dueNum != null ? { dueOffsetDays: dueNum } : {}),
            subtasks,
            isActive: form.isActive,
          }
        : {
            name,
            description: form.description.trim() || null,
            taskType: form.taskType || null,
            department: form.department || null,
            priority: form.priority || null,
            dueOffsetDays: dueNum,
            subtasks,
            isActive: form.isActive,
          };

      const res = await fetch(
        isNew ? "/api/task-templates" : `/api/task-templates/${editing}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j?.error ?? "Couldn't save the template. Please try again.");
        return;
      }
      setEditing(null);
      router.refresh();
    } catch {
      setError("Couldn't save the template. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (t: TaskTemplateRow) => {
    if (
      !window.confirm(
        `Delete the template "${t.name}"? Tasks already created from it are not affected.`
      )
    )
      return;
    setDeletingId(t.id);
    try {
      const res = await fetch(`/api/task-templates/${t.id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        window.alert(j?.error ?? "Couldn't delete the template.");
        return;
      }
      router.refresh();
    } catch {
      window.alert("Couldn't delete the template.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <MfdTemplateLibrary />
        <button type="button" onClick={openNew} className="btn-primary inline-flex items-center gap-1.5">
          <Plus className="size-4" /> Add template
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="card-surface p-8 text-center space-y-2">
          <ListChecks className="size-8 mx-auto text-muted-foreground" />
          <div className="font-medium">No task templates yet</div>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Turn your firm&apos;s SOPs into one-click tasks — e.g.{" "}
            <span className="font-medium text-foreground">New client onboarding</span> — Collect
            documents, KYC verification, UCC creation, Mandate setup, Welcome call.
          </p>
          <button
            type="button"
            onClick={openNew}
            className="btn-ghost inline-flex items-center gap-1.5 text-sm"
          >
            <Plus className="size-4" /> Create your first template
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <div key={t.id} className="card-surface p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{t.name}</span>
                    <span
                      className={`chip text-[11px] ${
                        t.isActive
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {t.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                  {t.description && (
                    <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
                      {t.description}
                    </p>
                  )}
                  <div className="flex items-center gap-1.5 flex-wrap mt-2">
                    {labelOf(TASK_TYPES, t.taskType) && (
                      <span className="chip text-[11px]">{labelOf(TASK_TYPES, t.taskType)}</span>
                    )}
                    {labelOf(DEPARTMENTS, t.department) && (
                      <span className="chip text-[11px]">{labelOf(DEPARTMENTS, t.department)}</span>
                    )}
                    {labelOf(PRIORITIES, t.priority) && (
                      <span className="chip text-[11px]">
                        {labelOf(PRIORITIES, t.priority)} priority
                      </span>
                    )}
                    {t.dueOffsetDays != null && (
                      <span className="chip text-[11px]">
                        Due in {t.dueOffsetDays} day{t.dueOffsetDays === 1 ? "" : "s"}
                      </span>
                    )}
                    <span className="chip text-[11px]">
                      {t.subtasks.length} sub-task{t.subtasks.length === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEdit(t)}
                    className="p-1.5 text-muted-foreground hover:text-brand-cyan-deep"
                    aria-label={`Edit ${t.name}`}
                    title="Edit"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button"
                    disabled={deletingId === t.id}
                    onClick={() => remove(t)}
                    className="p-1.5 text-muted-foreground hover:text-rose-600 disabled:opacity-50"
                    aria-label={`Delete ${t.name}`}
                    title="Delete"
                  >
                    {deletingId === t.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ----- Add / Edit drawer ----- */}
      {editing !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex justify-end"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="h-full w-full max-w-lg bg-card border-l border-border shadow-xl overflow-y-auto">
            <div className="sticky top-0 bg-card border-b border-border px-5 py-3.5 flex items-center justify-between z-10">
              <h2 className="font-semibold">
                {editing === "new"
                  ? "New task template"
                  : `Edit template${editingTemplate ? ` — ${editingTemplate.name}` : ""}`}
              </h2>
              <button
                type="button"
                onClick={close}
                className="p-1 text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {error && (
                <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                  {error}
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="tt-name">
                  Name
                </label>
                <input
                  id="tt-name"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  maxLength={120}
                  placeholder="e.g. New client onboarding"
                  className="input-base w-full text-sm"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="tt-desc">
                  Description <span className="font-normal">(optional)</span>
                </label>
                <textarea
                  id="tt-desc"
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="What this SOP covers, for your team"
                  className="input-base w-full text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Type</label>
                  <SelectField
                    value={form.taskType}
                    onChange={(e) => set("taskType", e.target.value)}
                    className="w-full"
                    aria-label="Default task type"
                  >
                    <option value="">— none —</option>
                    {TASK_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </SelectField>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Department</label>
                  <SelectField
                    value={form.department}
                    onChange={(e) => set("department", e.target.value)}
                    className="w-full"
                    aria-label="Default department"
                  >
                    <option value="">— none —</option>
                    {DEPARTMENTS.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </SelectField>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Priority</label>
                  <SelectField
                    value={form.priority}
                    onChange={(e) => set("priority", e.target.value)}
                    className="w-full"
                    aria-label="Default priority"
                  >
                    <option value="">— none —</option>
                    {PRIORITIES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </SelectField>
                </div>
              </div>

              <div className="flex items-end gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="tt-due">
                    Due in N days <span className="font-normal">(from task creation)</span>
                  </label>
                  <input
                    id="tt-due"
                    type="number"
                    min={0}
                    max={365}
                    value={form.dueOffsetDays}
                    onChange={(e) => set("dueOffsetDays", e.target.value)}
                    placeholder="e.g. 7"
                    className="input-base w-32 text-sm"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm pb-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => set("isActive", e.target.checked)}
                    className="size-4 rounded"
                  />
                  Active
                </label>
              </div>

              {/* Sub-tasks builder */}
              <div className="space-y-2 pt-2 border-t border-border">
                <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <ListChecks className="size-3.5" /> Sub-tasks (checklist)
                </div>
                {form.subtasks.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Add the steps of this SOP — e.g. Collect documents, KYC verification, UCC
                    creation, Mandate setup, Welcome call.
                  </p>
                )}
                <div className="space-y-1.5">
                  {form.subtasks.map((s, idx) => (
                    <div key={s.key} className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground w-5 text-right shrink-0">
                        {idx + 1}.
                      </span>
                      <input
                        value={s.text}
                        autoFocus={focusKey === s.key}
                        onChange={(e) => setSubtaskText(s.key, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && idx === form.subtasks.length - 1) {
                            e.preventDefault();
                            if (s.text.trim()) addSubtask();
                          }
                        }}
                        maxLength={300}
                        placeholder={`Sub-task ${idx + 1}`}
                        className="input-base flex-1 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => moveSubtask(idx, -1)}
                        disabled={idx === 0}
                        className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                        aria-label="Move up"
                        title="Move up"
                      >
                        <ArrowUp className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveSubtask(idx, 1)}
                        disabled={idx === form.subtasks.length - 1}
                        className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                        aria-label="Move down"
                        title="Move down"
                      >
                        <ArrowDown className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeSubtask(s.key)}
                        className="p-1 text-muted-foreground hover:text-rose-600"
                        aria-label="Remove sub-task"
                        title="Remove"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addSubtask}
                  className="btn-ghost inline-flex items-center gap-1 text-xs"
                >
                  <Plus className="size-3.5" /> Add sub-task
                </button>
              </div>
            </div>

            <div className="sticky bottom-0 bg-card border-t border-border px-5 py-3.5 flex items-center justify-end gap-2">
              <button type="button" onClick={close} disabled={busy} className="btn-ghost text-sm">
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={busy || !form.name.trim()}
                className="btn-primary inline-flex items-center gap-1.5 text-sm"
              >
                {busy && <Loader2 className="size-4 animate-spin" />}
                {editing === "new" ? "Create template" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
