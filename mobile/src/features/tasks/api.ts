/**
 * Tasks data layer — GET /api/tasks (full web filter/sort/view set) + KPI strip
 * (GET /api/tasks/kpis). Create / edit / complete / delete via /api/tasks[/id].
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { Tone } from "../../theme";

export interface Task {
  id: string;
  title: string | null;
  description: string | null;
  type: string | null;
  priority: string | null;
  status: string | null;
  department: string | null;
  dueAt: string | null;
  slaDueAt: string | null;
  completedAt: string | null;
  assigneeId: string | null;
  assignee?: string | null;
  subjectType: string | null;
  relatedInvestorId: string | null;
  relatedLeadId: string | null;
  relatedServiceRequestId?: string | null;
  relatedMeetingId?: string | null;
  investorName?: string | null;
  leadName?: string | null;
  remarks: string | null;
  recurrence?: string | null;
  meta?: { checklist?: ChecklistItem[]; [k: string]: any } | null;
  createdAt?: string | null;
  [key: string]: any;
}

export interface ChecklistItem {
  id: string;
  text: string;
  status?: "not_started" | "in_progress" | "completed" | "assigned_to_other";
  done?: boolean;
  doneAt?: string | null;
  actionDate?: string | null;
  remark?: string | null;
}

export interface TaskFilters {
  q?: string;
  status?: string;
  priority?: string;
  type?: string;
  department?: string;
  assignee?: string;
  due?: "" | "today" | "overdue" | "sla_risk";
  view?: "" | "to_me" | "by_me" | "kanban";
  sort?: "created" | "created_asc" | "due" | "due_desc" | "priority";
  created_from?: string;
  created_to?: string;
}

export function useTasks(filters: TaskFilters) {
  return useQuery({
    queryKey: ["tasks", filters],
    queryFn: () =>
      api.get<{ tasks: Task[]; total: number }>("/api/tasks", {
        q: filters.q || undefined,
        status: filters.status || undefined,
        priority: filters.priority || undefined,
        type: filters.type || undefined,
        department: filters.department || undefined,
        assignee: filters.assignee || undefined,
        due: filters.due || undefined,
        view: filters.view || undefined,
        sort: filters.sort || undefined,
        created_from: filters.created_from || undefined,
        created_to: filters.created_to || undefined,
      }),
  });
}

export interface TaskKpis { open: number; today: number; overdue: number; slaRisk: number }
export function useTaskKpis(filters: TaskFilters) {
  return useQuery({
    queryKey: ["task-kpis", { q: filters.q, view: filters.view, priority: filters.priority, department: filters.department, assignee: filters.assignee }],
    queryFn: () =>
      api.get<TaskKpis>("/api/tasks/kpis", {
        q: filters.q || undefined, view: filters.view || undefined, priority: filters.priority || undefined,
        department: filters.department || undefined, assignee: filters.assignee || undefined,
      }),
    staleTime: 30_000,
  });
}

export function useTask(id?: string) {
  return useQuery({ queryKey: ["task", id], enabled: !!id, queryFn: () => api.get<Task>(`/api/tasks/${id}`) });
}

export interface NewTask { title: string; description?: string; type?: string; priority?: string; dueAt?: string }
export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: NewTask) => api.post<{ id: string }>("/api/tasks", body), onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }) });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/tasks/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); qc.invalidateQueries({ queryKey: ["task-kpis"] }); qc.invalidateQueries({ queryKey: ["trash"] }); qc.invalidateQueries({ queryKey: ["command-center"] }); },
  });
}

export function useUpdateTask(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Task>) => api.patch(`/api/tasks/${id}`, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["task", id] }); qc.invalidateQueries({ queryKey: ["tasks"] }); qc.invalidateQueries({ queryKey: ["task-kpis"] }); },
  });
}

// ── Constants ─────────────────────────────────────────────────────────────────
export const TASK_STATUSES: { key: string; label: string; tone: Tone }[] = [
  { key: "open", label: "Open", tone: "info" },
  { key: "in_progress", label: "In Progress", tone: "violet" },
  { key: "blocked", label: "Blocked", tone: "danger" },
  { key: "completed", label: "Completed", tone: "success" },
  { key: "cancelled", label: "Cancelled", tone: "neutral" },
];
export const TASK_PRIORITIES = [
  { key: "urgent", label: "Urgent" }, { key: "high", label: "High" }, { key: "normal", label: "Normal" }, { key: "low", label: "Low" },
];
export const TASK_DEPARTMENTS = ["sales", "operations", "back_office", "compliance", "marketing", "advisory", "support", "leadership", "other"];
export const TASK_TYPES = ["follow_up", "review_meeting", "collect_document", "kyc_renewal", "mandate_renewal", "custom"];

export const statusMeta = (s?: string | null) => TASK_STATUSES.find((x) => x.key === s);
export const TASK_PRIORITY_TONE: Record<string, Tone> = { urgent: "danger", high: "warning", normal: "info", low: "neutral", medium: "info" };

const STATUS_INDEX = new Map(TASK_STATUSES.map((s, i) => [s.key, i]));
export function groupTasksByStatus(tasks: Task[]): { key: string; label: string; tone: Tone; tasks: Task[] }[] {
  const buckets = new Map<string, Task[]>();
  for (const s of TASK_STATUSES) buckets.set(s.key, []);
  for (const t of tasks) { const k = t.status ?? "open"; (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(t); }
  return Array.from(buckets.entries())
    .map(([key, ts]) => ({ key, label: statusMeta(key)?.label ?? key, tone: statusMeta(key)?.tone ?? "neutral", tasks: ts }))
    .sort((a, b) => (STATUS_INDEX.get(a.key) ?? 99) - (STATUS_INDEX.get(b.key) ?? 99));
}

/** SLA badge text/tone from slaDueAt. */
export function slaInfo(t: Task): { label: string; tone: Tone } | null {
  if (!t.slaDueAt || t.status === "completed" || t.status === "cancelled") return null;
  const ms = new Date(t.slaDueAt).getTime() - Date.now();
  if (ms < 0) return { label: "SLA breached", tone: "danger" };
  const h = ms / 3_600_000;
  if (h < 24) return { label: `SLA ${Math.max(1, Math.round(h))}h`, tone: "warning" };
  return { label: `SLA ${Math.round(h / 24)}d`, tone: "neutral" };
}

export function checklistProgress(t: Task): { done: number; total: number } {
  const items = t.meta?.checklist ?? [];
  return { done: items.filter((i) => i.status === "completed" || i.done).length, total: items.length };
}
