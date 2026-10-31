"use client";

/**
 * New Task form — Module 18 spec.
 *
 *   1. Title + description + remarks
 *   2. Related-entity pickers — Client (InvestorLookup), Lead, Service Request, Meeting
 *   3. Department, Type, Priority, Due date
 *   4. Assignee (defaults to creator on backend)
 *
 * The four related-entity pickers all populate the same task row; whichever
 * is set first also seeds the legacy subjectType/subjectId so existing
 * queries keep working.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  ListChecks,
  Save,
  Loader2,
  X,
  Search,
  Sparkles,
  LifeBuoy,
  Calendar,
  LayoutTemplate,
  Plus,
  Bell,
  ShieldCheck,
  Timer,
  Tag as TagIcon,
} from "lucide-react";
import { InvestorLookup } from "@/components/common/InvestorLookup";
import { RmSelector } from "@/components/common/RmSelector";
import { SelectField } from "@/components/ui/SelectField";
import { DEPARTMENTS } from "@/config/departments";
import { AttachmentPicker, uploadAttachments } from "@/components/common/EntityAttachments";
import { useToast } from "@/components/ui/Toast";
import { readApiError, readThrownError } from "@/lib/api/client-error";
import { DateField } from "@/components/ui/DateField";

type TaskTemplate = {
  id: string;
  name: string;
  description: string | null;
  taskType: string | null;
  department: string | null;
  priority: string | null;
  dueOffsetDays: number | null;
  subtasks: Array<{ id: string; text: string }>;
  isActive: boolean;
};

type ChecklistItem = { id: string; text: string; done: boolean };

/** Type values the form's Type <SelectField> knows natively. */
const KNOWN_TYPES = [
  "follow_up",
  "review_meeting",
  "collect_document",
  "kyc_renewal",
  "mandate_renewal",
  "marketing_material",
];


/**
 * "Other activity" kinds — day-to-day work that is not a client task. Opening
 * this form as /dashboard/tasks/new?activity=<key> files the result under
 * Tasks → Other activity instead of the normal task list.
 */
const ACTIVITY_KINDS = [
  { key: "bank_work", label: "Bank work" },
  { key: "amc_work", label: "AMC work" },
  { key: "ba_service", label: "BA service" },
  { key: "other", label: "Other" },
] as const;
type ActivityKey = (typeof ACTIVITY_KINDS)[number]["key"];

export default function NewTaskPage() {
  const router = useRouter();
  const toast = useToast();
  // Read from the URL after mount (not useSearchParams, which would force a
  // Suspense boundary around the whole page).
  const [activityKind, setActivityKind] = useState<ActivityKey | "">("");
  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get("activity");
    const hit = ACTIVITY_KINDS.find((a) => a.key === k);
    if (hit) setActivityKind(hit.key);
  }, []);
  const activity = ACTIVITY_KINDS.find((a) => a.key === activityKind) ?? null;
  const [form, setForm] = useState({
    title: "",
    description: "",
    type: "follow_up",
    customType: "", // name entered when type === "custom"
    priority: "normal",
    dueDate: defaultDueDate(3),
    department: "",
    assigneeId: "",
    remarks: "",
    requiresApproval: false,
    contentKind: "", // marketing content request: post | reel | carousel | other
    eventKey: "",
    eventLabel: "",
    reminder: "none", // none | at_due | 1h | 3h | 1d | 2d | 1w  (relative to due)
    estimateMinutes: "", // planned effort (minutes)
    tags: [] as string[],
    recurrence: "", // "" = one-off
    recurrenceUntil: "",
    relatedInvestorId: "",
    relatedInvestorName: "",
    relatedLeadId: "",
    relatedLeadName: "",
    relatedServiceRequestId: "",
    relatedServiceRequestLabel: "",
    relatedMeetingId: "",
    relatedMeetingLabel: "",
  });
  const [events, setEvents] = useState<{ key: string; label: string }[]>([]);
  useEffect(() => {
    fetch("/api/lead-events")
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((j) => setEvents(j?.events ?? []))
      .catch(() => setEvents([]));
  }, []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  function addTag(raw: string) {
    const v = raw.trim().replace(/,$/, "").slice(0, 40);
    setForm((s) => (v && !s.tags.includes(v) ? { ...s, tags: [...s.tags, v] } : s));
    setTagInput("");
  }

  // ── Task templates ──
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  // Held in memory until the task exists — a task id is needed to upload
  // against. See save().
  const [attachments, setAttachments] = useState<File[]>([]);
  const [titleTouched, setTitleTouched] = useState(false);

  // Assigning a task to someone ELSE needs task.assign.others — the POST
  // enforces it. Read it up front and offer what will actually work, rather
  // than offering the department and failing on submit once everything has
  // been filled in.
  // Null = not loaded yet; assume allowed so the picker doesn't flicker shut.
  const [canAssignOthers, setCanAssignOthers] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/me")
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const caps: string[] = j?.capabilities ?? [];
        setCanAssignOthers(caps.includes("task.assign.others"));
      })
      .catch(() => { if (alive) setCanAssignOthers(null); });
    return () => { alive = false; };
  }, []);

  // Templates are optional, but SILENTLY optional was the bug: when this call
  // failed the picker just rendered empty, indistinguishable from a firm that
  // has no templates. Say so, and let the rest of the form carry on.
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const loadTemplates = useCallback(async (opts?: { silent?: boolean }) => {
    setTemplatesError(null);
    try {
      const r = await fetch("/api/task-templates");
      if (!r.ok) {
        const f = await readApiError(r, "load task templates");
        setTemplatesError(f.message);
        if (!opts?.silent) toast.error(f.message);
        return;
      }
      const j = await r.json();
      setTemplates(Array.isArray(j.templates) ? j.templates : []);
    } catch (e) {
      const f = readThrownError(e, "load task templates");
      setTemplatesError(f.message);
      if (!opts?.silent) toast.error(f.message);
    }
  }, [toast]);

  useEffect(() => {
    void loadTemplates({ silent: true });
  }, [loadTemplates]);

  function applyTemplate(id: string) {
    setTemplateId(id);
    if (!id) {
      // "— blank task —": drop template-derived sub-tasks; leave typed fields alone.
      setChecklist([]);
      if (!titleTouched) set("title", "");
      return;
    }
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setForm((s) => {
      const next = { ...s };
      if (!titleTouched || !s.title.trim()) next.title = t.name;
      if (t.description && !s.description.trim()) next.description = t.description;
      if (t.taskType) {
        if (KNOWN_TYPES.includes(t.taskType)) {
          next.type = t.taskType;
          next.customType = "";
        } else {
          next.type = "custom";
          next.customType = t.taskType;
        }
      }
      if (t.priority && ["low", "normal", "high", "urgent"].includes(t.priority))
        next.priority = t.priority;
      if (t.department && DEPARTMENTS.some(([k]) => k === t.department))
        next.department = t.department;
      if (t.dueOffsetDays != null) next.dueDate = defaultDueDate(t.dueOffsetDays);
      return next;
    });
    setChecklist(
      (t.subtasks ?? []).map((st) => ({
        id: st.id || crypto.randomUUID(),
        text: st.text,
        done: false,
      }))
    );
  }

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  async function save() {
    if (!form.title.trim()) {
      setErr("Title is required.");
      return;
    }
    if (form.type === "custom" && !form.customType.trim()) {
      setErr("Enter a name for the custom task type.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      // Other-activity titles carry their kind ("Bank work: …") — that is how
      // the Other activity list tells them apart.
      const cleanTitle = form.title.trim();
      const title =
        activity && !cleanTitle.toLowerCase().startsWith(activity.label.toLowerCase())
          ? `${activity.label}: ${cleanTitle}`.slice(0, 300)
          : cleanTitle;
      const payload: any = {
        title,
        activityKind: activity ? activity.key : undefined,
        description: form.description || undefined,
        type: form.type === "custom" ? form.customType.trim() : form.type,
        priority: form.priority,
        dueAt: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
        department: form.department || undefined,
        assigneeId: form.assigneeId || undefined,
        remarks: form.remarks || undefined,
        requiresApproval: form.requiresApproval || undefined,
        contentKind: activity ? undefined : form.contentKind || undefined,
        eventKey: !activity && form.contentKind && form.eventKey ? form.eventKey : undefined,
        eventLabel: !activity && form.contentKind && form.eventLabel ? form.eventLabel : undefined,
        estimateMinutes: form.estimateMinutes ? Math.max(0, parseInt(form.estimateMinutes, 10) || 0) : undefined,
        tags: form.tags.length ? form.tags : undefined,
      };
      // Reminder — computed relative to the due date.
      if (form.reminder !== "none" && form.dueDate) {
        const offsetMin: Record<string, number> = { at_due: 0, "1h": 60, "3h": 180, "1d": 1440, "2d": 2880, "1w": 10080 };
        const base = new Date(form.dueDate).getTime();
        payload.remindAt = new Date(base - (offsetMin[form.reminder] ?? 0) * 60000).toISOString();
      }
      const cleanChecklist = checklist
        .map((c) => ({ id: c.id.slice(0, 64), text: c.text.trim(), done: false }))
        .filter((c) => c.text.length > 0);
      if (cleanChecklist.length > 0) payload.checklist = cleanChecklist;
      if (form.recurrence) {
        payload.recurrence = form.recurrence;
        if (form.recurrenceUntil) payload.recurrenceUntil = form.recurrenceUntil;
      }
      if (form.relatedInvestorId) payload.relatedInvestorId = form.relatedInvestorId;
      if (form.relatedLeadId) payload.relatedLeadId = form.relatedLeadId;
      if (form.relatedServiceRequestId)
        payload.relatedServiceRequestId = form.relatedServiceRequestId;
      if (form.relatedMeetingId) payload.relatedMeetingId = form.relatedMeetingId;

      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      // Files can only be attached once the task has an id. A failure here must
      // not read as "the task was not created" — it was; say what actually went
      // wrong and leave the user on the form with the files still picked.
      if (attachments.length > 0 && j?.id) {
        try {
          await uploadAttachments(`/api/tasks/${j.id}/attachments`, attachments);
        } catch (e: any) {
          setErr(`Task created, but the files did not upload: ${e?.message ?? "unknown error"}`);
          return;
        }
      }
      router.push(activity ? `/dashboard/tasks?view=other` : `/dashboard/tasks`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <Link
        href="/dashboard/tasks"
        className="text-sm text-muted-foreground hover:underline hover:text-foreground flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to tasks
      </Link>

      <div>
        <h1 className="page-title">
          <ListChecks className="size-6 text-brand-cyan" /> {activity ? `New activity — ${activity.label}` : "New task"}
        </h1>
        {activity && (
          <p className="page-subtitle mt-1">
            Day-to-day work that is not a client task. It is saved under Tasks → Other activity.
          </p>
        )}
      </div>

      {/* Start from a template */}
      {templatesError && (
        <div className="card-surface p-4 text-xs text-rose-700 bg-rose-50 border border-rose-200 flex items-start justify-between gap-3">
          <span>{templatesError} You can still fill the form in by hand.</span>
          <button
            type="button"
            onClick={() => void loadTemplates()}
            className="shrink-0 font-medium underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}
      {!activity && templates.length > 0 && (
        <div className="card-surface p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-4 w-1 rounded-full brand-bar" />
            <h2 className="section-title flex items-center gap-1.5">
              <LayoutTemplate className="size-4 text-brand-cyan" /> Start from a template
            </h2>
          </div>
          <SelectField
            value={templateId}
            onChange={(e) => applyTemplate(e.target.value)}
            className="w-full sm:max-w-sm"
          >
            <option value="">— blank task —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </SelectField>
          <p className="text-[11px] text-muted-foreground">
            Switching template replaces the sub-task list.
          </p>
        </div>
      )}

      {/* Title + description */}
      <div className="card-surface p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full brand-bar" />
          <h2 className="section-title">1. What</h2>
        </div>
        {activity && (
          <label className="block">
            <div className="text-xs font-medium mb-1">Kind of activity</div>
            <SelectField
              value={activityKind}
              onChange={(e) => setActivityKind(e.target.value as ActivityKey)}
              className="w-full sm:max-w-xs"
            >
              {ACTIVITY_KINDS.map((a) => (
                <option key={a.key} value={a.key}>{a.label}</option>
              ))}
            </SelectField>
          </label>
        )}
        <label className="block">
          <div className="text-xs font-medium mb-1">
            Title <span className="text-rose-600">*</span>
          </div>
          <input
            value={form.title}
            onChange={(e) => {
              setTitleTouched(true);
              set("title", e.target.value);
            }}
            // placeholder="Call client to share quarterly review"
            className="input-base"
          />
        </label>
        <label className="block">
          <div className="text-xs font-medium mb-1">Description</div>
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={3}
            // placeholder="What needs to happen — context, supporting links, etc."
            className="input-base"
          />
        </label>
        <label className="block">
          <div className="text-xs font-medium mb-1">Remarks (live notes — appended over time)</div>
          <textarea
            value={form.remarks}
            onChange={(e) => set("remarks", e.target.value)}
            rows={2}
            className="input-base text-xs"
          />
        </label>

        <AttachmentPicker
          files={attachments}
          onChange={setAttachments}
          disabled={busy}
          hint="Drop a brief, artwork or a form here — or use “Add files”. One file or many. They upload once the task is created. Max 25 MB each."
        />
      </div>

      {/* Related entities */}
      <div className="card-surface p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full brand-bar" />
          <h2 className="section-title">2. Related to (any combination)</h2>
        </div>

        <div>
          <div className="text-xs font-medium mb-1">Related client</div>
          <InvestorLookup
            value={form.relatedInvestorId || null}
            displayName={form.relatedInvestorName || null}
            onSelect={(id, name) =>
              setForm((s) => ({ ...s, relatedInvestorId: id, relatedInvestorName: name }))
            }
            onClear={() =>
              setForm((s) => ({ ...s, relatedInvestorId: "", relatedInvestorName: "" }))
            }
            placeholder="Search clients…"
          />
        </div>

        <RelatedSearch
          label="Related lead"
          icon={Sparkles}
          placeholder="Search leads by name…"
          pickedId={form.relatedLeadId}
          pickedLabel={form.relatedLeadName}
          searchFn={async (q) => {
            const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
            const j = await r.json();
            return (j.leads ?? []).map((l: any) => ({
              id: l.id,
              label: l.name,
              sub: `${l.stage ?? "—"} · ${l.source ?? "—"}`,
            }));
          }}
          onPick={(id, label) =>
            setForm((s) => ({ ...s, relatedLeadId: id, relatedLeadName: label }))
          }
          onClear={() => setForm((s) => ({ ...s, relatedLeadId: "", relatedLeadName: "" }))}
        />

        <RelatedSearch
          label="Related service request"
          icon={LifeBuoy}
          placeholder="Search SR by ticket no. or subject…"
          pickedId={form.relatedServiceRequestId}
          pickedLabel={form.relatedServiceRequestLabel}
          searchFn={async (q) => {
            const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
            const j = await r.json();
            return (j.serviceRequests ?? []).map((sr: any) => ({
              id: sr.id,
              label: sr.ticket_no ?? sr.id,
              sub: `${sr.subject ?? "—"} · ${sr.status ?? "—"}`,
            }));
          }}
          onPick={(id, label) =>
            setForm((s) => ({
              ...s,
              relatedServiceRequestId: id,
              relatedServiceRequestLabel: label,
            }))
          }
          onClear={() =>
            setForm((s) => ({
              ...s,
              relatedServiceRequestId: "",
              relatedServiceRequestLabel: "",
            }))
          }
        />

        <MeetingPicker
          pickedId={form.relatedMeetingId}
          pickedLabel={form.relatedMeetingLabel}
          onPick={(id, label) =>
            setForm((s) => ({ ...s, relatedMeetingId: id, relatedMeetingLabel: label }))
          }
          onClear={() =>
            setForm((s) => ({ ...s, relatedMeetingId: "", relatedMeetingLabel: "" }))
          }
        />
      </div>

      {/* Type + dept + priority + due */}
      <div className="card-surface p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full brand-bar" />
          <h2 className="section-title">3. Routing + schedule</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {!activity && (
          <label className="block">
            <div className="text-xs font-medium mb-1">Type</div>
            <SelectField
              value={form.type}
              onChange={(e) => set("type", e.target.value)}
              className="w-full"
            >
              <option value="follow_up">Follow-up</option>
              <option value="review_meeting">Review meeting</option>
              <option value="collect_document">Collect document</option>
              <option value="kyc_renewal">KYC renewal</option>
              <option value="mandate_renewal">Mandate renewal</option>
              <option value="marketing_material">Marketing Material</option>
              <option value="custom">Custom</option>
            </SelectField>
            {form.type === "custom" && (
              <input
                value={form.customType}
                onChange={(e) => set("customType", e.target.value)}
                placeholder="Custom type name (e.g. Portfolio rebalance)"
                autoFocus
                className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15"
              />
            )}
          </label>
          )}
          <label className="block">
            <div className="text-xs font-medium mb-1">Department</div>
            <SelectField
              value={form.department}
              onChange={(e) => set("department", e.target.value)}
              className="w-full"
            >
              <option value="">Select</option>
              {DEPARTMENTS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </SelectField>
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Priority</div>
            <SelectField
              value={form.priority}
              onChange={(e) => set("priority", e.target.value)}
              className="w-full"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </SelectField>
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Due date</div>
            <DateField
              value={form.dueDate}
              onChange={(e) => set("dueDate", e.target.value)}
              className="w-full"
            />
          </label>
          <label className="block sm:col-span-2">
            <div className="text-xs font-medium mb-1">
              Assign to
              <span className="ml-1 text-[10px] text-muted-foreground font-normal">
                {canAssignOthers === false
                  ? "· you can only assign tasks to yourself"
                  : form.department
                    ? "· defaults to you"
                    : "· pick a department to assign someone else"}
              </span>
            </div>
            {/* Follows the Department chosen above: pick one and only that
                department's people are offered. With no department chosen the
                only option is yourself — offering a roster there would answer
                a question the Department field hasn't been asked yet. */}
            <RmSelector
              department={form.department || null}
              requireDepartment
              selfOnly={canAssignOthers === false}
              emptyHint={
                canAssignOthers === false
                  ? "Assigning work to someone else needs the “Assign tasks to other people” permission — an owner can switch it back on for you on your employee record."
                  : undefined
              }
              value={form.assigneeId || null}
              onChange={(id) => set("assigneeId", id ?? "")}
              placeholder="Assign to myself"
            />
          </label>
        </div>

        {/* Recurrence (Sanchay "Enable Recurring" parity) */}
        <div className="rounded-lg border border-border bg-secondary/30 p-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!!form.recurrence}
              onChange={(e) => set("recurrence", e.target.checked ? "monthly" : "")}
              className="size-3.5 rounded"
            />
            <span className="text-xs font-medium">Repeat this task (recurring)</span>
          </label>
          {form.recurrence && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <label className="block">
                <div className="text-xs font-medium mb-1">Frequency</div>
                <SelectField
                  value={form.recurrence}
                  onChange={(e) => set("recurrence", e.target.value)}
                  className="w-full"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </SelectField>
              </label>
              <label className="block">
                <div className="text-xs font-medium mb-1">Repeat until (optional)</div>
                <DateField
                  value={form.recurrenceUntil}
                  onChange={(e) => set("recurrenceUntil", e.target.value)}
                  className="w-full"
                />
              </label>
              <p className="sm:col-span-2 text-[11px] text-muted-foreground">
                When you complete this task, the next occurrence is created automatically with its due
                date advanced — perfect for monthly SIP reviews, quarterly client reviews, or annual KYC/FATCA renewals.
              </p>
            </div>
          )}
        </div>

        {/* Marketing content request: post / reel / carousel, optionally for an event.
            Goes to the marketing person; their upload is signed off by the content approver. */}
        {!activity && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">Marketing content</div>
            <SelectField
              value={form.contentKind}
              onChange={(e) => {
                const v = e.target.value;
                setForm((s) => ({ ...s, contentKind: v, department: v ? "marketing" : s.department, assigneeId: v ? "" : s.assigneeId }));
              }}
              className="w-full"
            >
              <option value="">Not a content request</option>
              <option value="post">Post</option>
              <option value="reel">Reel</option>
              <option value="carousel">Carousel</option>
              <option value="other">Other creative</option>
            </SelectField>
          </label>
          {form.contentKind ? (
            <label className="block">
              <div className="text-xs font-medium mb-1">For event <span className="text-[10px] text-muted-foreground font-normal">· optional</span></div>
              {events.length > 0 ? (
                <SelectField
                  value={form.eventKey}
                  onChange={(e) => {
                    const ev = events.find((x) => x.key === e.target.value);
                    setForm((s) => ({ ...s, eventKey: ev?.key ?? "", eventLabel: ev?.label ?? "" }));
                  }}
                  className="w-full"
                >
                  <option value="">No event</option>
                  {events.map((ev) => (
                    <option key={ev.key} value={ev.key}>{ev.label}</option>
                  ))}
                </SelectField>
              ) : (
                <input
                  value={form.eventLabel}
                  onChange={(e) => setForm((s) => ({ ...s, eventLabel: e.target.value, eventKey: e.target.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 120) }))}
                  placeholder="Event name"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              )}
            </label>
          ) : null}
          {form.contentKind ? (
            <p className="sm:col-span-2 text-[11px] text-muted-foreground">
              Assign it to the marketing person. They upload the creative and submit it; it then waits for approval from Bhargavi Patnaik, and the marketing person is told once it is approved.
            </p>
          ) : null}
        </div>
        )}

        {/* Reminder + approval */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs font-medium mb-1 flex items-center gap-1">
              <Bell className="size-3.5 text-brand-cyan" /> Reminder <span className="text-[10px] text-muted-foreground font-normal">· pings the assignee</span>
            </div>
            <SelectField
              value={form.reminder}
              onChange={(e) => set("reminder", e.target.value)}
              className="w-full"
              disabled={!form.dueDate}
            >
              <option value="none">No reminder</option>
              <option value="at_due">At due time</option>
              <option value="1h">1 hour before due</option>
              <option value="3h">3 hours before due</option>
              <option value="1d">1 day before due</option>
              <option value="2d">2 days before due</option>
              <option value="1w">1 week before due</option>
            </SelectField>
          </label>
          <label className="flex items-start gap-2 sm:pt-6 cursor-pointer">
            <input
              type="checkbox"
              checked={form.requiresApproval}
              onChange={(e) => set("requiresApproval", e.target.checked)}
              className="size-3.5 rounded mt-0.5"
            />
            <span className="text-xs">
              <span className="font-medium flex items-center gap-1"><ShieldCheck className="size-3.5 text-brand-cyan" /> Require my approval</span>
              <span className="block text-[10px] text-muted-foreground mt-0.5">
                The assignee submits for sign-off instead of completing it directly.
              </span>
            </span>
          </label>

          <label className="block">
            <div className="text-xs font-medium mb-1 flex items-center gap-1">
              <Timer className="size-3.5 text-brand-cyan" /> Estimate <span className="text-[10px] text-muted-foreground font-normal">· minutes</span>
            </div>
            <input
              type="number"
              min={0}
              value={form.estimateMinutes}
              onChange={(e) => set("estimateMinutes", e.target.value)}
              placeholder="e.g. 30"
              className="input-base"
            />
          </label>

          <div className="block">
            <div className="text-xs font-medium mb-1 flex items-center gap-1">
              <TagIcon className="size-3.5 text-brand-cyan" /> Tags
            </div>
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5 min-h-[38px]">
              {form.tags.map((tg) => (
                <span key={tg} className="chip text-[10px] bg-slate-100 text-slate-600 border border-slate-200 inline-flex items-center gap-1">
                  {tg}
                  <button type="button" onClick={() => set("tags", form.tags.filter((x) => x !== tg))} className="hover:text-rose-600" aria-label={`Remove ${tg}`}>
                    <X className="size-2.5" />
                  </button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagInput); } }}
                onBlur={() => tagInput.trim() && addTag(tagInput)}
                placeholder="Add tag…"
                className="flex-1 min-w-[80px] bg-transparent text-xs focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Sub-tasks (checklist — stored in meta.checklist, editable in the task drawer) */}
        {checklist.length > 0 || templateId ? (
          <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <ListChecks className="size-3.5 text-brand-cyan" />
              <span className="text-xs font-medium">Sub-tasks</span>
              <span className="inline-flex items-center rounded-full bg-brand-cyan-light/60 text-brand-cyan-deep text-[10px] font-medium px-2 py-0.5">
                {checklist.length} sub-task{checklist.length === 1 ? "" : "s"}
              </span>
            </div>
            {checklist.map((c, i) => (
              <div key={c.id} className="flex items-center gap-2">
                <input
                  value={c.text}
                  onChange={(e) =>
                    setChecklist((list) =>
                      list.map((x, j) => (j === i ? { ...x, text: e.target.value } : x))
                    )
                  }
                  placeholder="Sub-task…"
                  className="input-base flex-1"
                />
                <button
                  type="button"
                  onClick={() => setChecklist((list) => list.filter((_, j) => j !== i))}
                  className="btn-icon"
                  title="Remove sub-task"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setChecklist((list) => [
                  ...list,
                  { id: crypto.randomUUID(), text: "", done: false },
                ])
              }
              className="btn-secondary text-xs"
            >
              <Plus className="size-3.5" /> Add sub-task
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() =>
              setChecklist([{ id: crypto.randomUUID(), text: "", done: false }])
            }
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <Plus className="size-3.5" /> Add sub-tasks
          </button>
        )}

        {err && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-sm px-3 py-2">
            {err}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-border">
          <Link href="/dashboard/tasks" className="btn-secondary">
            Cancel
          </Link>
          <button
            type="button"
            onClick={save}
            disabled={busy || !form.title}
            className="btn-primary"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {busy ? "Saving…" : "Create task"}
          </button>
        </div>
      </div>
    </div>
  );
}

function defaultDueDate(daysOut: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysOut);
  return d.toISOString().slice(0, 10);
}

/* ─────────────── Generic search-then-pick row ─────────────── */

function RelatedSearch({
  label,
  icon: Icon,
  placeholder,
  pickedId,
  pickedLabel,
  searchFn,
  onPick,
  onClear,
}: {
  label: string;
  icon: any;
  placeholder: string;
  pickedId: string;
  pickedLabel: string;
  searchFn: (q: string) => Promise<Array<{ id: string; label: string; sub?: string }>>;
  onPick: (id: string, label: string) => void;
  onClear: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ id: string; label: string; sub?: string }>>([]);

  useEffect(() => {
    if (pickedId || q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => setResults(await searchFn(q)), 220);
    return () => clearTimeout(t);
  }, [q, pickedId, searchFn]);

  if (pickedId) {
    return (
      <div>
        <div className="text-xs font-medium mb-1">{label}</div>
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 rounded-lg border border-brand-cyan/40 bg-brand-cyan-light/40 px-3 py-2">
            <Icon className="size-3.5 text-brand-cyan-deep flex-shrink-0" />
            <span className="font-medium text-sm truncate">{pickedLabel}</span>
          </div>
          <button type="button" onClick={onClear} className="btn-icon" title="Clear">
            <X className="size-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-xs font-medium mb-1">{label}</div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          className="input-base pl-9"
        />
        {results.length > 0 && (
          <div className="absolute left-0 right-0 mt-1 z-30 card-elevated max-h-56 overflow-y-auto scrollbar-thin">
            <ul className="py-1">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(r.id, r.label);
                      setQ("");
                      setResults([]);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-brand-cyan-light/40"
                  >
                    <div className="font-semibold text-sm truncate">{r.label}</div>
                    {r.sub && (
                      <div className="text-[10px] text-muted-foreground truncate">{r.sub}</div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────── Meeting picker (loads recent meetings) ─────────────── */

function MeetingPicker({
  pickedId,
  pickedLabel,
  onPick,
  onClear,
}: {
  pickedId: string;
  pickedLabel: string;
  onPick: (id: string, label: string) => void;
  onClear: () => void;
}) {
  const [meetings, setMeetings] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/review-meetings");
        const j = await r.json();
        setMeetings(j.meetings ?? []);
      } catch {
        setMeetings([]);
      }
    })();
  }, []);

  if (pickedId) {
    return (
      <div>
        <div className="text-xs font-medium mb-1">Related meeting</div>
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 rounded-lg border border-brand-cyan/40 bg-brand-cyan-light/40 px-3 py-2">
            <Calendar className="size-3.5 text-brand-cyan-deep flex-shrink-0" />
            <span className="font-medium text-sm truncate">{pickedLabel}</span>
          </div>
          <button type="button" onClick={onClear} className="btn-icon" title="Clear">
            <X className="size-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <label className="block">
      <div className="text-xs font-medium mb-1">Related meeting</div>
      <SelectField
        value=""
        placeholder="Pick a recent meeting (optional)"
        onChange={(e) => {
          const id = e.target.value;
          if (!id) return;
          const m = meetings.find((x) => x.id === id);
          if (!m) return;
          const date = new Date(m.meeting_date).toLocaleString("en-IN", {
            day: "numeric",
            month: "short",
          });
          onPick(
            id,
            `${date} · ${m.investor_name ?? "—"} · ${String(m.category ?? "review").replace(
              /_/g,
              " "
            )}`
          );
        }}
        className="w-full"
      >
        <option value="">Pick a recent meeting (optional)</option>
        {meetings.slice(0, 50).map((m) => {
          const date = new Date(m.meeting_date).toLocaleString("en-IN", {
            day: "numeric",
            month: "short",
          });
          return (
            <option key={m.id} value={m.id}>
              {date} — {m.investor_name ?? "—"}
              {m.category ? ` · ${String(m.category).replace(/_/g, " ")}` : ""}
            </option>
          );
        })}
      </SelectField>
    </label>
  );
}
