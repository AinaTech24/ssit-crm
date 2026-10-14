"use client";

import { useState, useEffect } from "react";
import { X, Calendar, User, Sparkles, LifeBuoy, AlertCircle, Trash, Plus, CheckCircle2, ListChecks, Loader2, ShieldCheck, Clock3, Bell, Send, RotateCcw } from "lucide-react";
import { RmSelector } from "@/components/common/RmSelector";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { taskChecklist, subTaskStatus, type Task, type TaskChecklistItem, type SubTaskStatus } from "@/db/schema";
import Link from "next/link";
import { RecordProvenance } from "@/components/common/RecordProvenance";
import { TaskComments } from "./TaskComments";
import { TaskTimePanel } from "./TaskTimePanel";
import { TaskAttachments } from "./TaskAttachments";
import { TaskWatchersDeps } from "./TaskWatchersDeps";

interface TaskDetailDrawerProps {
  task: Task & {
    assigneeName?: string | null;
    investorName?: string | null;
    leadName?: string | null;
  };
  currentUserId: string;
  /** True for owners / task.view.all — they can approve anyone's tasks. */
  canManageAll?: boolean;
  onClose: () => void;
  onUpdate: () => void;
}

/** ISO → value for a <input type="datetime-local"> (local time, minute precision). */
function toLocalInput(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const REMINDER_OFFSETS_MIN: Record<string, number> = { at_due: 0, "1h": 60, "3h": 180, "1d": 1440, "2d": 2880, "1w": 10080 };

const DEPARTMENTS: [string, string][] = [
  ["sales", "Sales"],
  ["operations", "Operations"],
  ["back_office", "Back Office"],
  ["compliance", "Compliance"],
  ["marketing", "Marketing"],
  ["advisory", "Advisory"],
  ["support", "Support"],
  ["leadership", "Leadership"],
  ["other", "Other"],
];

export function TaskDetailDrawer({ task, currentUserId, canManageAll = false, onClose, onUpdate }: TaskDetailDrawerProps) {
  const toast = useToast();
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  // Approval / verification loop state.
  const [requiresApproval, setRequiresApproval] = useState(!!task.requiresApproval);
  const [approvalStatus, setApprovalStatus] = useState(task.approvalStatus ?? null);
  const [approvalNoteShown, setApprovalNoteShown] = useState(task.approvalNote ?? "");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [approvalBusy, setApprovalBusy] = useState(false);
  const isAssignee = task.assigneeId === currentUserId;
  const taskMeta = ((task as any).meta ?? {}) as { contentKind?: string; eventLabel?: string; approverId?: string; uploadedAt?: string };
  // Marketing-department tasks always carry the content sign-off flow.
  const isMarketing = (task as any).department === "marketing";
  const [uploaded, setUploaded] = useState(!!taskMeta.uploadedAt);
  // A named approver (marketing content) signs off, not the creator.
  // Marketing content is signed off by the named approver only; the marketing
  // person who made it never sees Approve / Reject (the marketing role holds
  // "manage all", so that flag must not grant it here).
  const isApprover = (task as any).department === "marketing"
    ? taskMeta.approverId
      ? taskMeta.approverId === currentUserId
      : task.createdById === currentUserId && task.assigneeId !== currentUserId
    : taskMeta.approverId
      ? taskMeta.approverId === currentUserId || !!canManageAll
      : task.createdById === currentUserId || !!canManageAll;

  // Per-task reminder state. Default to "custom" (pre-filled) when one is set so
  // saving preserves it; otherwise "none".
  const [reminderMode, setReminderMode] = useState<string>(task.remindAt ? "custom" : "none");
  const [reminderCustom, setReminderCustom] = useState<string>(toLocalInput(task.remindAt));
  // Only push remindAt to the server when the user actually touched the control
  // (so editing the title doesn't needlessly re-arm an already-fired reminder).
  const [reminderDirty, setReminderDirty] = useState(false);

  // Tags.
  const [tags, setTags] = useState<string[]>(Array.isArray(task.tags) ? (task.tags as string[]) : []);
  const [tagInput, setTagInput] = useState("");
  function addTag(raw: string) {
    const v = raw.trim().replace(/,$/, "").slice(0, 40);
    if (v && !tags.includes(v)) setTags((t) => [...t, v]);
    setTagInput("");
  }
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState(task.status);
  const [priority, setPriority] = useState(task.priority);
  const [department, setDepartment] = useState(task.department ?? "");
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? "");
  const [dueDate, setDueDate] = useState(() => {
    if (!task.dueAt) return "";
    return new Date(task.dueAt).toISOString().split("T")[0];
  });
  const [slaDate, setSlaDate] = useState(() => {
    if (!task.slaDueAt) return "";
    return new Date(task.slaDueAt).toISOString().split("T")[0];
  });

  // Appending remarks log
  const [remarksHistory, setRemarksHistory] = useState(task.remarks ?? "");
  const [newRemark, setNewRemark] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Action points (checklist) — auto-saved on every change, independent of the
  // main "Save Changes" button so ticking a step persists instantly.
  const [checklist, setChecklist] = useState<TaskChecklistItem[]>(() => taskChecklist(task.meta));
  const [newPoint, setNewPoint] = useState("");
  const [checklistBusy, setChecklistBusy] = useState(false);
  const doneCount = checklist.filter((c) => subTaskStatus(c) === "completed").length;
  const allDone = checklist.length > 0 && doneCount === checklist.length;

  async function persistChecklist(next: TaskChecklistItem[]) {
    const prev = checklist;
    setChecklist(next); // optimistic
    setChecklistBusy(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checklist: next }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? "Failed to save action points");
      }
      onUpdate();
    } catch (e: any) {
      setChecklist(prev); // revert
      toast.error(e?.message ?? "Couldn't save action points", "Save failed");
    } finally {
      setChecklistBusy(false);
    }
  }
  function addPoint() {
    const text = newPoint.trim();
    if (!text) return;
    const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.round(performance.now())}`;
    setNewPoint("");
    persistChecklist([...checklist, { id, text, done: false, status: "not_started" }]);
  }
  // Click the status dot to advance the sub-task through the DST states.
  const SUB_STATUSES: SubTaskStatus[] = ["not_started", "in_progress", "completed", "assigned_to_other"];
  function cycleStatus(id: string) {
    persistChecklist(
      checklist.map((c) => {
        if (c.id !== id) return c;
        const next = SUB_STATUSES[(SUB_STATUSES.indexOf(subTaskStatus(c)) + 1) % SUB_STATUSES.length];
        return { ...c, status: next, done: next === "completed", doneAt: next === "completed" ? new Date().toISOString() : null };
      })
    );
  }
  /** Local-only update (for typing a remark) — no network round-trip per keystroke. */
  function updateLocal(id: string, patch: Partial<TaskChecklistItem>) {
    setChecklist((cl) => cl.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  function setPointField(id: string, patch: Partial<TaskChecklistItem>) {
    persistChecklist(checklist.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  function removePoint(id: string) {
    persistChecklist(checklist.filter((c) => c.id !== id));
  }
  async function quickReschedule(days: number) {
    const base = dueDate ? new Date(dueDate) : new Date();
    base.setDate(base.getDate() + days);
    const iso = base.toISOString().split("T")[0];
    setDueDate(iso); // optimistic
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueAt: new Date(iso).toISOString() }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success(`Rescheduled to ${new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`);
      onUpdate();
    } catch {
      toast.error("Couldn't reschedule", "Update failed");
    }
  }
  async function completeTaskNow() {
    setStatus("completed" as any);
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Task marked complete");
      onUpdate();
    } catch {
      toast.error("Couldn't complete the task", "Update failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? "");
    setStatus(task.status);
    setPriority(task.priority);
    setDepartment(task.department ?? "");
    setAssigneeId(task.assigneeId ?? "");
    setDueDate(task.dueAt ? new Date(task.dueAt).toISOString().split("T")[0] : "");
    setSlaDate(task.slaDueAt ? new Date(task.slaDueAt).toISOString().split("T")[0] : "");
    setRemarksHistory(task.remarks ?? "");
    setChecklist(taskChecklist(task.meta));
    setRequiresApproval(!!task.requiresApproval);
    setApprovalStatus(task.approvalStatus ?? null);
    setApprovalNoteShown(task.approvalNote ?? "");
    setRejectOpen(false);
    setRejectNote("");
    setReminderMode(task.remindAt ? "custom" : "none");
    setReminderCustom(toLocalInput(task.remindAt));
    setReminderDirty(false);
    setTags(Array.isArray(task.tags) ? (task.tags as string[]) : []);
    setTagInput("");
    // Re-initialise ONLY when switching to a different task — keyed on task.id,
    // not the whole object. A checklist add saves then triggers router.refresh,
    // which hands us a new (same-id) task object; depending on [task] here would
    // re-run this effect and overwrite the just-added point with the parent's
    // stale copy (the "action point disappears" bug). Same for in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  async function handleSave() {
    setLoading(true);
    setErr(null);
    try {
      // Append new remark to top if provided
      let finalRemarks = remarksHistory;
      if (newRemark.trim()) {
        const timestamp = new Date().toLocaleString("en-IN", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
        const entry = `[${timestamp}] ${newRemark.trim()}`;
        finalRemarks = remarksHistory ? `${entry}\n\n${remarksHistory}` : entry;
      }

      const payload: Record<string, unknown> = {
        title,
        description: description || undefined,
        status,
        priority,
        department: department || undefined,
        assigneeId: assigneeId || undefined,
        dueAt: dueDate ? new Date(dueDate).toISOString() : undefined,
        slaDueAt: slaDate ? new Date(slaDate).toISOString() : null,
        remarks: finalRemarks || undefined,
      };
      // Only send the reminder when the user changed it (avoids re-arming).
      if (reminderDirty) payload.remindAt = computeRemindAt();
      payload.tags = tags;

      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? `Failed to save task changes`);
      }
      setNewRemark("");
      if (data?.remarks) {
        setRemarksHistory(data.remarks);
      }
      toast.success("Task changes saved");
      onUpdate();
    } catch (error: any) {
      const msg = error?.message ?? "An unexpected error occurred";
      setErr(msg);
      toast.error(msg, "Couldn't save task");
    } finally {
      setLoading(false);
    }
  }

  function computeRemindAt(): string | null {
    if (reminderMode === "none") return null;
    if (reminderMode === "custom") return reminderCustom ? new Date(reminderCustom).toISOString() : null;
    if (!task.dueAt) return null;
    const off = REMINDER_OFFSETS_MIN[reminderMode] ?? 0;
    return new Date(new Date(task.dueAt).getTime() - off * 60000).toISOString();
  }

  async function runApproval(action: "submit" | "approve" | "reject") {
    setApprovalBusy(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalAction: action,
          ...(action === "reject" ? { approvalNote: rejectNote.trim() || undefined } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Action failed");
      if (action === "submit") {
        setApprovalStatus("pending");
        toast.success("Submitted for approval");
      } else if (action === "approve") {
        setApprovalStatus("approved");
        setStatus((isMarketing ? "in_progress" : "completed") as any);
        toast.success(isMarketing ? "Approved — the marketing team has been notified" : "Approved & marked complete");
      } else {
        setApprovalStatus("rejected");
        setApprovalNoteShown(rejectNote.trim());
        setStatus("in_progress" as any);
        setRejectOpen(false);
        toast.success(isMarketing ? "Rejected — sent back to the marketing team" : "Task reopened for changes");
      }
      onUpdate();
    } catch (e: any) {
      toast.error(e?.message ?? "Action failed");
    } finally {
      setApprovalBusy(false);
    }
  }

  async function markUploaded() {
    setApprovalBusy(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markUploaded: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Couldn't mark as uploaded");
      setUploaded(true);
      setStatus("completed" as any);
      toast.success("Marked as uploaded");
      onUpdate();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't mark as uploaded");
    } finally {
      setApprovalBusy(false);
    }
  }

  async function toggleRequiresApproval(v: boolean) {
    setRequiresApproval(v); // optimistic
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requiresApproval: v }),
      });
      if (!res.ok) throw new Error();
      onUpdate();
    } catch {
      setRequiresApproval(!v);
      toast.error("Couldn't update the approval setting");
    }
  }

  async function doCancelTask() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `Failed to cancel task`);
      }
      setConfirmCancelOpen(false);
      toast.success("Task cancelled");
      onClose();
      onUpdate();
    } catch (error: any) {
      const msg = error?.message ?? "Failed to cancel task";
      setErr(msg);
      toast.error(msg, "Couldn't cancel task");
      setLoading(false);
    }
  }

  return (
    <>
      {/* Backdrop overlay — clicking outside closes the modal. */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-[1px] z-40 transition-opacity flex items-start sm:items-center justify-center p-0 sm:p-6"
        onClick={onClose}
      >
        {/* Centered modal */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="relative w-full h-full sm:h-auto sm:max-h-[88vh] sm:w-[560px] sm:max-w-[calc(100vw-2rem)] bg-white text-slate-800 sm:rounded-xl border border-border shadow-2xl z-50 flex flex-col overflow-hidden animate-modal-in"
        >

        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-slate-50">
          <div>
            <h3 className="font-bold text-sm text-slate-800 uppercase tracking-wider">
              Task Details
            </h3>
            <span className="text-[10px] text-muted-foreground font-mono">ID: {task.id.slice(0, 8)}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 scrollbar-thin">
          {err && (
            <div className="p-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-1.5">
              <AlertCircle className="size-4 flex-shrink-0" />
              <span>{err}</span>
            </div>
          )}

          <RecordProvenance
            entityType="task"
            entityId={task.id}
            createdAt={task.createdAt}
            updatedAt={task.updatedAt}
          />

          {/* Title and Description */}
          <div className="space-y-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
              className="text-lg font-bold bg-transparent border-none focus:outline-none w-full border-b focus:border-slate-300 py-0.5"
            />
            
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="No description provided. Click to add details..."
                className="input-base text-xs py-2 bg-slate-50 border-slate-200 focus:bg-white transition-colors"
              />
            </div>
          </div>

          <hr className="border-slate-100" />

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Status</label>
              <SelectField
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                size="sm"
                className="w-full"
              >
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="blocked">Blocked</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </SelectField>
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Priority</label>
              <SelectField
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
                size="sm"
                className="w-full"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </SelectField>
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Due Date</label>
              <DateField
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                size="sm"
                className="w-full"
              />
              <div className="mt-1 flex items-center gap-1">
                <span className="text-[9px] uppercase text-slate-400 font-semibold">Snooze</span>
                {[["+1d", 1], ["+1w", 7], ["+1m", 30]].map(([label, days]) => (
                  <button
                    key={label as string}
                    type="button"
                    onClick={() => quickReschedule(days as number)}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">SLA Due Date</label>
              <DateField
                value={slaDate}
                onChange={(e) => setSlaDate(e.target.value)}
                size="sm"
                className="w-full"
              />
            </div>

            <div className="col-span-2">
              <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Department</label>
              <SelectField
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                size="sm"
                className="w-full"
              >
                <option value="">Select…</option>
                {DEPARTMENTS.map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </SelectField>
            </div>

            <div className="col-span-2">
              <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 flex items-center gap-1">
                <Bell className="size-3" /> Reminder <span className="normal-case font-medium text-slate-400">— pings the assignee</span>
              </label>
              <SelectField
                value={reminderMode}
                onChange={(e) => { setReminderMode(e.target.value); setReminderDirty(true); }}
                size="sm"
                className="w-full"
              >
                <option value="none">No reminder</option>
                <option value="at_due" disabled={!task.dueAt}>At due time</option>
                <option value="1h" disabled={!task.dueAt}>1 hour before due</option>
                <option value="3h" disabled={!task.dueAt}>3 hours before due</option>
                <option value="1d" disabled={!task.dueAt}>1 day before due</option>
                <option value="2d" disabled={!task.dueAt}>2 days before due</option>
                <option value="1w" disabled={!task.dueAt}>1 week before due</option>
                <option value="custom">Custom date &amp; time…</option>
              </SelectField>
              {reminderMode === "custom" && (
                <input
                  type="datetime-local"
                  value={reminderCustom}
                  onChange={(e) => { setReminderCustom(e.target.value); setReminderDirty(true); }}
                  className="input-base text-xs mt-1.5 w-full"
                />
              )}
              {task.remindAt && !reminderDirty && (
                <p className="text-[10px] text-slate-400 mt-1">
                  Reminds {new Date(task.remindAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  {task.reminderFiredAt ? " · sent" : ""}.
                </p>
              )}
              {reminderDirty && reminderMode !== "none" && (
                <p className="text-[10px] text-slate-400 mt-1">Saved when you click “Save Changes”.</p>
              )}
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Assigned To</label>
            <RmSelector
              role={["back_office", "marketing", "ria", "ra_research", "ra_sales"]}
              value={assigneeId || null}
              onChange={(id) => setAssigneeId(id ?? "")}
              placeholder="Unassigned (defaults to creator)"
            />
          </div>

          <hr className="border-slate-100" />

          {/* Approval / verification loop */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-[10px] uppercase font-bold text-slate-500 flex items-center gap-1.5">
                <ShieldCheck className="size-3.5" /> Approval
              </h4>
              {isApprover && !isMarketing && (
                <label className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={requiresApproval}
                    onChange={(e) => toggleRequiresApproval(e.target.checked)}
                    className="size-3.5 rounded border-slate-300"
                  />
                  Requires sign-off
                </label>
              )}
            </div>

            {taskMeta.contentKind ? (
              <div className="text-[11px] text-slate-600">
                Marketing {taskMeta.contentKind}
                {taskMeta.eventLabel ? <> · for <span className="font-semibold">{taskMeta.eventLabel}</span></> : null}
              </div>
            ) : null}

            {requiresApproval || isMarketing ? (
              <>
                {approvalStatus === "pending" ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-800 flex items-center gap-1.5">
                    <Clock3 className="size-3.5 shrink-0" /> Waiting for approval.
                  </div>
                ) : approvalStatus === "approved" ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-[11px] text-emerald-800 flex items-center gap-1.5">
                    <ShieldCheck className="size-3.5 shrink-0" /> Approved.
                  </div>
                ) : approvalStatus === "rejected" ? (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-[11px] text-rose-800">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <RotateCcw className="size-3.5 shrink-0" /> {isMarketing ? "Rejected — changes needed" : "Reopened for changes"}
                    </div>
                    {approvalNoteShown && <div className="mt-1 text-rose-700">“{approvalNoteShown}”</div>}
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-500">Needs an approver's sign-off before it can be completed.</div>
                )}

                {approvalStatus === "pending" && isApprover ? (
                  rejectOpen ? (
                    <div className="space-y-1.5">
                      <textarea
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                        rows={2}
                        placeholder="Reason for reopening (optional)…"
                        className="input-base text-xs bg-white"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={approvalBusy}
                          onClick={() => runApproval("reject")}
                          className="flex-1 text-xs py-1.5 rounded-md border border-rose-200 bg-rose-50 text-rose-700 font-semibold hover:bg-rose-100"
                        >
                          {isMarketing ? "Confirm reject" : "Confirm reopen"}
                        </button>
                        <button type="button" onClick={() => setRejectOpen(false)} className="text-xs py-1.5 px-3 rounded-md border bg-white">
                          Back
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={approvalBusy}
                        onClick={() => runApproval("approve")}
                        className="flex-1 btn-primary text-xs py-1.5 flex items-center justify-center gap-1.5"
                      >
                        <CheckCircle2 className="size-3.5" /> Approve
                      </button>
                      <button
                        type="button"
                        disabled={approvalBusy}
                        onClick={() => setRejectOpen(true)}
                        className="flex-1 text-xs py-1.5 rounded-md border border-rose-200 text-rose-700 bg-white font-semibold hover:bg-rose-50 flex items-center justify-center gap-1.5"
                      >
                        <RotateCcw className="size-3.5" /> {isMarketing ? "Reject" : "Reopen"}
                      </button>
                    </div>
                  )
                ) : approvalStatus !== "approved" && isAssignee ? (
                  <button
                    type="button"
                    disabled={approvalBusy}
                    onClick={() => runApproval("submit")}
                    className="w-full btn-primary text-xs py-1.5 flex items-center justify-center gap-1.5"
                  >
                    <Send className="size-3.5" /> {isMarketing ? (approvalStatus === "pending" ? "Send for approval again" : "Send for approval") : approvalStatus === "pending" ? "Re-submit for approval" : "Submit for approval"}
                  </button>
                ) : null}

                {isMarketing && approvalStatus === "approved" && !uploaded && (isAssignee || isApprover) ? (
                  <button
                    type="button"
                    disabled={approvalBusy}
                    onClick={markUploaded}
                    className="w-full btn-primary text-xs py-1.5 flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle2 className="size-3.5" /> Mark as uploaded (posted on social media)
                  </button>
                ) : null}
                {isMarketing && uploaded ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-[11px] text-emerald-800 flex items-center gap-1.5">
                    <CheckCircle2 className="size-3.5 shrink-0" /> Uploaded — posted on social media.
                  </div>
                ) : null}
              </>
            ) : (
              isApprover && (
                <p className="text-[11px] text-slate-400">
                  Turn on sign-off to require an approver to verify this task before it's marked complete.
                </p>
              )
            )}
          </div>

          <hr className="border-slate-100" />

          {/* Related Entities Card Links */}
          <div className="space-y-2.5">
            <h4 className="text-[10px] uppercase font-bold text-slate-500">Related Entities</h4>
            
            <div className="grid grid-cols-1 gap-2">
              {task.relatedInvestorId && (
                <Link
                  href={`/dashboard/investors/${task.relatedInvestorId}`}
                  className="flex items-center justify-between p-2.5 border rounded-lg hover:bg-slate-50 border-brand-cyan/20 bg-brand-cyan-light/10 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <User className="size-4 text-brand-cyan-deep flex-shrink-0" />
                    <div className="truncate text-xs font-medium">
                      {task.investorName ?? "Client Profile"}
                    </div>
                  </div>
                  <span className="text-[9px] uppercase font-semibold text-brand-cyan-deep bg-brand-cyan-light/40 px-1.5 py-0.5 rounded">
                    Client
                  </span>
                </Link>
              )}

              {task.relatedLeadId && (
                <Link
                  href={`/dashboard/leads/${task.relatedLeadId}`}
                  className="flex items-center justify-between p-2.5 border rounded-lg hover:bg-slate-50 border-amber-200 bg-amber-50/10 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Sparkles className="size-4 text-amber-600 flex-shrink-0" />
                    <div className="truncate text-xs font-medium">
                      {task.leadName ?? "Lead Details"}
                    </div>
                  </div>
                  <span className="text-[9px] uppercase font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                    Lead
                  </span>
                </Link>
              )}

              {task.relatedServiceRequestId && (
                <div
                  className="flex items-center justify-between p-2.5 border rounded-lg border-blue-100 bg-blue-50/10"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <LifeBuoy className="size-4 text-blue-600 flex-shrink-0" />
                    <div className="truncate text-xs font-medium">
                      Service Ticket
                    </div>
                  </div>
                  <span className="text-[9px] uppercase font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                    Service Req
                  </span>
                </div>
              )}

              {task.relatedMeetingId && (
                <Link
                  href={`/dashboard/review-meetings/${task.relatedMeetingId}`}
                  className="flex items-center justify-between p-2.5 border rounded-lg hover:bg-slate-50 border-emerald-100 bg-emerald-50/10 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Calendar className="size-4 text-emerald-600 flex-shrink-0" />
                    <div className="truncate text-xs font-medium">
                      Review Meeting File
                    </div>
                  </div>
                  <span className="text-[9px] uppercase font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                    Meeting
                  </span>
                </Link>
              )}

              {!task.relatedInvestorId && !task.relatedLeadId && !task.relatedServiceRequestId && !task.relatedMeetingId && (
                <div className="text-xs text-muted-foreground p-3 border border-dashed rounded-lg text-center bg-slate-50">
                  No entities linked to this task.
                </div>
              )}
            </div>
          </div>

          <hr className="border-slate-100" />

          {/* Action points (checklist) — the sub-steps to complete this task. */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-[10px] uppercase font-bold text-slate-500 flex items-center gap-1.5">
                <ListChecks className="size-3.5" /> Sub-tasks
                {checklist.length > 0 && (
                  <span className="text-slate-400 normal-case font-semibold">· {doneCount}/{checklist.length} done</span>
                )}
              </h4>
              {checklistBusy && <Loader2 className="size-3 animate-spin text-brand-cyan" />}
            </div>

            {checklist.length > 0 && (
              <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${Math.round((doneCount / checklist.length) * 100)}%` }}
                />
              </div>
            )}

            <div className="space-y-2">
              {checklist.map((c) => {
                const st = subTaskStatus(c);
                const meta = ({
                  not_started: { label: "Not started", dot: "bg-slate-300", text: "text-slate-500" },
                  in_progress: { label: "In progress", dot: "bg-sky-500", text: "text-sky-700" },
                  completed: { label: "Completed", dot: "bg-emerald-500", text: "text-emerald-700" },
                  assigned_to_other: { label: "Assigned to other", dot: "bg-violet-500", text: "text-violet-700" },
                } as const)[st];
                return (
                  <div key={c.id} className="group rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-2 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => cycleStatus(c.id)}
                        title="Click to advance status"
                        className={`shrink-0 inline-flex items-center gap-1.5 rounded-full bg-white border border-slate-200 px-2 py-0.5 text-[10px] font-semibold ${meta.text}`}
                      >
                        <span className={`size-2 rounded-full ${meta.dot}`} /> {meta.label}
                      </button>
                      <span className={`flex-1 text-xs leading-relaxed ${st === "completed" ? "line-through text-slate-400" : "text-slate-700"}`}>
                        {c.text}
                      </span>
                      <button
                        type="button"
                        onClick={() => removePoint(c.id)}
                        className="shrink-0 text-slate-300 hover:text-rose-600 opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-label="Remove sub-task"
                      >
                        <Trash className="size-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <DateField
                        value={c.actionDate ?? ""}
                        onChange={(e) => setPointField(c.id, { actionDate: e.target.value || null })}
                        size="sm"
                        className="w-[8.5rem]"
                        aria-label="Action date"
                      />
                      <input
                        value={c.remark ?? ""}
                        onChange={(e) => updateLocal(c.id, { remark: e.target.value })}
                        onBlur={(e) => setPointField(c.id, { remark: e.target.value })}
                        placeholder="Remark…"
                        className="input-base h-7 text-[11px] flex-1 bg-white"
                        aria-label="Remark"
                      />
                    </div>
                    {/* Delegate this sub-task to a teammate — they're notified and
                        can open + edit this task. */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase font-bold text-slate-400 shrink-0">Assign</span>
                      <RmSelector
                        role={["back_office", "marketing", "ria", "ra_research", "ra_sales"]}
                        value={c.assigneeId ?? null}
                        onChange={(uid) =>
                          setPointField(c.id, {
                            assigneeId: uid,
                            status: uid
                              ? subTaskStatus(c) === "completed"
                                ? c.status
                                : "assigned_to_other"
                              : subTaskStatus(c) === "assigned_to_other"
                                ? "not_started"
                                : c.status,
                          })
                        }
                        placeholder="Unassigned — assign to a teammate…"
                        className="flex-1"
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2">
              <input
                value={newPoint}
                onChange={(e) => setNewPoint(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPoint(); } }}
                placeholder="Add a sub-task and press Enter…"
                className="input-base text-xs flex-1 bg-white"
              />
              <button
                type="button"
                onClick={addPoint}
                disabled={!newPoint.trim() || checklistBusy}
                className="btn-secondary text-xs px-2.5 disabled:opacity-50"
                aria-label="Add action point"
              >
                <Plus className="size-3.5" />
              </button>
            </div>

            {allDone && status !== "completed" && (
              <button
                type="button"
                onClick={completeTaskNow}
                disabled={loading}
                className="w-full btn-primary text-xs py-1.5 flex items-center justify-center gap-1.5"
              >
                <CheckCircle2 className="size-3.5" /> All points done — mark task complete
              </button>
            )}
          </div>

          <hr className="border-slate-100" />

          {/* Watchers + dependency (blocked by) */}
          <TaskWatchersDeps
            taskId={task.id}
            currentUserId={currentUserId}
            initialBlockedById={task.blockedByTaskId ?? null}
            onChanged={onUpdate}
          />

          <hr className="border-slate-100" />

          {/* Time tracking */}
          <TaskTimePanel
            taskId={task.id}
            initialEstimate={task.estimateMinutes ?? null}
            initialSpent={task.timeSpentMinutes ?? 0}
            initialRunningSince={task.startedAt ?? null}
            onChanged={onUpdate}
          />

          <hr className="border-slate-100" />

          {/* Attachments */}
          <TaskAttachments taskId={task.id} />

          <hr className="border-slate-100" />

          {/* Tags */}
          <div className="space-y-2">
            <h4 className="text-[10px] uppercase font-bold text-slate-500">Tags</h4>
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.map((tg) => (
                <span key={tg} className="chip text-[10px] bg-slate-100 text-slate-600 border border-slate-200 inline-flex items-center gap-1">
                  {tg}
                  <button type="button" onClick={() => setTags((t) => t.filter((x) => x !== tg))} className="hover:text-rose-600" aria-label={`Remove ${tg}`}>
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
                className="input-base h-7 text-[11px] w-24 bg-white"
              />
            </div>
            <p className="text-[10px] text-slate-400">Saved with the task.</p>
          </div>

          <hr className="border-slate-100" />

          {/* Comments — real threaded log with author + @mentions. */}
          <div className="space-y-3">
            <h4 className="text-[10px] uppercase font-bold text-slate-500">Comments</h4>
            <TaskComments taskId={task.id} currentUserId={currentUserId} />

            {/* Legacy prepend-only remarks (pre-comments) — read-only, collapsed. */}
            {remarksHistory && (
              <details className="mt-1">
                <summary className="text-[10px] uppercase font-bold text-slate-400 cursor-pointer">Earlier notes (legacy log)</summary>
                <div className="space-y-3 max-h-48 overflow-y-auto pr-1 scrollbar-thin mt-2">
                  {remarksHistory.split("\n\n").map((chunk, idx) => {
                    const match = chunk.match(/^\[(.*?)\]\s*([\s\S]*)$/);
                    const timestamp = match ? match[1] : null;
                    const content = match ? match[2] : chunk;
                    return (
                      <div key={idx} className="flex gap-2.5 items-start">
                        <div className="w-6 h-6 rounded-full bg-slate-100 border text-[10px] font-bold text-slate-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                          💬
                        </div>
                        <div className="flex-1 min-w-0 bg-slate-50 border border-slate-100 rounded-lg p-2.5">
                          {timestamp && <div className="text-[10px] text-slate-400 font-semibold mb-1">{timestamp}</div>}
                          <div className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{content}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
          </div>
        </div>

        {/* Footer controls */}
        <div className="px-5 py-4 border-t border-border bg-slate-50 flex justify-between gap-3 flex-shrink-0">
          <button
            type="button"
            onClick={() => setConfirmCancelOpen(true)}
            disabled={loading}
            className="px-3 py-1.5 border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-semibold rounded-md flex items-center gap-1 bg-white"
          >
            <Trash className="size-3.5" /> Cancel Task
          </button>
          
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-3 py-1.5 border hover:bg-slate-100 text-xs font-semibold rounded-md bg-white"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={loading}
              className="btn-primary text-xs py-1.5 px-4 font-semibold rounded-md flex items-center gap-1"
            >
              {loading ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancelOpen}
        title="Cancel this task?"
        message="The task will be marked cancelled. This can't be undone from here."
        confirmLabel="Cancel task"
        cancelLabel="Keep task"
        tone="danger"
        busy={loading}
        onConfirm={doCancelTask}
        onCancel={() => setConfirmCancelOpen(false)}
      />

      {/* Modal open animation (fade + subtle scale) */}
      <style jsx global>{`
        @keyframes modal-in {
          from {
            opacity: 0;
            transform: translateY(8px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .animate-modal-in {
          animation: modal-in 0.18s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
    </>
  );
}
