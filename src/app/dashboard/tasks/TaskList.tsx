"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatRelative } from "@/lib/utils";
import { RowActions } from "@/components/common/RowActions";
import { SelectField } from "@/components/ui/SelectField";
import { RmSelector } from "@/components/common/RmSelector";
import { useToast } from "@/components/ui/Toast";
import { TaskDetailDrawer } from "./TaskDetailDrawer";
import { Avatar } from "@/components/ui/Avatar";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { taskChecklist, type Task } from "@/db/schema";
import { Loader2, ListChecks, Trash2, Clock3, ShieldCheck, CalendarClock, Gauge, Check, X, Pencil, ChevronDown } from "lucide-react";

// Priority → left-accent stripe colour (row hierarchy at a glance).
const PRIORITY_ACCENT: Record<string, string> = {
  urgent: "bg-rose-500",
  high: "bg-amber-400",
  normal: "bg-slate-300",
  low: "bg-slate-200",
};
// Priority / status → tinted select text so the inline controls read as pills.
const PRIORITY_TEXT: Record<string, string> = {
  urgent: "text-rose-700",
  high: "text-amber-700",
  normal: "text-slate-600",
  low: "text-slate-400",
};
const STATUS_TEXT: Record<string, string> = {
  open: "text-sky-700",
  in_progress: "text-violet-700",
  blocked: "text-rose-700",
  completed: "text-emerald-700",
  cancelled: "text-slate-400",
};

// Due-date buckets for the "Group by due" view — fixed display order.
const BUCKET_ORDER = ["overdue", "today", "week", "later", "nodate", "done"] as const;
const BUCKET_META: Record<string, { label: string; tone: string }> = {
  overdue: { label: "Overdue", tone: "text-rose-600" },
  today: { label: "Due today", tone: "text-amber-600" },
  week: { label: "This week", tone: "text-slate-700" },
  later: { label: "Later", tone: "text-slate-600" },
  nodate: { label: "No due date", tone: "text-slate-500" },
  done: { label: "Completed & closed", tone: "text-slate-400" },
};
function dueBucketKey(t: { status: string; dueAt: Date | string | null }): string {
  if (t.status === "completed" || t.status === "cancelled") return "done";
  if (!t.dueAt) return "nodate";
  const due = new Date(t.dueAt).getTime();
  const now = Date.now();
  if (due < now) return "overdue";
  if (new Date(t.dueAt).toDateString() === new Date().toDateString()) return "today";
  if (due < now + 7 * 86400000) return "week";
  return "later";
}

interface TaskRow {
  task: Task;
  assignee: string | null;
  /** Creator's name ("assigned by"). */
  createdBy?: string | null;
  investorName: string | null;
  investorAvatarUrl?: string | null;
  leadName: string | null;
  leadAvatarUrl?: string | null;
}

interface TaskListProps {
  initialRows: TaskRow[];
  currentUserId: string;
  canManageAll?: boolean;
  /** ?task=<id> deep-link (e.g. from the Service tracker) — opens the drawer. */
  initialOpenTaskId?: string;
  /** Total tasks matching the current filters (across all pages). */
  total?: number;
  /** Search + filter + sort + view controls, rendered in the table header. */
  toolbar?: ReactNode;
}

export function TaskList({ initialRows, currentUserId, canManageAll = false, initialOpenTaskId, total = 0, toolbar }: TaskListProps) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState(initialRows);
  const [selectedRow, setSelectedRow] = useState<TaskRow | null>(null);

  // Open the drawer for a ?task=<id> deep-link. If the task isn't in the current
  // (filtered) page, fetch it directly so the link still works.
  useEffect(() => {
    if (!initialOpenTaskId) return;
    const inList = initialRows.find((r) => r.task.id === initialOpenTaskId);
    if (inList) { setSelectedRow(inList); return; }
    let cancelled = false;
    fetch(`/api/tasks/${initialOpenTaskId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((task) => {
        if (!cancelled && task && task.id) {
          setSelectedRow({ task, assignee: null, investorName: null, investorAvatarUrl: null, leadName: null, leadAvatarUrl: null });
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenTaskId]);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);

  // Bulk-select states
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [selectMenuOpen, setSelectMenuOpen] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const selectMenuRef = useRef<HTMLDivElement>(null);
  const sp = useSearchParams();

  // Human-readable name for whatever narrowed the list, so an empty result can
  // say WHICH filter found nothing ("No cancelled tasks") instead of a generic
  // "all caught up" that reads like the filter silently failed.
  const activeFilterLabel = (() => {
    const parts: string[] = [];
    const q = sp.get("q");
    if (q) parts.push(`matching “${q}”`);
    for (const [key, prefix] of [
      ["status", ""],
      ["priority", " priority"],
      ["type", ""],
      ["department", ""],
    ] as const) {
      const v = sp.get(key);
      if (!v) continue;
      parts.push(
        v
          .split(",")
          .filter(Boolean)
          .map((s) => s.replace(/_/g, " "))
          .join(" / ") + prefix
      );
    }
    if (sp.get("mine") === "1") parts.push("assigned to me");
    if (sp.get("overdue") === "1") parts.push("overdue");
    return parts.join(" · ");
  })();

  // Sync rows from parent when query changes
  if (JSON.stringify(initialRows.map(r => r.task.id)) !== JSON.stringify(rows.map(r => r.task.id))) {
    setRows(initialRows);
    setSelected(new Set());
  }

  useEffect(() => {
    if (!selectMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (selectMenuRef.current && !selectMenuRef.current.contains(e.target as Node)) setSelectMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [selectMenuOpen]);

  const pageIds = rows.map((r) => r.task.id);
  const allPageSelected = rows.length > 0 && pageIds.every((id) => selected.has(id));
  function toggleSelect(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function selectThisPage() {
    setSelected(new Set(pageIds));
    setSelectMenuOpen(false);
  }
  /** Select every task matching the current filters (across all pages). */
  async function selectAllPages() {
    setSelectMenuOpen(false);
    setSelectingAll(true);
    try {
      const res = await fetch(`/api/tasks/ids?${sp.toString()}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "Failed");
      setSelected(new Set(Array.isArray(j.ids) ? j.ids : []));
      if (j.capped) toast.success(`Selected the first ${j.limit} tasks (the max per bulk action).`);
    } catch {
      toast.error("Couldn't select all tasks");
    } finally {
      setSelectingAll(false);
    }
  }

  async function runBulk(action: "status" | "priority" | "assign" | "cancel" | "delete" | "reschedule", value?: string) {
    if (selected.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/tasks/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], action, value }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Bulk action failed");
      const n = j.updated ?? j.deleted ?? 0;
      toast.success(action === "delete" ? `Deleted ${n} task${n === 1 ? "" : "s"}` : `Updated ${n} task${n === 1 ? "" : "s"}`);
      setSelected(new Set());
      setConfirmBulkDelete(false);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Bulk action failed", "Action failed");
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleToggleComplete(taskId: string, isCompleted: boolean, e: React.MouseEvent) {
    e.stopPropagation(); // prevent opening the drawer
    setCompletingTaskId(taskId);
    
    // Optimistic Update
    const previousRows = [...rows];
    setRows(prev =>
      prev.map(r =>
        r.task.id === taskId
          ? { ...r, task: { ...r.task, status: isCompleted ? "completed" : "open" } }
          : r
      )
    );

    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: isCompleted ? "completed" : "open" }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? "Failed to update status");
      }
      toast.success(isCompleted ? "Task marked complete" : "Task reopened");
      // Allow some animation feedback, then reload to filter out
      setTimeout(() => {
        router.refresh();
      }, 300);
    } catch (err: any) {
      // Revert on error
      setRows(previousRows);
      toast.error(err?.message ?? "Could not update the task", "Update failed");
    } finally {
      setCompletingTaskId(null);
    }
  }

  async function handleStatusChange(taskId: string, newStatus: string) {
    const previousRows = [...rows];
    setRows(prev =>
      prev.map(r =>
        r.task.id === taskId
          ? { ...r, task: { ...r.task, status: newStatus as any } }
          : r
      )
    );
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? "Failed to update status");
      }
      toast.success(`Status set to ${newStatus.replace(/_/g, " ")}`);
      router.refresh();
    } catch (err: any) {
      setRows(previousRows);
      toast.error(err?.message ?? "Could not update the status", "Update failed");
    }
  }

  async function handlePriorityChange(taskId: string, newPriority: string) {
    const previousRows = [...rows];
    setRows(prev =>
      prev.map(r =>
        r.task.id === taskId
          ? { ...r, task: { ...r.task, priority: newPriority as any } }
          : r
      )
    );
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: newPriority }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? "Failed to update priority");
      }
      toast.success(`Priority set to ${newPriority}`);
      router.refresh();
    } catch (err: any) {
      setRows(previousRows);
      toast.error(err?.message ?? "Could not update the priority", "Update failed");
    }
  }

  const handleUpdate = () => {
    router.refresh();
  };

  return (
    <div className="border rounded-lg bg-card bg-white overflow-hidden shadow-sm flex flex-col">
      {/* Bulk action bar — appears when rows are selected. */}
      {selected.size > 0 && (
        <div className="px-3 py-2 border-b bg-brand-cyan-light/20 flex items-center gap-2 flex-wrap text-xs">
          <span className="font-semibold text-slate-700">{selected.size} selected</span>
          <button onClick={() => runBulk("status", "completed")} disabled={bulkBusy} className="btn-secondary text-xs py-1 px-2.5">Complete</button>
          <div onClick={(e) => e.stopPropagation()}>
            <SelectField value="" onChange={(e) => e.target.value && runBulk("priority", e.target.value)} size="sm" className="w-32">
              <option value="">Set priority…</option>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </SelectField>
          </div>
          <div className="w-44">
            <RmSelector role="back_office" value={null} onChange={(id) => id && runBulk("assign", id)} placeholder="Reassign to…" />
          </div>
          {/* Bulk reschedule — clear an overdue backlog fast. */}
          <div className="inline-flex items-center gap-1">
            <span className="text-slate-500">Due:</span>
            <button
              onClick={() => { const d = new Date(); d.setHours(18, 0, 0, 0); runBulk("reschedule", d.toISOString()); }}
              disabled={bulkBusy}
              className="btn-ghost text-xs py-1 px-2"
            >
              Today
            </button>
            <button
              onClick={() => { const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(18, 0, 0, 0); runBulk("reschedule", d.toISOString()); }}
              disabled={bulkBusy}
              className="btn-ghost text-xs py-1 px-2"
            >
              +1w
            </button>
            <input
              type="date"
              onChange={(e) => { if (e.target.value) { const d = new Date(e.target.value); d.setHours(18, 0, 0, 0); runBulk("reschedule", d.toISOString()); } }}
              className="input-base h-7 text-xs w-[130px]"
              aria-label="Reschedule to date"
            />
          </div>
          <button onClick={() => runBulk("cancel")} disabled={bulkBusy} className="btn-ghost text-xs py-1 px-2 text-rose-600">Cancel tasks</button>
          <button onClick={() => setConfirmBulkDelete(true)} disabled={bulkBusy} className="text-xs py-1 px-2.5 rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 inline-flex items-center gap-1 font-medium">
            <Trash2 className="size-3.5" /> Delete
          </button>
          {bulkBusy && <Loader2 className="size-3.5 animate-spin text-brand-cyan" />}
          <button onClick={() => setSelected(new Set())} className="ml-auto text-muted-foreground hover:underline">Clear</button>
        </div>
      )}

      {/* The header always renders — including when the list is empty — so the
          search / filter / sort / view controls stay reachable. */}
      <div className="group/list">
        {/* Table header — select control (hover-reveal) + search/filter/sort/view toolbar. */}
        <div className="px-3 sm:px-4 py-2 border-b bg-white flex items-center gap-3">
          <div className={`flex items-center gap-2 shrink-0 transition-opacity ${selected.size > 0 ? "opacity-100" : "opacity-0 group-hover/list:opacity-100 focus-within:opacity-100"}`}>
            <input
              type="checkbox"
              checked={allPageSelected}
              onChange={() => (allPageSelected ? setSelected(new Set()) : selectThisPage())}
              className="size-3.5 rounded border-slate-300"
              aria-label="Select tasks on this page"
            />
            <div className="relative" ref={selectMenuRef}>
              <button
                type="button"
                onClick={() => setSelectMenuOpen((o) => !o)}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {selectingAll ? <Loader2 className="size-3 animate-spin" /> : null}
                Select <ChevronDown className="size-3 opacity-60" />
              </button>
              {selectMenuOpen && (
                <div className="absolute left-0 top-full mt-1 z-20 w-56 rounded-md border bg-popover shadow-md py-1 text-xs">
                  <button type="button" onClick={selectThisPage} className="w-full text-left px-3 py-1.5 hover:bg-accent">
                    This page <span className="text-muted-foreground">({rows.length})</span>
                  </button>
                  <button type="button" onClick={selectAllPages} className="w-full text-left px-3 py-1.5 hover:bg-accent">
                    All tasks <span className="text-muted-foreground">({total.toLocaleString("en-IN")})</span>
                  </button>
                  {selected.size > 0 && (
                    <button type="button" onClick={() => { setSelected(new Set()); setSelectMenuOpen(false); }} className="w-full text-left px-3 py-1.5 hover:bg-accent text-rose-600">
                      Clear selection
                    </button>
                  )}
                </div>
              )}
            </div>
            {selected.size > 0 && <span className="text-[11px] text-muted-foreground whitespace-nowrap">· {selected.size} selected</span>}
          </div>
          {toolbar && <div className="flex-1 min-w-0">{toolbar}</div>}
        </div>
        {/* min-h keeps the table the same height when a filter returns nothing,
            so the page doesn't collapse under the toolbar. The header above is
            always rendered — previously the empty state replaced it, which hid
            the very filter controls needed to undo the filter. */}
        <ul className="divide-y divide-slate-100 max-h-[60vh] min-h-[240px] overflow-y-auto scrollbar-thin">
          {rows.length === 0 && (
            <li className="p-12 text-center">
              <div className="mx-auto size-12 rounded-full bg-brand-cyan-light/40 flex items-center justify-center mb-3">
                <ListChecks className="size-6 text-brand-cyan" />
              </div>
              <div className="text-sm font-semibold text-slate-700">
                {activeFilterLabel ? `No ${activeFilterLabel} tasks` : "You're all caught up"}
              </div>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                {activeFilterLabel
                  ? `Nothing matches ${activeFilterLabel}. Clear the filter to see the rest.`
                  : "No tasks match this view. Create one, or let workflows add them automatically when SIPs fail, reviews come due, or KYC expires."}
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                {activeFilterLabel && (
                  <button
                    type="button"
                    onClick={() => router.push("/dashboard/tasks")}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
                  >
                    <X className="size-4" /> Clear filters
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => router.push("/dashboard/tasks/new")}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium"
                >
                  <ListChecks className="size-4" /> New task
                </button>
              </div>
            </li>
          )}
          {rows.map((row) => {
            const t = row.task;
            // `cancelled` and `completed` are different outcomes and must not
            // look identical: filtering by Cancelled used to render rows with
            // the green completed tick, so a correct result looked like the
            // filter was returning completed tasks.
            const isCompleted = t.status === "completed";
            const isCancelled = t.status === "cancelled";
            const isDone = isCompleted || isCancelled;
            const creatorName = row.createdBy ?? "System";
            const assigneeLabel = row.assignee ? (t.assigneeId === currentUserId ? "Me" : row.assignee) : "Unassigned";
            return (
              <li
                key={t.id}
                onClick={() => setSelectedRow(row)}
                className={`group/row px-4 py-2.5 flex items-center gap-3 transition-colors cursor-pointer select-none hover:bg-slate-50/70 ${isDone ? "opacity-70" : ""}`}
              >
                {/* Bulk-select checkbox — revealed on row hover (or when checked). */}
                <input
                  type="checkbox"
                  checked={selected.has(t.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleSelect(t.id)}
                  className={`size-3.5 rounded border-slate-300 flex-shrink-0 transition-opacity ${
                    selected.has(t.id) ? "opacity-100" : "opacity-0 group-hover/row:opacity-100 focus:opacity-100"
                  }`}
                  aria-label="Select task"
                />

                {/* Complete / reopen — strikes through the title when done.
                    Cancelled shows a slate ✕ rather than the green tick. */}
                <button
                  type="button"
                  onClick={(e) => handleToggleComplete(t.id, !isDone, e)}
                  disabled={completingTaskId === t.id}
                  className={`shrink-0 rounded-full border size-5 flex items-center justify-center transition ${
                    isCompleted
                      ? "bg-emerald-500 border-emerald-500 text-white"
                      : isCancelled
                        ? "bg-slate-400 border-slate-400 text-white"
                        : "border-slate-300 text-transparent hover:border-emerald-400 hover:text-emerald-400"
                  }`}
                  title={isDone ? "Reopen task" : "Mark complete"}
                  aria-label={isDone ? "Reopen task" : "Mark complete"}
                >
                  {completingTaskId === t.id ? (
                    <Loader2 className="size-3 animate-spin text-slate-400" />
                  ) : isCancelled ? (
                    <X className="size-3" />
                  ) : (
                    <Check className="size-3" />
                  )}
                </button>

                {/* Task content */}
                <span className={`flex-1 min-w-0 text-sm truncate ${isDone ? "line-through text-slate-400 font-normal" : "font-medium text-slate-800"}`}>
                  {t.title}
                </span>
                {isCancelled && (
                  <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5">
                    Cancelled
                  </span>
                )}

                {/* Due · priority · status — the facts an RM scans for. Colour
                    only when it means something (overdue red, urgent/high tint,
                    blocked rose); everything else stays quiet. */}
                <div className="hidden sm:flex items-center gap-2 shrink-0">
                  {t.dueAt && !isDone && (
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] rounded-md px-1.5 py-0.5 border ${
                        new Date(t.dueAt).getTime() < Date.now()
                          ? "text-rose-700 bg-rose-50 border-rose-200 font-semibold"
                          : "text-slate-600 bg-white border-slate-200"
                      }`}
                      title={new Date(t.dueAt).toLocaleString("en-IN")}
                    >
                      <CalendarClock className="size-3" />
                      {formatRelative(t.dueAt)}
                    </span>
                  )}
                  {(t.priority === "urgent" || t.priority === "high") && !isDone && (
                    <span className={`text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${
                      t.priority === "urgent" ? "text-rose-700 bg-rose-50 border border-rose-200" : "text-amber-700 bg-amber-50 border border-amber-200"
                    }`}>
                      {t.priority}
                    </span>
                  )}
                  {(t.status === "in_progress" || t.status === "blocked") && (
                    <span className={`text-[10px] font-medium rounded px-1.5 py-0.5 border ${
                      t.status === "blocked" ? "text-rose-700 bg-rose-50 border-rose-200" : "text-violet-700 bg-violet-50 border-violet-200"
                    }`}>
                      {t.status === "blocked" ? "Blocked" : "In progress"}
                    </span>
                  )}
                </div>

                {/* Assigned by / assigned to — two clearly-labelled columns */}
                <div className="hidden md:flex items-center gap-5 shrink-0">
                  <div className="w-28 min-w-0">
                    <div className="text-[9px] uppercase tracking-wide text-slate-400 leading-none">Assigned by</div>
                    <div className={`text-xs truncate mt-0.5 ${creatorName === "System" ? "text-slate-400 font-normal" : "text-slate-700 font-medium"}`}>
                      {creatorName === "System" ? "Automation" : creatorName}
                    </div>
                  </div>
                  <div className="w-28 min-w-0">
                    <div className="text-[9px] uppercase tracking-wide text-slate-400 leading-none">Assigned to</div>
                    <div className="text-xs text-slate-700 font-medium truncate mt-0.5">{assigneeLabel}</div>
                  </div>
                </div>

                {/* Edit (opens the modal) + delete */}
                <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-0.5 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setSelectedRow(row)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label="Edit task"
                    title="Edit"
                  >
                    <Pencil className="size-4" />
                  </button>
                  {/* Delete lives behind the ⋯ menu — not one accidental click away. */}
                  <RowActions deleteUrl={`/api/tasks/${t.id}`} itemLabel="task" itemName={t.title} verb="Delete" />
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {selectedRow && (
        <TaskDetailDrawer
          task={{
            ...selectedRow.task,
            assigneeName: selectedRow.assignee,
            investorName: selectedRow.investorName,
            leadName: selectedRow.leadName,
          }}
          currentUserId={currentUserId}
          canManageAll={canManageAll}
          onClose={() => setSelectedRow(null)}
          onUpdate={handleUpdate}
        />
      )}

      <ConfirmDialog
        open={confirmBulkDelete}
        title="Delete tasks?"
        message={`Move ${selected.size} selected task${selected.size === 1 ? "" : "s"} to Trash? You can restore ${selected.size === 1 ? "it" : "them"} from the Trash bin.`}
        confirmLabel="Delete"
        tone="danger"
        busy={bulkBusy}
        onConfirm={() => runBulk("delete")}
        onCancel={() => setConfirmBulkDelete(false)}
      />
    </div>
  );
}
