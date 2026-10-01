"use client";

import { useState, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Clock, Trash2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { ATTENDANCE_STATUS_LABELS, ATTENDANCE_STATUS_TONE, fmtMinutes } from "@/lib/attendance/policy";
import { SelectField } from "@/components/ui/SelectField";
import { Avatar } from "@/components/ui/Avatar";
import { useToast } from "@/components/ui/Toast";

const STATUSES = ["present", "absent", "half_day", "week_off", "holiday", "on_leave"] as const;

const SOURCE_LABEL: Record<string, string> = { manual: "Manual", clock: "Clocked", auto: "Auto" };
const SOURCE_TONE: Record<string, string> = {
  manual: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300",
  clock: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  auto: "bg-slate-50 text-slate-400 dark:bg-slate-500/10 dark:text-slate-400",
};

export type AttRow = {
  id: string;
  employee_user_id: string;
  employee_name: string | null;
  employee_avatar_url?: string | null;
  attendance_date: string;
  status: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  total_minutes: number | null;
  note: string | null;
  source?: string | null;
  is_late?: boolean;
  late_minutes?: number;
  is_early_out?: boolean;
  early_minutes?: number;
};

/** ISO → "HH:MM" in IST for a time input value. */
function hhmmInput(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
}
/** ISO → "h:mm AM/PM" in IST for display. */
function hhmm(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

export function AttendanceTable({ rows, canManage, toolbar }: { rows: AttRow[]; canManage: boolean; toolbar?: ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<string>("present");
  const [bulkBusy, setBulkBusy] = useState(false);

  const allSelected = useMemo(() => rows.length > 0 && rows.every((r) => sel.has(r.id)), [rows, sel]);

  function toggle(id: string) {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSel(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  async function patch(r: AttRow, body: Record<string, any>, okMsg: string) {
    setBusy(r.id);
    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ employeeUserId: r.employee_user_id, date: r.attendance_date, status: r.status, ...body }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? "Could not update attendance", "Update failed");
        return;
      }
      toast.success(okMsg);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  /**
   * Clears the day's mark entirely, so it reads as unmarked again.
   *
   * A WRONG status is fixed by changing the dropdown — marking is an upsert.
   * This is for a day that should carry no record at all: marked on a holiday,
   * or against the wrong person.
   */
  async function removeMark(r: AttRow) {
    if (!window.confirm(`Remove the attendance mark for ${r.employee_name ?? "this employee"} on ${r.attendance_date}? The day will read as unmarked.`)) return;
    setBusy(r.id);
    try {
      const res = await fetch(
        `/api/attendance?employeeUserId=${encodeURIComponent(r.employee_user_id)}&date=${encodeURIComponent(r.attendance_date)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? "Could not remove the mark");
        return;
      }
      toast.success("Attendance mark removed");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  function setStatus(r: AttRow, status: string) {
    patch(r, { status }, `${r.employee_name ?? "Attendance"} set to ${ATTENDANCE_STATUS_LABELS[status] ?? status}`);
  }
  function setClock(r: AttRow, which: "in" | "out", hhmmVal: string) {
    if (!hhmmVal) return;
    const iso = new Date(`${r.attendance_date}T${hhmmVal}:00+05:30`).toISOString();
    patch(r, which === "in" ? { clockInAt: iso } : { clockOutAt: iso }, "Clock time updated");
  }

  async function applyBulk() {
    const ids = [...sel];
    if (!ids.length) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/attendance/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, status: bulkStatus }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? "Bulk update failed", "Update failed");
        return;
      }
      toast.success(`${j.count ?? ids.length} marked ${ATTENDANCE_STATUS_LABELS[bulkStatus] ?? bulkStatus}`);
      setSel(new Set());
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  const header = toolbar ? (
    <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border">
      <div className="text-sm font-semibold whitespace-nowrap">
        Attendance <span className="text-muted-foreground font-normal text-xs">· {rows.length}</span>
      </div>
      {toolbar}
    </div>
  ) : null;

  if (rows.length === 0) {
    return (
      <div className="card-surface overflow-hidden">
        {header}
        <div className="p-12 text-center text-sm text-muted-foreground">No attendance records match these filters.</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {canManage && sel.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-brand-cyan/30 bg-brand-cyan-light/30 px-3 py-2 text-sm">
          <span className="font-medium">{sel.size} selected</span>
          <span className="text-muted-foreground">· set to</span>
          <SelectField value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} size="sm" className="w-32">
            {STATUSES.map((s) => <option key={s} value={s}>{ATTENDANCE_STATUS_LABELS[s]}</option>)}
          </SelectField>
          <button
            onClick={applyBulk}
            disabled={bulkBusy}
            className="rounded-md bg-brand-cyan text-white px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {bulkBusy && <Loader2 className="size-3 animate-spin" />} Apply to {sel.size}
          </button>
          <button onClick={() => setSel(new Set())} className="text-xs text-muted-foreground hover:text-foreground ml-1">
            Clear
          </button>
        </div>
      )}

      <div className="card-surface overflow-hidden">
        {header}
        <div className="table-scroll">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
            <tr>
              {canManage && (
                <th className="w-9 pl-4 py-2">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="size-3.5 accent-brand-cyan" aria-label="Select all" />
                </th>
              )}
              <th className="text-left px-4 py-2 font-medium">Employee</th>
              <th className="text-left py-2 font-medium">Date</th>
              <th className="text-left py-2 font-medium">Status</th>
              <th className="text-left py-2 font-medium">Clock In</th>
              <th className="text-left py-2 font-medium">Clock Out</th>
              <th className="text-right py-2 font-medium">Worked</th>
              <th className="text-left py-2 font-medium">Note</th>
              {canManage && <th className="text-right py-2 font-medium pr-4 w-10"></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0 hover:bg-brand-cyan-light/25 transition-colors">
                {canManage && (
                  <td className="pl-4 py-2.5">
                    <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} className="size-3.5 accent-brand-cyan" aria-label={`Select ${r.employee_name ?? "row"}`} />
                  </td>
                )}
                <td className="px-4 py-2.5 font-medium whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <Avatar src={r.employee_avatar_url ?? null} name={r.employee_name} size={26} />
                    <span>{r.employee_name ?? "—"}</span>
                  </div>
                </td>
                <td className="py-2.5 text-xs tabular-nums whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    {formatDate(r.attendance_date)}
                    {r.source && (
                      <span className={`text-[9px] px-1 py-px rounded ${SOURCE_TONE[r.source] ?? ""}`} title={`Marked: ${SOURCE_LABEL[r.source] ?? r.source}`}>
                        {SOURCE_LABEL[r.source] ?? r.source}
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-2.5">
                  {canManage ? (
                    <div className="flex items-center gap-1.5">
                      {busy === r.id && <Loader2 className="size-3 animate-spin text-brand-cyan" />}
                      <SelectField value={r.status} disabled={busy === r.id} onChange={(e) => setStatus(r, e.target.value)} size="sm" className="w-32">
                        {STATUSES.map((s) => <option key={s} value={s}>{ATTENDANCE_STATUS_LABELS[s]}</option>)}
                      </SelectField>
                    </div>
                  ) : (
                    <span className={`chip ${ATTENDANCE_STATUS_TONE[r.status] ?? ""}`}>{ATTENDANCE_STATUS_LABELS[r.status] ?? r.status}</span>
                  )}
                </td>
                <td className="py-2.5 text-xs tabular-nums">
                  <div className="flex items-center gap-1.5">
                    {canManage ? (
                      <input
                        type="time"
                        defaultValue={hhmmInput(r.clock_in_at)}
                        onChange={(e) => setClock(r, "in", e.target.value)}
                        className="w-[5.5rem] rounded border border-border bg-card px-1.5 py-0.5 text-xs"
                        aria-label="Clock in"
                      />
                    ) : (
                      hhmm(r.clock_in_at)
                    )}
                    {r.is_late && (
                      <span className="text-[9px] px-1 py-px rounded bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300" title={`Late by ${r.late_minutes ?? 0} min`}>
                        Late
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-2.5 text-xs tabular-nums">
                  <div className="flex items-center gap-1.5">
                    {canManage ? (
                      <input
                        type="time"
                        defaultValue={hhmmInput(r.clock_out_at)}
                        onChange={(e) => setClock(r, "out", e.target.value)}
                        className="w-[5.5rem] rounded border border-border bg-card px-1.5 py-0.5 text-xs"
                        aria-label="Clock out"
                      />
                    ) : (
                      hhmm(r.clock_out_at)
                    )}
                    {r.is_early_out && (
                      <span className="text-[9px] px-1 py-px rounded bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300" title={`Left ${r.early_minutes ?? 0} min early`}>
                        Early
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-2.5 text-right text-xs tabular-nums">
                  {r.total_minutes && r.total_minutes > 0 ? (
                    <span className="inline-flex items-center gap-1 justify-end">
                      <Clock className="size-3 text-muted-foreground/50" /> {fmtMinutes(r.total_minutes)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/40">—</span>
                  )}
                </td>
                {canManage && (
                  <td className="py-2.5 pr-4 text-right">
                    <button
                      type="button"
                      onClick={() => removeMark(r)}
                      disabled={busy === r.id}
                      title="Remove this attendance mark"
                      aria-label="Remove attendance mark"
                      className="text-muted-foreground hover:text-rose-600 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                )}
                <td className="py-2.5 pr-4 text-xs text-muted-foreground max-w-[200px] truncate">
                  {r.note ? r.note : <span className="text-muted-foreground/40">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
