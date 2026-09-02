"use client";

/**
 * TaskKanban — status-column board for the Tasks module. Cards group by status
 * (Open · In Progress · Blocked · Completed · Cancelled). Drag a card to another
 * column to change its status (HTML5 drag), or click a card to open the full
 * detail drawer. Optimistic move + PATCH; reverts + toasts on failure.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, GripVertical, CalendarClock, User, ListChecks, Plus, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { TaskDetailDrawer } from "./TaskDetailDrawer";
import { Avatar } from "@/components/ui/Avatar";
import { taskChecklist, type Task } from "@/db/schema";

interface TaskRow {
  task: Task;
  assignee: string | null;
  investorName: string | null;
  investorAvatarUrl?: string | null;
  leadName: string | null;
  leadAvatarUrl?: string | null;
}

const COLUMNS = [
  { key: "open", label: "Open", dot: "bg-sky-500" },
  { key: "in_progress", label: "In Progress", dot: "bg-violet-500" },
  { key: "blocked", label: "Blocked", dot: "bg-rose-500" },
  { key: "completed", label: "Completed", dot: "bg-emerald-500" },
  { key: "cancelled", label: "Cancelled", dot: "bg-slate-400" },
] as const;

const PRIORITY_TONE: Record<string, string> = {
  urgent: "bg-rose-100 text-rose-700",
  high: "bg-amber-100 text-amber-700",
  normal: "bg-slate-100 text-slate-600",
  low: "bg-slate-100 text-slate-500",
};

function fmtDue(d: any): string | null {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export function TaskKanban({ initialRows, currentUserId, canManageAll = false }: { initialRows: TaskRow[]; currentUserId: string; canManageAll?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState(initialRows);
  const [selected, setSelected] = useState<TaskRow | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [addingCol, setAddingCol] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);

  // Re-sync when the server query changes (filters / refresh).
  if (JSON.stringify(initialRows.map((r) => r.task.id)) !== JSON.stringify(rows.map((r) => r.task.id))) {
    setRows(initialRows);
  }

  async function move(taskId: string, toStatus: string) {
    const row = rows.find((r) => r.task.id === taskId);
    if (!row || row.task.status === toStatus) return;
    const prev = rows;
    setBusyId(taskId);
    // Optimistic.
    setRows((rs) => rs.map((r) => (r.task.id === taskId ? { ...r, task: { ...r.task, status: toStatus as any } } : r)));
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: toStatus }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setRows(prev);
        toast.error(j.error ?? "Could not move task", "Update failed");
        return;
      }
      toast.success(`Moved to ${toStatus.replace(/_/g, " ")}`);
      router.refresh();
    } catch {
      setRows(prev);
      toast.error("Network error — please try again", "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  async function createInColumn(status: string) {
    const title = newTitle.trim();
    if (!title || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, status }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? "Could not create task", "Create failed");
        return;
      }
      setNewTitle("");
      setAddingCol(null);
      toast.success("Task added");
      router.refresh(); // server re-fetch; the id-diff resync below picks it up
    } catch {
      toast.error("Network error — please try again", "Create failed");
    } finally {
      setCreating(false);
    }
  }

  const grouped = COLUMNS.map((c) => ({ ...c, items: rows.filter((r) => r.task.status === c.key) }));

  return (
    <>
      <div className="overflow-x-auto scrollbar-none pb-2">
        <div className="flex gap-3 min-w-max">
          {grouped.map((col) => (
            <div
              key={col.key}
              onDragOver={(e) => { e.preventDefault(); setOverCol(col.key); }}
              onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
              onDrop={(e) => { e.preventDefault(); setOverCol(null); if (dragId) move(dragId, col.key); setDragId(null); }}
              className={`w-72 shrink-0 rounded-xl border p-2.5 transition-colors ${
                overCol === col.key ? "border-brand-cyan/60 bg-brand-cyan-light/20" : "border-border bg-secondary/30"
              }`}
            >
              <div className="flex items-center justify-between px-1 pb-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span className={`size-2 rounded-full ${col.dot}`} />
                  {col.label}
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">{col.items.length}</span>
              </div>

              <div className="space-y-2 min-h-[3rem] max-h-[60vh] overflow-y-auto scrollbar-none pr-0.5">
                {col.items.map((row) => {
                  const t = row.task;
                  const due = fmtDue(t.dueAt);
                  const overdue = t.dueAt && new Date(t.dueAt as any).getTime() < Date.now() && t.status !== "completed" && t.status !== "cancelled";
                  const who = row.investorName || row.leadName;
                  const checklist = taskChecklist(t.meta);
                  const checklistDone = checklist.filter((c) => c.done).length;
                  return (
                    <div
                      key={t.id}
                      draggable={busyId !== t.id}
                      onDragStart={() => setDragId(t.id)}
                      onDragEnd={() => setDragId(null)}
                      onClick={() => setSelected(row)}
                      className="group rounded-lg border border-border bg-card p-2.5 cursor-pointer hover:shadow-sm hover:border-brand-cyan/40 transition active:cursor-grabbing"
                    >
                      <div className="flex items-start gap-1.5">
                        <GripVertical className="size-3.5 mt-0.5 text-muted-foreground/40 shrink-0 group-hover:text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium leading-snug line-clamp-2">{t.title}</div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span className={`chip text-[10px] capitalize ${PRIORITY_TONE[t.priority] ?? ""}`}>{t.priority}</span>
                            {checklist.length > 0 && (
                              <span
                                className={`chip text-[10px] inline-flex items-center gap-1 ${
                                  checklistDone === checklist.length ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                                }`}
                                title={`${checklistDone}/${checklist.length} action points done`}
                              >
                                <ListChecks className="size-2.5" /> {checklistDone}/{checklist.length}
                              </span>
                            )}
                            {who && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground truncate max-w-[8rem]">
                                <Avatar
                                  src={
                                    row.investorName && t.relatedInvestorId && row.investorAvatarUrl
                                      ? `/api/investors/${t.relatedInvestorId}/avatar`
                                      : row.leadName && t.relatedLeadId && row.leadAvatarUrl
                                        ? `/api/leads/${t.relatedLeadId}/avatar`
                                        : null
                                  }
                                  name={who}
                                  size={16}
                                />
                                <span className="truncate">{who}</span>
                              </span>
                            )}
                          </div>
                          <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                            <span className="inline-flex items-center gap-1 truncate">
                              <User className="size-3 shrink-0" />
                              {row.assignee ? (t.assigneeId === currentUserId ? "You" : row.assignee) : "Unassigned"}
                            </span>
                            {due && (
                              <span className={`inline-flex items-center gap-1 tabular-nums ${overdue ? "text-rose-600 font-medium" : ""}`}>
                                <CalendarClock className="size-3" /> {due}
                              </span>
                            )}
                          </div>
                        </div>
                        {busyId === t.id && <Loader2 className="size-3.5 animate-spin text-brand-cyan shrink-0" />}
                      </div>
                    </div>
                  );
                })}
                {col.items.length === 0 && addingCol !== col.key && (
                  <div className="text-[11px] text-muted-foreground/60 text-center py-4">Drop tasks here</div>
                )}
              </div>

              {/* Quick-add a task directly into this status column */}
              {addingCol === col.key ? (
                <div className="mt-1.5 rounded-lg border border-brand-cyan/40 bg-card p-2">
                  <textarea
                    autoFocus
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); createInColumn(col.key); }
                      if (e.key === "Escape") { setAddingCol(null); setNewTitle(""); }
                    }}
                    rows={2}
                    placeholder="Task title…"
                    className="w-full resize-none border-0 bg-transparent p-0 text-sm focus:outline-none focus:ring-0"
                  />
                  <div className="mt-1.5 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => createInColumn(col.key)}
                      disabled={creating || !newTitle.trim()}
                      className="btn-primary text-xs inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Add
                    </button>
                    <button type="button" onClick={() => { setAddingCol(null); setNewTitle(""); }} className="text-muted-foreground hover:text-foreground p-1" title="Cancel">
                      <X className="size-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setAddingCol(col.key); setNewTitle(""); }}
                  className="mt-1.5 w-full rounded-lg border border-dashed border-border py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-brand-cyan/50 hover:bg-card transition-colors inline-flex items-center justify-center gap-1"
                >
                  <Plus className="size-3.5" /> Add task
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {selected && (
        <TaskDetailDrawer
          task={{
            ...selected.task,
            assigneeName: selected.assignee,
            investorName: selected.investorName,
            leadName: selected.leadName,
          }}
          currentUserId={currentUserId}
          canManageAll={canManageAll}
          onClose={() => setSelected(null)}
          onUpdate={() => router.refresh()}
        />
      )}
    </>
  );
}
