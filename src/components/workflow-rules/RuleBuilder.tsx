"use client";

/**
 * Zoho-CRM-style 4-step rule builder.
 *
 *   1. Basic info — module + name + description
 *   2. Trigger    — Record Action / Date Field / Score / Recurring / Note
 *   3. Criteria   — pattern editor with field/operator/value rows
 *   4. Actions    — Instant + Scheduled (with delay)
 *
 * Mirrors https://help.zoho.com/portal/en/kb/crm/automate-business-processes/workflows
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, ChevronDown, Search, Plus, Trash2, Save, AlertTriangle, Workflow } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { MultiSelectField } from "@/components/ui/MultiSelectField";
import { TimeField } from "@/components/ui/TimeField";

type ModuleField = {
  key: string;
  label: string;
  type: string;
  writable: boolean;
  dateAnchor: boolean;
  scoreField: boolean;
  enumValues: string[] | null;
};
type Module = { key: string; label: string; fields: ModuleField[] };

type Trigger =
  | { kind: "record_action"; when: "create" | "edit" | "create_or_edit" | "delete" | "field_update"; editMode?: "any" | "specific"; fields: string[]; fieldConditions?: Array<{ field: string; operator: string; value: any }>; repeat: boolean }
  | { kind: "date_field"; field: string; when: "before" | "on" | "after"; offset: number; unit: "day" | "week" | "month"; recurrence: "once" | "every_month" | "every_year"; time: string }
  | { kind: "score_change"; field: string; direction: "increase" | "decrease" | "updated"; threshold?: number }
  | { kind: "recurrence"; cron: string }
  | { kind: "note"; when: "added" | "modified" | "deleted" | "added_or_modified" };

type CriteriaRow = { field: string; operator: string; value: any };

type Action = { type: string; label?: string; config: Record<string, any> };
type ScheduledAction = Action & { delay: { amount: number; unit: "minute" | "hour" | "day" | "week"; anchor: "trigger" | "date_field"; anchorField?: string } };

/** Extra condition set beyond the main criteria (Zoho: ≤10 per rule). The main
 *  Conditions/Actions steps act as Branch 1; a record falls into the FIRST
 *  branch (top-down) whose conditions match. */
type Branch = {
  name: string;
  criteriaPattern: string;
  criteriaRows: CriteriaRow[];
  instantActions: Action[];
  scheduledActions: ScheduledAction[];
};

type SavedRule = {
  id: string;
  module: string;
  name: string;
  description?: string | null;
  triggerType: string;
  triggerConfig: Record<string, any>;
  criteriaPattern?: string | null;
  criteriaRows?: CriteriaRow[] | null;
  instantActions?: Action[] | null;
  scheduledActions?: ScheduledAction[] | null;
  branches?: Array<Partial<Branch>> | null;
  rateLimitPerHour?: number | null;
};

const ACTION_TYPES: Array<{ key: string; label: string; description: string; instantOnly?: boolean }> = [
  { key: "send_email", label: "Email Notification", description: "Send a templated email to the subject or recipient list." },
  { key: "send_whatsapp", label: "WhatsApp Message", description: "Send a Meta-approved WhatsApp template." },
  { key: "send_sms", label: "SMS Message", description: "Send a DLT-compliant SMS." },
  { key: "create_task", label: "Task", description: "Create a task assigned to the RM, owner, or a specific user." },
  { key: "schedule_meeting", label: "Meeting", description: "Schedule a review/follow-up meeting." },
  { key: "schedule_call", label: "Call", description: "Schedule a call (creates a task with type=call)." },
  { key: "update_field", label: "Field Update", description: "Update one or more writable fields on the record." },
  { key: "add_tag", label: "Add Tag", description: "Append a tag to the record." },
  { key: "remove_tag", label: "Remove Tag", description: "Remove a tag from the record." },
  { key: "webhook", label: "Webhook", description: "POST the record payload to an external URL." },
  // custom_function + create_record are intentionally absent — the backend
  // rejects them as unimplemented stubs (see lib/workflow-rules/guard.ts), so
  // offering them here would only produce a save-time error.
  { key: "convert_lead", label: "Convert Lead", description: "Convert a lead into an investor.", instantOnly: true },
  { key: "create_notification", label: "In-app Notification", description: "Send an in-app bell notification." },
];

/** Zoho-style grouped "Instant Actions" menu — top-level items + flyout submenus. */
type ActionMenuNode = { key?: string; label: string; items?: Array<{ key: string; label: string }> };
const ACTION_MENU: ActionMenuNode[] = [
  { key: "update_field", label: "Field Update" },
  {
    label: "Tags",
    items: [
      { key: "add_tag", label: "Add Tag(s)" },
      { key: "remove_tag", label: "Remove Tag(s)" },
    ],
  },
  {
    label: "Notify",
    items: [
      { key: "send_email", label: "Email Notification" },
      { key: "send_sms", label: "SMS Notification" },
      { key: "send_whatsapp", label: "WhatsApp Message" },
      { key: "create_notification", label: "In-app Notification" },
    ],
  },
  { key: "create_task", label: "Task" },
  { key: "schedule_meeting", label: "Meeting" },
  { key: "schedule_call", label: "Call" },
  { key: "webhook", label: "Webhook" },
  { key: "convert_lead", label: "Convert Lead" },
];

const OPERATORS: Array<{ key: string; label: string; types: string[] }> = [
  { key: "is", label: "is", types: ["string", "enum", "boolean", "uuid", "integer", "number", "currency"] },
  { key: "is_not", label: "is not", types: ["string", "enum", "boolean", "uuid", "integer", "number", "currency"] },
  { key: "contains", label: "contains", types: ["string", "text", "email", "phone"] },
  { key: "starts_with", label: "starts with", types: ["string", "text", "email", "phone"] },
  { key: "ends_with", label: "ends with", types: ["string", "text", "email", "phone"] },
  { key: "is_empty", label: "is empty", types: ["*"] },
  { key: "is_not_empty", label: "is not empty", types: ["*"] },
  { key: "greater_than", label: ">", types: ["integer", "number", "currency", "date", "datetime"] },
  { key: "less_than", label: "<", types: ["integer", "number", "currency", "date", "datetime"] },
  { key: "greater_or_equal", label: "≥", types: ["integer", "number", "currency", "date", "datetime"] },
  { key: "less_or_equal", label: "≤", types: ["integer", "number", "currency", "date", "datetime"] },
  { key: "in", label: "in (any of)", types: ["enum", "string"] },
  { key: "not_in", label: "not in (none of)", types: ["enum", "string"] },
  { key: "today", label: "is today", types: ["date", "datetime"] },
  { key: "yesterday", label: "is yesterday", types: ["date", "datetime"] },
  { key: "tomorrow", label: "is tomorrow", types: ["date", "datetime"] },
  { key: "last_n_days", label: "in last N days", types: ["date", "datetime"] },
  { key: "next_n_days", label: "in next N days", types: ["date", "datetime"] },
];

function opsForType(type: string) {
  return OPERATORS.filter((o) => o.types.includes("*") || o.types.includes(type));
}

/** Zoho's "Define execution date" presets → our {when, offset, unit}. */
const DATE_PRESETS: Array<{ key: string; label: string; when: "before" | "on" | "after"; offset: number; unit: "day" | "week" | "month" }> = [
  { key: "on", label: "On", when: "on", offset: 0, unit: "day" },
  { key: "1d_before", label: "1 day before", when: "before", offset: 1, unit: "day" },
  { key: "2d_before", label: "2 days before", when: "before", offset: 2, unit: "day" },
  { key: "3d_before", label: "3 days before", when: "before", offset: 3, unit: "day" },
  { key: "1w_before", label: "1 week before", when: "before", offset: 1, unit: "week" },
  { key: "2w_before", label: "2 weeks before", when: "before", offset: 2, unit: "week" },
  { key: "1m_before", label: "1 month before", when: "before", offset: 1, unit: "month" },
  { key: "1d_after", label: "1 day after", when: "after", offset: 1, unit: "day" },
  { key: "2d_after", label: "2 days after", when: "after", offset: 2, unit: "day" },
  { key: "3d_after", label: "3 days after", when: "after", offset: 3, unit: "day" },
  { key: "1w_after", label: "1 week after", when: "after", offset: 1, unit: "week" },
  { key: "1m_after", label: "1 month after", when: "after", offset: 1, unit: "month" },
];

function presetKeyFor(t: { when?: string; offset?: number; unit?: string }): string {
  if (t.when === "on") return "on";
  const hit = DATE_PRESETS.find((p) => p.when === t.when && p.offset === Number(t.offset) && p.unit === t.unit);
  return hit?.key ?? "on";
}

function triggerFromRule(rule?: SavedRule): Trigger {
  if (!rule) return { kind: "record_action", when: "create", fields: [], repeat: false };
  const cfg = rule.triggerConfig ?? {};
  if (rule.triggerType === "date_field") {
    return {
      kind: "date_field",
      field: String(cfg.field ?? ""),
      when: (cfg.when as any) ?? "on",
      offset: Number(cfg.offset ?? 0),
      unit: (cfg.unit as any) ?? "day",
      recurrence: (cfg.recurrence as any) ?? "once",
      time: String(cfg.time ?? "09:00"),
    };
  }
  if (rule.triggerType === "score_change") {
    return {
      kind: "score_change",
      field: String(cfg.field ?? ""),
      direction: (cfg.direction as any) ?? "updated",
      threshold: cfg.threshold === undefined ? undefined : Number(cfg.threshold),
    };
  }
  if (rule.triggerType === "recurrence") return { kind: "recurrence", cron: String(cfg.cron ?? "0 9 * * 1") };
  if (rule.triggerType === "note") return { kind: "note", when: (cfg.when as any) ?? "added" };
  return {
    kind: "record_action",
    when: (cfg.when as any) ?? "create",
    editMode: cfg.editMode as any,
    fields: Array.isArray(cfg.fields) ? cfg.fields : [],
    fieldConditions: Array.isArray(cfg.fieldConditions) ? cfg.fieldConditions : [],
    repeat: !!cfg.repeat,
  };
}

function branchesFromRule(rule?: SavedRule): Branch[] {
  return ((rule?.branches ?? []) as Array<Partial<Branch>>).map((b, i) => ({
    name: String(b.name ?? `Condition ${i + 2}`),
    criteriaPattern: String(b.criteriaPattern ?? ""),
    criteriaRows: (b.criteriaRows ?? []) as CriteriaRow[],
    instantActions: (b.instantActions ?? []) as Action[],
    scheduledActions: (b.scheduledActions ?? []) as ScheduledAction[],
  }));
}

export function RuleBuilder({
  modules,
  initialRule,
  mode = "create",
}: {
  modules: Module[];
  initialRule?: SavedRule;
  mode?: "create" | "edit";
}) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1
  const [moduleKey, setModuleKey] = useState(initialRule?.module ?? modules[0]?.key ?? "");
  const [name, setName] = useState(initialRule?.name ?? "");
  const [description, setDescription] = useState(initialRule?.description ?? "");
  // Optional safety cap — blank = unlimited. Stored as a string so the input can be cleared.
  const [rateLimit, setRateLimit] = useState<string>(
    initialRule?.rateLimitPerHour != null ? String(initialRule.rateLimitPerHour) : ""
  );

  // Step 2
  const [trigger, setTrigger] = useState<Trigger>(() => triggerFromRule(initialRule));

  // Step 3
  const [criteriaRows, setCriteriaRows] = useState<CriteriaRow[]>((initialRule?.criteriaRows ?? []) as CriteriaRow[]);
  const [criteriaPattern, setCriteriaPattern] = useState<string>(initialRule?.criteriaPattern ?? "");

  // Step 4
  const [instantActions, setInstantActions] = useState<Action[]>((initialRule?.instantActions ?? []) as Action[]);
  const [scheduledActions, setScheduledActions] = useState<ScheduledAction[]>((initialRule?.scheduledActions ?? []) as ScheduledAction[]);
  // Extra condition branches (optional) — first match wins, top-down.
  const [branches, setBranches] = useState<Branch[]>(() => branchesFromRule(initialRule));

  const mod = useMemo(() => modules.find((m) => m.key === moduleKey), [moduleKey, modules]);
  const dateFields = mod?.fields.filter((f) => f.dateAnchor) ?? [];
  const scoreFields = mod?.fields.filter((f) => f.scoreField) ?? [];

  function canProceed(): boolean {
    if (step === 1) return !!(moduleKey && name.trim().length >= 2);
    if (step === 2) {
      if (trigger.kind === "date_field" && !trigger.field) return false;
      if (trigger.kind === "score_change" && !trigger.field) return false;
      if (trigger.kind === "recurrence" && !trigger.cron) return false;
      return true;
    }
    return true;
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const rulePayload = {
        module: moduleKey,
        name: name.trim(),
        description: description.trim() || undefined,
        triggerType: trigger.kind,
        triggerConfig: triggerConfigFromState(trigger),
        rateLimitPerHour: rateLimit.trim() === "" ? null : Number(rateLimit),
        criteriaPattern: criteriaPattern.trim() || null,
        criteriaRows,
        instantActions,
        scheduledActions,
        branches: branches.map((b) => ({
          name: b.name.trim() || undefined,
          criteriaPattern: b.criteriaPattern.trim() || null,
          criteriaRows: b.criteriaRows,
          instantActions: b.instantActions,
          scheduledActions: b.scheduledActions,
        })),
      };
      const body = mode === "edit" ? rulePayload : { ...rulePayload, enabled: true, executionOrder: 100 };
      const r = await fetch(mode === "edit" ? `/api/workflow-rules/${initialRule?.id}` : "/api/workflow-rules", {
        method: mode === "edit" ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data?.error ?? `HTTP ${r.status}`);
      }
      router.push(mode === "edit" && initialRule?.id ? `/dashboard/workflows/rules/${initialRule.id}` : "/dashboard/workflows/rules");
    } catch (e: any) {
      setError(e?.message ?? "Failed to save rule");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto w-full space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">
            <Workflow className="size-6 text-brand-cyan" /> {mode === "edit" ? "Edit Workflow Rule" : "Create Workflow Rule"}
          </h1>
        </div>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {["Basic Info", "When", "Conditions", "Actions"].map((label, i) => {
          const n = i + 1;
          const active = step === n;
          const done = step > n;
          return (
            <div key={n} className="flex items-center gap-2 flex-1">
              <div
                className={`size-7 rounded-full grid place-items-center text-xs font-semibold ${done
                    ? "bg-emerald-500 text-white"
                    : active
                      ? "bg-brand-cyan text-white"
                      : "bg-secondary text-muted-foreground"
                  }`}
              >
                {done ? "✓" : n}
              </div>
              <div className={`text-xs ${active ? "font-semibold" : "text-muted-foreground"}`}>{label}</div>
              {n < 4 && <div className={`flex-1 h-px ${done ? "bg-emerald-300" : "bg-border"}`} />}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="card-surface p-3 text-sm text-rose-700 bg-rose-50/40 flex items-start gap-2">
          <AlertTriangle className="size-4 mt-0.5" /> {error}
        </div>
      )}

      {/* Step body — key={step} re-triggers the slide-up animation on each step change */}
      <div key={step} className="card-surface p-6 space-y-5 animate-slide-up">
        {step === 1 && (
          <>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Module *</label>
              <SelectField
                value={moduleKey}
                onChange={(e) => setModuleKey(e.target.value)}
                className="input-base mt-1 w-full"
              >
                {modules.map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </SelectField>
              <p className="text-[11px] text-muted-foreground mt-1">
                This rule will apply to records in the selected module.
              </p>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Rule name *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Send welcome email when investor is created"
                className="input-base mt-1 w-full"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Optional — what this rule does and why."
                className="input-base mt-1 w-full"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Rate limit (max firings / hour)</label>
              <input
                type="number"
                min={1}
                max={100000}
                value={rateLimit}
                onChange={(e) => setRateLimit(e.target.value)}
                placeholder="Unlimited"
                className="input-base mt-1 w-full max-w-[200px]"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Optional safety cap — skips extra firings within an hour (protects your message quota).
              </p>
            </div>
          </>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <TriggerStep
              trigger={trigger}
              onChange={setTrigger}
              mod={mod}
              dateFields={dateFields}
              scoreFields={scoreFields}
            />
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <CriteriaStep
              mod={mod}
              rows={criteriaRows}
              setRows={setCriteriaRows}
              pattern={criteriaPattern}
              setPattern={setCriteriaPattern}
            />
          </div>
        )}

        {step === 4 && (
          <>
            <ActionsStep
              mod={mod}
              instantActions={instantActions}
              setInstantActions={setInstantActions}
              scheduledActions={scheduledActions}
              setScheduledActions={setScheduledActions}
              dateFields={dateFields}
            />
            <BranchesSection
              mod={mod}
              dateFields={dateFields}
              branches={branches}
              setBranches={setBranches}
              mainHasCriteria={criteriaRows.length > 0}
            />
          </>
        )}
      </div>

      {/* Nav — extra right padding so the primary button clears the floating
          quick-create (+) button pinned to the bottom-right of the viewport. */}
      <div className="flex items-center justify-between gap-3 pr-16 sm:pr-20 pb-2">
        <button
          type="button"
          disabled={step === 1}
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          className="btn-secondary text-sm"
        >
          <ChevronLeft className="size-4" /> Back
        </button>
        {step < 4 ? (
          <button
            type="button"
            disabled={!canProceed()}
            onClick={() => setStep((s) => s + 1)}
            className="btn-primary text-sm disabled:opacity-40"
          >
            Next <ChevronRight className="size-4" />
          </button>
        ) : (
          <button
            type="button"
            disabled={
              submitting ||
              (instantActions.length + scheduledActions.length === 0 &&
                !branches.some((b) => b.instantActions.length + b.scheduledActions.length > 0))
            }
            onClick={submit}
            className="btn-primary text-sm disabled:opacity-40"
          >
            <Save className="size-4" /> {submitting ? "Saving…" : mode === "edit" ? "Update Rule" : "Save Rule"}
          </button>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// STEP 2 — Trigger
// =============================================================================

function TriggerStep({
  trigger,
  onChange,
  mod,
  dateFields,
  scoreFields,
}: {
  trigger: Trigger;
  onChange: (t: Trigger) => void;
  mod: Module | undefined;
  dateFields: ModuleField[];
  scoreFields: ModuleField[];
}) {
  const trig = trigger as any;
  return (
    <div className="space-y-5">
      <div>
        <label className="text-xs font-semibold text-muted-foreground">
          Execute this workflow rule based on
        </label>
        <SelectField
          value={trigger.kind}
          onChange={(e) => {
            const k = e.target.value;
            if (k === "record_action")
              onChange({ kind: "record_action", when: "create", editMode: "any", fields: [], fieldConditions: [], repeat: false });
            else if (k === "date_field")
              onChange({
                kind: "date_field",
                field: dateFields[0]?.key ?? "",
                when: "on",
                offset: 0,
                unit: "day",
                recurrence: "once",
                time: "09:00",
              });
            else if (k === "score_change")
              onChange({ kind: "score_change", field: scoreFields[0]?.key ?? "", direction: "updated" });
            else if (k === "recurrence") onChange({ kind: "recurrence", cron: "0 9 * * 1" });
          }}
          className="input-base mt-1.5 w-full md:w-80"
        >
          <option value="record_action">Record action</option>
          <option value="date_field" disabled={dateFields.length === 0}>
            Date/Time field
          </option>
          <option value="score_change" disabled={scoreFields.length === 0}>
            Record Score
          </option>
          <option value="recurrence">Recurring schedule</option>
        </SelectField>
      </div>

      {trigger.kind === "record_action" && (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground">When</label>
            <SelectField
              value={trig.when}
              onChange={(e) => onChange({ ...trigger, when: e.target.value as any } as any)}
              className="input-base mt-1 w-full max-w-sm"
            >
              <option value="create">Create</option>
              <option value="edit">Edit</option>
              <option value="create_or_edit">Create or Edit</option>
              <option value="field_update">Field Update (specific fields)</option>
              <option value="delete">Delete</option>
            </SelectField>
          </div>
          {(trig.when === "edit" || trig.when === "field_update") && (
            <div>
              <label className="text-xs font-semibold text-muted-foreground">
                Only when these fields change (max 5)
              </label>
              <MultiSelectField
                values={trig.fields ?? []}
                onChange={(vals) => onChange({ ...trigger, fields: vals.slice(0, 5) } as any)}
                options={(mod?.fields ?? []).map((f) => ({ value: f.key, label: f.label }))}
                max={5}
                placeholder="Any field change — tick fields to narrow…"
                className="mt-1 w-full max-w-lg"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Leave empty to fire on <strong>any</strong> field change. Tick the fields to watch.
              </p>
            </div>
          )}
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={trig.repeat ?? false}
              onChange={(e) => onChange({ ...trigger, repeat: e.target.checked } as any)}
            />
            Repeat this rule every time a matching edit happens (Zoho's "Recurrence" toggle)
          </label>
        </div>
      )}

      {trigger.kind === "date_field" && (() => {
        const dfLabel = dateFields.find((f) => f.key === trig.field)?.label ?? "the date";
        return (
          <div className="space-y-3 max-w-2xl">
            <div className="grid grid-cols-1 sm:grid-cols-[230px_1fr] sm:items-center gap-1.5 sm:gap-3">
              <label className="text-xs font-medium text-muted-foreground sm:text-right leading-tight">
                Based on which Date/Time field this rule should execute
              </label>
              <SelectField
                value={trig.field}
                onChange={(e) => onChange({ ...trigger, field: e.target.value } as any)}
                className="input-base w-64"
              >
                {dateFields.map((f) => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </SelectField>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[230px_1fr] sm:items-center gap-1.5 sm:gap-3">
              <label className="text-xs font-medium text-muted-foreground sm:text-right">Define execution date</label>
              <div className="flex flex-wrap items-center gap-2">
                <SelectField
                  value={presetKeyFor(trig)}
                  onChange={(e) => {
                    const p = DATE_PRESETS.find((x) => x.key === e.target.value)!;
                    onChange({ ...trigger, when: p.when, offset: p.offset, unit: p.unit } as any);
                  }}
                  className="input-base w-44"
                >
                  {DATE_PRESETS.map((p) => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </SelectField>
                <span className="text-xs text-muted-foreground">
                  the date in <strong>{dfLabel}</strong> field
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[230px_1fr] sm:items-center gap-1.5 sm:gap-3">
              <label className="text-xs font-medium text-muted-foreground sm:text-right">Execution time</label>
              <div className="flex items-center gap-2 flex-wrap">
                <TimeField
                  value={trig.time ?? "09:00"}
                  onChange={(v) => onChange({ ...trigger, time: v } as any)}
                />
                <span className="text-xs text-muted-foreground">in the firm&rsquo;s timezone</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[230px_1fr] sm:items-center gap-1.5 sm:gap-3">
              <label className="text-xs font-medium text-muted-foreground sm:text-right">Recur</label>
              <SelectField
                value={trig.recurrence}
                onChange={(e) => onChange({ ...trigger, recurrence: e.target.value } as any)}
                className="input-base w-44"
              >
                <option value="once">Once</option>
                <option value="every_month">Every Month</option>
                <option value="every_year">Every Year</option>
              </SelectField>
            </div>
          </div>
        );
      })()}

      {trigger.kind === "score_change" && (
        <div className="space-y-3 max-w-2xl">
          <div className="grid grid-cols-1 sm:grid-cols-[230px_1fr] sm:items-center gap-1.5 sm:gap-3">
            <label className="text-xs font-medium text-muted-foreground sm:text-right">Record score</label>
            <SelectField
              value={trig.direction}
              onChange={(e) => onChange({ ...trigger, direction: e.target.value } as any)}
              className="input-base w-48"
            >
              <option value="increase">Increased</option>
              <option value="decrease">Decreased</option>
              <option value="updated">Updated</option>
            </SelectField>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[230px_1fr] sm:items-center gap-1.5 sm:gap-3">
            <label className="text-xs font-medium text-muted-foreground sm:text-right">This rule should be applied for</label>
            <SelectField
              value={trig.field}
              onChange={(e) => onChange({ ...trigger, field: e.target.value } as any)}
              className="input-base w-64"
            >
              {scoreFields.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </SelectField>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[230px_1fr] sm:items-center gap-1.5 sm:gap-3">
            <label className="text-xs font-medium text-muted-foreground sm:text-right">Threshold (optional)</label>
            <input
              type="number"
              value={trig.threshold ?? ""}
              onChange={(e) =>
                onChange({ ...trigger, threshold: e.target.value === "" ? undefined : Number(e.target.value) } as any)
              }
              className="input-base w-40"
              placeholder="e.g. 75"
            />
          </div>
        </div>
      )}

      {trigger.kind === "recurrence" && (
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Cron expression</label>
          <input
            value={trig.cron}
            onChange={(e) => onChange({ ...trigger, cron: e.target.value } as any)}
            className="input-base mt-1 w-full font-mono"
            placeholder="0 9 * * 1   (every Mon 9:00am)"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Standard cron format: minute hour day-of-month month day-of-week
          </p>
        </div>
      )}
    </div>
  );
}

function RadioCard({
  checked,
  onClick,
  title,
  desc,
  disabled,
}: {
  checked: boolean;
  onClick: () => void;
  title: string;
  desc: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`text-left rounded-lg border p-3 transition-colors disabled:opacity-40 ${checked ? "border-brand-cyan bg-brand-cyan-light/40" : "border-border hover:bg-secondary/40"
        }`}
    >
      <div className="font-semibold text-sm flex items-center gap-2">
        <span
          className={`size-3 rounded-full border ${checked ? "bg-brand-cyan border-brand-cyan" : "border-muted-foreground"
            }`}
        />
        {title}
      </div>
      <p className="text-[11px] text-muted-foreground mt-1 pl-5">{desc}</p>
    </button>
  );
}

// =============================================================================
// STEP 3 — Criteria
// =============================================================================

/** Zoho-style phase badge (the navy WHEN / CONDITION / ACTIONS pill). */
/** Zoho-style searchable field dropdown (search box + filtered list). */
function SearchableFieldSelect({
  fields,
  value,
  onChange,
  placeholder = "None",
  className,
}: {
  fields: ModuleField[];
  value: string;
  onChange: (key: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = fields.find((f) => f.key === value);
  const filtered = q.trim() ? fields.filter((f) => f.label.toLowerCase().includes(q.trim().toLowerCase())) : fields;
  return (
    <div className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="input-base text-xs w-full flex items-center justify-between gap-2"
      >
        <span className={selected ? "" : "text-muted-foreground"}>{selected?.label ?? placeholder}</span>
        <ChevronDown className="size-3.5 opacity-60 shrink-0" />
      </button>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-20 cursor-default" aria-hidden onClick={() => setOpen(false)} />
          <div className="absolute z-30 mt-1 w-full min-w-[200px] card-elevated overflow-hidden">
            <div className="p-2 border-b border-border flex items-center gap-1.5">
              <Search className="size-3.5 text-muted-foreground shrink-0" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search…"
                className="bg-transparent outline-none text-xs w-full"
              />
            </div>
            <ul className="max-h-52 overflow-y-auto scrollbar-thin py-1">
              {filtered.map((f) => (
                <li key={f.key}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(f.key);
                      setOpen(false);
                      setQ("");
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-brand-cyan-light/40 ${f.key === value ? "font-semibold text-brand-cyan-deep" : ""
                      }`}
                  >
                    {f.label}
                  </button>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="px-3 py-2 text-[11px] text-muted-foreground">No fields match.</li>
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

// --- AND / OR / NOT joiner helpers (drive the optional pattern string) -------
type Joiner = "AND" | "OR" | "NOT";
/** Derive the connector for each gap between rows from the pattern string.
 *  Empty/trivial pattern → all AND. Tolerant of parentheses (flattened). */
function parseJoiners(pattern: string, n: number): Joiner[] {
  const gaps = Math.max(0, n - 1);
  const out: Joiner[] = Array(gaps).fill("AND");
  if (!pattern || !pattern.trim()) return out;
  const toks = pattern.toUpperCase().replace(/[()]/g, " ").split(/\s+/).filter(Boolean);
  let seen = 0;
  let conn: Joiner = "AND";
  let neg = false;
  for (const t of toks) {
    if (t === "AND" || t === "OR") conn = t;
    else if (t === "NOT") neg = true;
    else if (/^\d+$/.test(t)) {
      if (seen >= 1) {
        const g = seen - 1;
        if (g < gaps) out[g] = neg ? "NOT" : conn;
      }
      seen++;
      conn = "AND";
      neg = false;
    }
  }
  return out;
}
/** Rebuild a canonical pattern string from per-gap joiners ("NOT" ⇒ AND NOT). */
function buildPattern(joiners: Joiner[], n: number): string {
  if (n <= 1) return "";
  let s = "1";
  for (let i = 1; i < n; i++) {
    const j = joiners[i - 1] ?? "AND";
    s += j === "NOT" ? ` AND NOT ${i + 1}` : ` ${j} ${i + 1}`;
  }
  return s;
}

function CriteriaStep({
  mod,
  rows,
  setRows,
  pattern,
  setPattern,
}: {
  mod: Module | undefined;
  rows: CriteriaRow[];
  setRows: (r: CriteriaRow[]) => void;
  pattern: string;
  setPattern: (p: string) => void;
}) {
  function addRow() {
    if (rows.length >= 10) return;
    const f = mod?.fields[0];
    setRows([...rows, { field: f?.key ?? "", operator: "is", value: "" }]);
  }
  function update(i: number, patch: Partial<CriteriaRow>) {
    setRows(rows.map((r, ix) => (ix === i ? { ...r, ...patch } : r)));
  }
  function removeRow(i: number) {
    setRows(rows.filter((_, ix) => ix !== i));
  }

  // AND/OR/NOT joiner buttons between rows — derived from (and writing back to)
  // the optional pattern string, so the manual Pattern field stays in sync.
  const joiners = parseJoiners(pattern, rows.length);
  function setJoiner(gap: number, op: Joiner) {
    const next = [...joiners];
    next[gap] = op;
    // All-AND collapses to "" so the field stays clean (server defaults to AND).
    setPattern(next.every((j) => j === "AND") ? "" : buildPattern(next, rows.length));
  }

  const subject = mod?.label ?? "records";
  const mode: "all" | "conditions" = rows.length > 0 ? "conditions" : "all";

  return (
    <div className="space-y-4">
      <div className="text-sm font-medium">Which {subject.toLowerCase()} would you like to apply the rule to?</div>
      <div className="flex flex-wrap items-center gap-6">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="radio"
            checked={mode === "conditions"}
            onChange={() => {
              if (rows.length === 0) addRow();
            }}
            className="accent-brand-cyan"
          />
          Records matching certain conditions
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="radio" checked={mode === "all"} onChange={() => setRows([])} className="accent-brand-cyan" />
          All records
        </label>
      </div>

      {mode === "conditions" ? (
        <div className="space-y-2">
          {rows.map((row, i) => {
            const field = mod?.fields.find((f) => f.key === row.field);
            const ops = opsForType(field?.type ?? "string");
            const noValue =
              row.operator === "is_empty" ||
              row.operator === "is_not_empty" ||
              ["today", "yesterday", "tomorrow"].includes(row.operator);
            return (
              <Fragment key={i}>
                <div className="flex items-center gap-2">
                  <span className="grid place-items-center size-6 rounded-full bg-secondary text-[11px] font-semibold text-muted-foreground shrink-0">
                    {i + 1}
                  </span>
                  <SearchableFieldSelect
                    fields={mod?.fields ?? []}
                    value={row.field}
                    onChange={(key) => update(i, { field: key, operator: "is", value: "" })}
                    className="w-52"
                  />
                  <SelectField
                    value={row.operator}
                    onChange={(e) => update(i, { operator: e.target.value })}
                    className="input-base text-xs w-40"
                  >
                    {ops.map((o) => (
                      <option key={o.key} value={o.key}>{o.label}</option>
                    ))}
                  </SelectField>
                  {!noValue ? (
                    <CriteriaValueInput field={field} op={row.operator} value={row.value} onChange={(v) => update(i, { value: v })} />
                  ) : (
                    <div className="flex-1" />
                  )}
                  <button onClick={addRow} className="btn-icon h-7 text-brand-cyan" title="Add condition">
                    <Plus className="size-4" />
                  </button>
                  {rows.length > 1 && (
                    <button onClick={() => removeRow(i)} className="btn-icon h-7 text-rose-600" title="Remove">
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
                {/* Joiner to the next row — AND / OR / NOT; active shows a ✔. */}
                {i < rows.length - 1 && (
                  <div className="flex items-center gap-1.5 pl-8 py-0.5">
                    {(["AND", "OR", "NOT"] as const).map((op) => {
                      const isActive = joiners[i] === op;
                      return (
                        <button
                          key={op}
                          type="button"
                          onClick={() => setJoiner(i, op)}
                          className={`text-[11px] font-semibold rounded-md px-2.5 py-1 border transition-colors ${isActive
                              ? "bg-brand-cyan text-white border-brand-cyan"
                              : "bg-secondary/40 text-muted-foreground border-border hover:bg-secondary"
                            }`}
                        >
                          {isActive ? "✔ " : ""}
                          {op}
                        </button>
                      );
                    })}
                  </div>
                )}
              </Fragment>
            );
          })}
          {rows.length === 0 && (
            <button onClick={addRow} className="btn-secondary text-xs">
              <Plus className="size-3.5" /> Add condition
            </button>
          )}

          {rows.length >= 2 && (
            <div className="mt-3">
              <label className="text-xs font-semibold text-muted-foreground">Pattern (optional)</label>
              <input
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder={`e.g. 1 AND (2 OR 3)`}
                className="input-base text-xs mt-1 w-full max-w-md font-mono"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Use AND, OR, NOT and parentheses with the row numbers. Empty defaults to AND of all rows.
              </p>
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          The rule will run for <strong>every</strong> {subject.toLowerCase()} record that triggers it.
        </p>
      )}
    </div>
  );
}

function CriteriaValueInput({ field, op, value, onChange }: { field: ModuleField | undefined; op: string; value: any; onChange: (v: any) => void }) {
  if (!field) return <input className="input-base text-xs flex-1" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
  if (field.type === "enum" && field.enumValues) {
    return (
      <SelectField className="input-base text-xs flex-1" value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {field.enumValues.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </SelectField>
    );
  }
  if (field.type === "boolean") {
    return (
      <SelectField className="input-base text-xs flex-1" value={String(value ?? "")} onChange={(e) => onChange(e.target.value === "true")}>
        <option value="true">true</option>
        <option value="false">false</option>
      </SelectField>
    );
  }
  if (field.type === "date" || field.type === "datetime") {
    if (op === "last_n_days" || op === "next_n_days") {
      return <input type="number" className="input-base text-xs flex-1" min={1} value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))} placeholder="N days" />;
    }
    return <input type="date" className="input-base text-xs flex-1" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
  }
  if (field.type === "integer" || field.type === "number" || field.type === "currency") {
    return <input type="number" className="input-base text-xs flex-1" value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))} />;
  }
  return <input className="input-base text-xs flex-1" value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder="value" />;
}

// =============================================================================
// STEP 4 — Actions
// =============================================================================

function ActionsStep({
  mod,
  instantActions,
  setInstantActions,
  scheduledActions,
  setScheduledActions,
  dateFields,
}: {
  mod: Module | undefined;
  instantActions: Action[];
  setInstantActions: (a: Action[]) => void;
  scheduledActions: ScheduledAction[];
  setScheduledActions: (a: ScheduledAction[]) => void;
  dateFields: ModuleField[];
}) {
  function addInstant(typeKey: string) {
    setInstantActions([...instantActions, { type: typeKey, config: defaultConfigFor(typeKey, mod) }]);
  }
  function addScheduled(typeKey: string) {
    setScheduledActions([
      ...scheduledActions,
      { type: typeKey, config: defaultConfigFor(typeKey, mod), delay: { amount: 1, unit: "day", anchor: "trigger" } },
    ]);
  }

  return (
    <div className="space-y-6">
      {/* Instant */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="font-semibold text-sm">Instant Actions</h3>
            <p className="text-[11px] text-muted-foreground">Fire immediately when the rule matches.</p>
          </div>
          <ActionTypePicker onPick={addInstant} />
        </div>
        {instantActions.length === 0 ? (
          <div className="card-surface p-6 text-center text-xs text-muted-foreground border-dashed border-2">
            No instant actions yet — add one above.
          </div>
        ) : (
          <div className="space-y-2">
            {instantActions.map((a, i) => (
              <ActionRow
                key={i}
                action={a}
                onChange={(next) => setInstantActions(instantActions.map((x, ix) => (ix === i ? next : x)))}
                onRemove={() => setInstantActions(instantActions.filter((_, ix) => ix !== i))}
                mod={mod}
              />
            ))}
          </div>
        )}
      </div>

      {/* Scheduled */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="font-semibold text-sm">Scheduled Actions</h3>
            <p className="text-[11px] text-muted-foreground">Fire after a delay relative to the trigger.</p>
          </div>
          <ActionTypePicker onPick={addScheduled} excludeKeys={["convert_lead"]} />
        </div>
        {scheduledActions.length === 0 ? (
          <div className="card-surface p-6 text-center text-xs text-muted-foreground border-dashed border-2">
            No scheduled actions — Zoho's time-delayed actions like "send reminder 3 days after creation".
          </div>
        ) : (
          <div className="space-y-2">
            {scheduledActions.map((a, i) => (
              <ScheduledActionRow
                key={i}
                action={a}
                onChange={(next) =>
                  setScheduledActions(scheduledActions.map((x, ix) => (ix === i ? next : x)))
                }
                onRemove={() => setScheduledActions(scheduledActions.filter((_, ix) => ix !== i))}
                mod={mod}
                dateFields={dateFields}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ActionTypePicker({ onPick, excludeKeys = [] }: { onPick: (k: string) => void; excludeKeys?: string[] }) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<string | null>(null);

  const pick = (k: string) => {
    onPick(k);
    setOpen(false);
    setSub(null);
  };

  // Build the grouped menu, dropping excluded keys (and empty groups).
  const groups = ACTION_MENU.map((g) =>
    g.items ? { ...g, items: g.items.filter((it) => !excludeKeys.includes(it.key)) } : g,
  ).filter((g) => (g.items ? g.items.length > 0 : !excludeKeys.includes(g.key!)));

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="btn-secondary text-xs">
        <Plus className="size-3.5" /> Add action
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => { setOpen(false); setSub(null); }} />
          <div className="absolute right-0 top-full mt-1 z-30 card-elevated w-56 py-1">
            {groups.map((g) =>
              g.items ? (
                <div
                  key={g.label}
                  className="relative"
                  onMouseEnter={() => setSub(g.label)}
                  onMouseLeave={() => setSub((s) => (s === g.label ? null : s))}
                >
                  <button
                    type="button"
                    onClick={() => setSub((s) => (s === g.label ? null : g.label))}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-brand-cyan-light/40 flex items-center justify-between"
                  >
                    {g.label}
                    <ChevronRight className="size-3.5 opacity-60" />
                  </button>
                  {sub === g.label && (
                    // Open submenus to the LEFT — the parent menu is anchored to
                    // the right edge, so a right-opening submenu runs off-screen.
                    <div className="absolute right-full top-0 -mr-1 z-40 card-elevated w-56 py-1">
                      {g.items.map((it) => (
                        <button
                          key={it.key}
                          type="button"
                          onClick={() => pick(it.key)}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-brand-cyan-light/40"
                        >
                          {it.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => pick(g.key!)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-brand-cyan-light/40"
                >
                  {g.label}
                </button>
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ActionRow({
  action,
  onChange,
  onRemove,
  mod,
}: {
  action: Action;
  onChange: (a: Action) => void;
  onRemove: () => void;
  mod: Module | undefined;
}) {
  const meta = ACTION_TYPES.find((t) => t.key === action.type);
  return (
    <div className="card-surface p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{meta?.label ?? action.type}</div>
        <button onClick={onRemove} className="btn-icon h-6 text-rose-600">
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <ActionConfigEditor action={action} onChange={onChange} mod={mod} />
    </div>
  );
}

function ScheduledActionRow({
  action,
  onChange,
  onRemove,
  mod,
  dateFields,
}: {
  action: ScheduledAction;
  onChange: (a: ScheduledAction) => void;
  onRemove: () => void;
  mod: Module | undefined;
  dateFields: ModuleField[];
}) {
  const meta = ACTION_TYPES.find((t) => t.key === action.type);
  return (
    <div className="card-surface p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{meta?.label ?? action.type}</div>
        <button onClick={onRemove} className="btn-icon h-6 text-rose-600">
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2 items-end">
        <div className="col-span-1">
          <label className="text-[10px] text-muted-foreground">Delay amount</label>
          <input
            type="number"
            min={1}
            value={action.delay.amount}
            onChange={(e) =>
              onChange({ ...action, delay: { ...action.delay, amount: Number(e.target.value) } })
            }
            className="input-base text-xs w-full"
          />
        </div>
        <div className="col-span-1">
          <label className="text-[10px] text-muted-foreground">Unit</label>
          <SelectField
            value={action.delay.unit}
            onChange={(e) => onChange({ ...action, delay: { ...action.delay, unit: e.target.value as any } })}
            className="input-base text-xs w-full"
          >
            <option value="minute">Minutes</option>
            <option value="hour">Hours</option>
            <option value="day">Days</option>
            <option value="week">Weeks</option>
          </SelectField>
        </div>
        <div className="col-span-2">
          <label className="text-[10px] text-muted-foreground">Anchor</label>
          <SelectField
            value={action.delay.anchor}
            onChange={(e) =>
              onChange({ ...action, delay: { ...action.delay, anchor: e.target.value as any } })
            }
            className="input-base text-xs w-full"
          >
            <option value="trigger">After rule fires (default)</option>
            {dateFields.length > 0 && <option value="date_field">Relative to a date field</option>}
          </SelectField>
        </div>
        {action.delay.anchor === "date_field" && (
          <div className="col-span-4">
            <label className="text-[10px] text-muted-foreground">Date field</label>
            <SelectField
              value={action.delay.anchorField ?? dateFields[0]?.key ?? ""}
              onChange={(e) =>
                onChange({ ...action, delay: { ...action.delay, anchorField: e.target.value } })
              }
              className="input-base text-xs w-full"
            >
              {dateFields.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </SelectField>
          </div>
        )}
      </div>

      <ActionConfigEditor action={action} onChange={(next) => onChange({ ...action, ...next })} mod={mod} />
    </div>
  );
}

// Module-level cache so the template list is fetched once, not per action row.
let _ruleTplCache: Array<{ key: string; name: string; channel: string; status?: string }> | null = null;

function ActionConfigEditor({
  action,
  onChange,
  mod,
}: {
  action: Action;
  onChange: (next: Action) => void;
  mod: Module | undefined;
}) {
  const c = action.config ?? {};
  function set(patch: Record<string, any>) {
    onChange({ ...action, config: { ...c, ...patch } });
  }

  const [allTemplates, setAllTemplates] = useState(_ruleTplCache ?? []);
  useEffect(() => {
    if (_ruleTplCache) return;
    fetch("/api/templates")
      .then((r) => r.json())
      .then((j) => { _ruleTplCache = j.templates ?? []; setAllTemplates(_ruleTplCache!); })
      .catch(() => { });
  }, []);

  switch (action.type) {
    case "send_email":
    case "send_whatsapp":
    case "send_sms":
      return (
        (() => {
          const channel = action.type === "send_email" ? "email" : action.type === "send_whatsapp" ? "whatsapp" : "sms";
          const opts = allTemplates.filter((t) => t.channel === channel);
          const chosen = String(c.templateKey ?? "");
          const knownKey = !chosen || opts.some((t) => t.key === chosen);
          return (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Template</label>
                  <SelectField
                    value={chosen}
                    onChange={(e) => set({ templateKey: e.target.value })}
                    className="input-base text-xs w-full"
                  >
                    <option value="">{opts.length ? "Select a template…" : "No templates yet — create one first"}</option>
                    {opts.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.name}{t.status && t.status !== "approved" ? ` (${t.status.replace(/_/g, " ")})` : ""}
                      </option>
                    ))}
                    {!knownKey && <option value={chosen}>{chosen} (custom)</option>}
                  </SelectField>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Category</label>
                  <SelectField
                    value={String(c.category ?? "transactional")}
                    onChange={(e) => set({ category: e.target.value })}
                    className="input-base text-xs w-full"
                  >
                    <option value="transactional">Transactional</option>
                    <option value="utility">Utility</option>
                    <option value="marketing">Marketing</option>
                  </SelectField>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Send to</label>
                <SelectField
                  value={String(c.recipient ?? "subject")}
                  onChange={(e) => set({ recipient: e.target.value })}
                  className="input-base text-xs w-full"
                >
                  <option value="subject">The record that triggered this (lead / client)</option>
                  <option value="referrer">Referring client (Referred-by) — for Lead rules</option>
                </SelectField>
                {String(c.recipient ?? "subject") === "referrer" && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Sends to the client linked in the lead&apos;s &ldquo;Referred by&rdquo; field. The new lead&apos;s name is
                    available in your template as <code>{"{{referred_lead_name}}"}</code>. Skipped if the lead has no linked
                    referring client or they have no {channel} on file.
                  </p>
                )}
              </div>
              {action.type === "send_email" && (
                <div>
                  <label className="text-[10px] text-muted-foreground">Send from</label>
                  <SelectField
                    value={String(c.fromAddress ?? "organization")}
                    onChange={(e) => set({ fromAddress: e.target.value })}
                    className="input-base text-xs w-full"
                  >
                    <option value="organization">Organization email (firm default)</option>
                    <option value="record_owner">Record owner — the client&apos;s RM</option>
                  </SelectField>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">
                {opts.length === 0
                  ? "Create a template under Templates → New (channel: " + channel + ") — it'll appear in this list."
                  : "Pick a template your firm created. It must be Approved to actually send."}
              </p>
            </div>
          );
        })()
      );
    case "create_task":
    case "schedule_call":
      return (
        <div className="grid grid-cols-2 gap-2">
          <input
            value={String(c.title ?? "")}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="Task title"
            className="input-base text-xs col-span-2"
          />
          <SelectField value={String(c.priority ?? "normal")} onChange={(e) => set({ priority: e.target.value })} className="input-base text-xs">
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </SelectField>
          <input
            value={String(c.assignee ?? "subject.rm_id")}
            onChange={(e) => set({ assignee: e.target.value })}
            placeholder="subject.rm_id | fixed:<userId>"
            className="input-base text-xs font-mono"
          />
        </div>
      );
    case "schedule_meeting":
      return (
        <div className="grid grid-cols-2 gap-2">
          <SelectField value={String(c.category ?? "review")} onChange={(e) => set({ category: e.target.value })} className="input-base text-xs">
            <option value="review">Review</option>
            <option value="new">New</option>
            <option value="follow_up">Follow-up</option>
          </SelectField>
          <SelectField value={String(c.mode ?? "online")} onChange={(e) => set({ mode: e.target.value })} className="input-base text-xs">
            <option value="online">Online</option>
            <option value="office">Office</option>
            <option value="client_place">Client place</option>
            <option value="phone">Phone</option>
          </SelectField>
        </div>
      );
    case "update_field":
      return (
        <UpdateFieldEditor
          value={(c.updates as Record<string, any>) ?? {}}
          mod={mod}
          onChange={(updates) => set({ updates })}
        />
      );
    case "add_tag":
    case "remove_tag":
      return (
        <input
          value={String(c.tag ?? "")}
          onChange={(e) => set({ tag: e.target.value })}
          placeholder="e.g. hot-lead"
          className="input-base text-xs w-full"
        />
      );
    case "webhook":
      return (
        <div className="grid grid-cols-3 gap-2">
          <input
            value={String(c.url ?? "")}
            onChange={(e) => set({ url: e.target.value })}
            placeholder="https://example.com/webhook"
            className="input-base text-xs col-span-2"
          />
          <SelectField value={String(c.method ?? "POST")} onChange={(e) => set({ method: e.target.value })} className="input-base text-xs">
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="GET">GET</option>
          </SelectField>
        </div>
      );
    case "create_notification":
      return (
        <div className="space-y-2">
          <input
            value={String(c.title ?? "")}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="Notification title — e.g. SIP rejected for {{name}}"
            className="input-base text-xs w-full"
          />
          <textarea
            value={String(c.body ?? "")}
            onChange={(e) => set({ body: e.target.value })}
            placeholder="Notification body — {{name}}, {{rm_name}}, or any field of the record"
            rows={2}
            className="input-base text-xs w-full"
          />
          <label className="flex items-center gap-2 text-[11px]">
            <input
              type="checkbox"
              checked={!!(c.audience as any)?.subjectRm}
              onChange={(e) =>
                set({
                  audience: { ...(c.audience as any), subjectRm: e.target.checked },
                })
              }
            />
            Notify subject's RM
          </label>
          <p className="text-[10px] text-muted-foreground">
            Tokens like <code>{"{{name}}"}</code> render the client/lead name. If you use none, the
            name is appended to the title automatically, and the alert links to the record.
          </p>
        </div>
      );
    default:
      return (
        <div className="text-[11px] text-muted-foreground italic">
          Default config — edit JSON via the rule's detail page after save.
        </div>
      );
  }
}

function UpdateFieldEditor({
  value,
  mod,
  onChange,
}: {
  value: Record<string, any>;
  mod: Module | undefined;
  onChange: (next: Record<string, any>) => void;
}) {
  const writable = (mod?.fields ?? []).filter((f) => f.writable);
  const entries = Object.entries(value);
  function addBlank() {
    if (!writable.length) return;
    onChange({ ...value, [writable[0].key]: "" });
  }
  function update(key: string, newKey: string, newValue: any) {
    const next: Record<string, any> = {};
    for (const [k, v] of entries) {
      if (k === key) next[newKey] = newValue;
      else next[k] = v;
    }
    onChange(next);
  }
  function remove(key: string) {
    const next = { ...value };
    delete next[key];
    onChange(next);
  }
  return (
    <div className="space-y-1">
      {entries.length === 0 && <div className="text-[11px] text-muted-foreground italic">No field updates yet.</div>}
      {entries.map(([k, v]) => {
        const field = writable.find((f) => f.key === k);
        return (
          <div key={k} className="flex items-center gap-1">
            <SelectField value={k} onChange={(e) => update(k, e.target.value, v)} className="input-base text-xs flex-1">
              {writable.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </SelectField>
            {field?.type === "enum" && field.enumValues ? (
              <SelectField value={String(v ?? "")} onChange={(e) => update(k, k, e.target.value)} className="input-base text-xs flex-1">
                <option value="">Select…</option>
                {field.enumValues.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </SelectField>
            ) : (
              <input value={String(v ?? "")} onChange={(e) => update(k, k, e.target.value)} className="input-base text-xs flex-1" />
            )}
            <button onClick={() => remove(k)} className="btn-icon h-6 text-rose-600">
              <Trash2 className="size-3" />
            </button>
          </div>
        );
      })}
      <button onClick={addBlank} className="btn-ghost text-[11px]" disabled={!writable.length}>
        <Plus className="size-3" /> Add field update
      </button>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function defaultConfigFor(typeKey: string, mod: Module | undefined): Record<string, any> {
  switch (typeKey) {
    case "send_email":
    case "send_whatsapp":
    case "send_sms":
      return { templateKey: "", category: "transactional", recipient: "subject" };
    case "create_task":
    case "schedule_call":
      return { title: "", priority: "normal", assignee: "subject.rm_id" };
    case "schedule_meeting":
      return { category: "review", meetingType: "portfolio_review", mode: "online", durationMinutes: 30 };
    case "update_field":
      return { updates: {} };
    case "webhook":
      return { url: "", method: "POST" };
    case "create_notification":
      return { title: "", body: "", audience: { subjectRm: true } };
    case "add_tag":
    case "remove_tag":
      return { tag: "" };
    default:
      return {};
  }
}

function triggerConfigFromState(t: Trigger): Record<string, any> {
  // Pass the full state through — for record_action this carries the old
  // `fields[]` watch-list (Cmd/Ctrl-click multi-select); the runner honours it
  // via the legacy cfg.fields path.
  const { kind, ...rest } = t as any;
  return rest;
}

// =============================================================================
// Condition branches (Zoho: multiple conditions per rule, first match wins)
// =============================================================================

function BranchesSection({
  mod,
  dateFields,
  branches,
  setBranches,
  mainHasCriteria,
}: {
  mod: Module | undefined;
  dateFields: ModuleField[];
  branches: Branch[];
  setBranches: (b: Branch[]) => void;
  mainHasCriteria: boolean;
}) {
  function addBranch() {
    if (branches.length >= 9) return; // main criteria + 9 = Zoho's 10-condition cap
    setBranches([
      ...branches,
      { name: `Condition ${branches.length + 2}`, criteriaPattern: "", criteriaRows: [], instantActions: [], scheduledActions: [] },
    ]);
  }
  function patch(i: number, p: Partial<Branch>) {
    setBranches(branches.map((b, idx) => (idx === i ? { ...b, ...p } : b)));
  }
  function remove(i: number) {
    setBranches(branches.filter((_, idx) => idx !== i));
  }

  return (
    <div className="pt-5 border-t border-border space-y-4">
      <div>
        <div className="text-sm font-semibold">Condition branches <span className="text-muted-foreground font-normal">(optional)</span></div>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          The Conditions + Actions above are <strong>Condition 1</strong>. Add more branches and a record
          falls into the <strong>first</strong> branch (top-down) whose conditions match — e.g. “Hot lead → call task,
          Cold lead → nurture email” in one rule.
        </p>
        {branches.length > 0 && !mainHasCriteria && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 mt-2">
            Condition 1 has no criteria, so it matches <strong>every</strong> record and the branches below
            will never be reached. Add criteria to Condition 1 (step 3), ordering specific → general.
          </p>
        )}
      </div>

      {branches.map((b, i) => (
        <div key={i} className="rounded-xl border border-border bg-secondary/20 p-4 space-y-4">
          <div className="flex items-center gap-2">
            <span className="chip bg-brand-cyan-light text-brand-cyan-deep text-[10px] font-bold shrink-0">
              Condition {i + 2}
            </span>
            <input
              value={b.name}
              onChange={(e) => patch(i, { name: e.target.value })}
              placeholder="Branch name (e.g. Hot leads)"
              className="input-base text-sm flex-1"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="size-8 grid place-items-center rounded-lg border border-border/60 text-muted-foreground hover:text-rose-600 hover:border-rose-200"
              title="Remove this branch"
            >
              <Trash2 className="size-4" />
            </button>
          </div>

          <CriteriaStep
            mod={mod}
            rows={b.criteriaRows}
            setRows={(rows) => patch(i, { criteriaRows: rows })}
            pattern={b.criteriaPattern}
            setPattern={(pattern) => patch(i, { criteriaPattern: pattern })}
          />

          <ActionsStep
            mod={mod}
            instantActions={b.instantActions}
            setInstantActions={(a) => patch(i, { instantActions: a })}
            scheduledActions={b.scheduledActions}
            setScheduledActions={(a) => patch(i, { scheduledActions: a })}
            dateFields={dateFields}
          />
        </div>
      ))}

      <button
        type="button"
        onClick={addBranch}
        disabled={branches.length >= 9}
        className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-xs font-semibold text-muted-foreground hover:text-brand-cyan-deep hover:border-brand-cyan/50 hover:bg-brand-cyan-light/30 py-2.5 transition-colors disabled:opacity-40"
      >
        <Plus className="size-3.5" /> Add condition branch
      </button>
    </div>
  );
}
