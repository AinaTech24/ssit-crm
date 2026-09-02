"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, CalendarDays, AlertTriangle, Clock } from "lucide-react";
import {
  LEAVE_TYPE_LABELS,
  LEAVE_DURATION_LABELS,
  getEntitlement,
  computeDays,
} from "@/lib/leave/policy";
import { ThemeSelect } from "@/components/ui/ThemeSelect";
import { ThemeDate } from "@/components/ui/ThemeDate";

type Emp = {
  id: string;
  name: string;
  custom_leave_entitlements?: Record<string, number> | null;
};
type Usage = { employee_user_id: string; leave_type: string; used: number };

export function LeaveForm({
  employees,
  usage,
  currentUserId,
  isManager,
  tenantEntitlements,
}: {
  employees: Emp[];
  usage: Usage[];
  currentUserId: string;
  isManager: boolean;
  /** Firm-wide annual entitlements (overlaid on built-in defaults). */
  tenantEntitlements?: Record<string, number | null> | null;
}) {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState(currentUserId);
  const [leaveType, setLeaveType] = useState("casual");
  const [duration, setDuration] = useState<"full_day" | "half_day">("full_day");
  const [fromDate, setFromDate] = useState(todayStr());
  const [toDate, setToDate] = useState(todayStr());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [conflicts, setConflicts] = useState<any[]>([]);
  const [checkingConflicts, setCheckingConflicts] = useState(false);

  useEffect(() => {
    if (!employeeId || !fromDate) return;
    const end = duration === "half_day" ? fromDate : toDate;
    if (end < fromDate) return;

    let active = true;
    setCheckingConflicts(true);
    fetch(`/api/leave-applications/conflicts?employeeId=${employeeId}&fromDate=${fromDate}&toDate=${end}`)
      .then((res) => res.json())
      .then((data) => {
        if (active && data.conflicts) {
          setConflicts(data.conflicts);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setCheckingConflicts(false);
      });

    return () => {
      active = false;
    };
  }, [employeeId, fromDate, toDate, duration]);

  const usageMap = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    for (const u of usage) {
      (m[u.employee_user_id] ??= {})[u.leave_type] = Number(u.used);
    }
    return m;
  }, [usage]);

  const selectedEmployee = useMemo(() => employees.find((e) => e.id === employeeId), [employees, employeeId]);

  // Working-day count: show the instant client estimate, then replace with the
  // server's authoritative number (excludes the firm's weekly-offs + holidays).
  const [days, setDays] = useState<number>(duration === "half_day" ? 0.5 : computeDays(fromDate, toDate, "full_day"));
  useEffect(() => {
    if (duration === "half_day") { setDays(0.5); return; }
    if (!fromDate || toDate < fromDate) { setDays(0); return; }
    setDays(computeDays(fromDate, toDate, "full_day")); // optimistic estimate while fetching
    let active = true;
    fetch(`/api/leave-applications/preview-days?from=${fromDate}&to=${toDate}&duration=full_day`)
      .then((r) => r.json())
      .then((d) => { if (active && typeof d?.days === "number") setDays(d.days); })
      .catch(() => {});
    return () => { active = false; };
  }, [fromDate, toDate, duration]);

  const entitlement = getEntitlement(leaveType, selectedEmployee?.custom_leave_entitlements, tenantEntitlements);
  const used = usageMap[employeeId]?.[leaveType] ?? 0;
  const remaining = entitlement === null ? null : Math.max(0, entitlement - used);
  const overBalance = remaining !== null && days > remaining;

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/leave-applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          employeeUserId: employeeId,
          leaveType,
          duration,
          fromDate,
          toDate: duration === "half_day" ? fromDate : toDate,
          reason: reason || undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? `Save failed (${res.status})`); return; }
      router.push("/dashboard/leave-applications");
    } finally {
      setBusy(false);
    }
  }

  const canSave = !!employeeId && !!fromDate && days > 0 && (duration === "half_day" || toDate >= fromDate);

  return (
    <div className="card-surface p-5 space-y-4 max-w-3xl">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Employee">
          <ThemeSelect
            value={employeeId}
            onChange={(val) => setEmployeeId(val)}
            disabled={!isManager}
          >
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}{e.id === currentUserId ? " (me)" : ""}</option>
            ))}
          </ThemeSelect>
          {!isManager && <p className="text-[11px] text-muted-foreground mt-1">You can only file leave for yourself.</p>}
        </Field>
        <Field label="Leave type">
          <ThemeSelect value={leaveType} onChange={(val) => setLeaveType(val)}>
            {Object.entries(LEAVE_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </ThemeSelect>
        </Field>

        <Field label="Duration">
          <ThemeSelect value={duration} onChange={(val) => setDuration(val as any)}>
            {Object.entries(LEAVE_DURATION_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </ThemeSelect>
        </Field>
        <Field label={duration === "half_day" ? "Date" : "From date"}>
          <ThemeDate value={fromDate} onChange={(val) => { setFromDate(val); if (toDate < val) setToDate(val); }} />
        </Field>

        {duration === "full_day" && (
          <Field label="To date">
            <ThemeDate value={toDate} min={fromDate} onChange={(val) => setToDate(val)} />
          </Field>
        )}
        <Field label="No. of days">
          <div className="input-base flex items-center gap-2 bg-secondary/40">
            <CalendarDays className="size-4 text-muted-foreground" />
            <span className="font-bold tabular-nums">{days}</span>
            <span className="text-xs text-muted-foreground">auto-computed</span>
          </div>
        </Field>
      </div>

      {/* Balance */}
      <div className={`rounded-md border px-3 py-2 text-sm ${overBalance ? "border-rose-200 bg-rose-50 text-rose-700" : "border-border bg-secondary/30"}`}>
        {entitlement === null ? (
          <span className="text-muted-foreground">{LEAVE_TYPE_LABELS[leaveType]} is uncapped — no annual limit.</span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            {overBalance && <AlertTriangle className="size-4" />}
            {LEAVE_TYPE_LABELS[leaveType]} balance: <b>{remaining}</b> of {entitlement} left this FY ({used} used)
            {overBalance && <span className="font-medium"> · this request ({days}) exceeds the balance</span>}
          </span>
        )}
      </div>

      {/* Coverage Conflicts */}
      {conflicts.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50/50 text-amber-900 p-3 text-sm space-y-1">
          <div className="font-semibold flex items-center gap-1.5 text-amber-800">
            <AlertTriangle className="size-4 text-amber-600 animate-pulse" />
            <span>Department Coverage Alert ({conflicts.length} conflict{conflicts.length > 1 ? "s" : ""})</span>
          </div>
          <p className="text-xs text-amber-700">
            Other team members in the same department have scheduled leaves during this period:
          </p>
          <ul className="list-disc list-inside text-xs pl-1 space-y-0.5 text-amber-800 mt-1">
            {conflicts.map((c: any) => {
              const empName = c.employee_name || c.employeeName;
              const fDate = c.from_date || c.fromDate;
              const tDate = c.to_date || c.toDate;
              const lType = c.leave_type || c.leaveType;
              const formattedFDate = fDate ? new Date(fDate).toLocaleDateString("en-IN", { day: 'numeric', month: 'short' }) : '';
              const formattedTDate = tDate ? new Date(tDate).toLocaleDateString("en-IN", { day: 'numeric', month: 'short' }) : '';
              const dateStr = formattedFDate === formattedTDate ? formattedFDate : `${formattedFDate} - ${formattedTDate}`;
              const typeLabel = LEAVE_TYPE_LABELS[lType] || lType;

              return (
                <li key={c.id}>
                  <span className="font-medium">{empName}</span> ({typeLabel}): {dateStr}
                </li>
              );
            })}
          </ul>
        </div>
      )}


      <Field label="Reason">
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason for leave…" className="input-base" />
      </Field>

      {err && <div className="border border-destructive/30 bg-destructive/5 text-destructive rounded-lg px-3 py-2 text-sm">{err}</div>}

      <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-border">
        <button onClick={save} disabled={!canSave || busy} className="btn-primary w-full sm:w-auto justify-center">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} File leave request
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-semibold text-foreground/80 mb-1.5">{label}</div>
      {children}
    </label>
  );
}

function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
