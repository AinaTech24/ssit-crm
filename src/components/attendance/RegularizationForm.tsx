"use client";

/**
 * Attendance regularization form — file a correction request for one day.
 * Mirrors the leave form: optional employee picker (managers only), requested
 * status, optional clock-in/out wall times, and a reason. Submits to
 * POST /api/attendance/regularizations.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Save, X } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { DatePicker } from "@/components/ui/DatePicker";
import { useToast } from "@/components/ui/Toast";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/attendance/policy";

type Emp = { id: string; name: string };

function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function RegularizationForm({
  employees,
  currentUserId,
  isManager,
}: {
  employees: Emp[];
  currentUserId: string;
  isManager: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState(currentUserId);
  const [attendanceDate, setAttendanceDate] = useState(todayStr());
  const [requestedStatus, setRequestedStatus] = useState("present");
  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/attendance/regularizations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          employeeUserId: isManager ? employeeId : undefined,
          attendanceDate,
          requestedStatus,
          requestedClockInAt: clockIn || undefined,
          requestedClockOutAt: clockOut || undefined,
          reason: reason || undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? `Save failed (${res.status})`, "Could not file correction");
        return;
      }
      toast.success("Correction request filed.");
      setOpen(false);
      setReason("");
      setClockIn("");
      setClockOut("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div>
        <button onClick={() => setOpen(true)} className="btn-primary">
          <Plus className="size-4" /> New correction request
        </button>
      </div>
    );
  }

  const canSave = !!attendanceDate && !!requestedStatus && (isManager ? !!employeeId : true);

  return (
    <div className="card-surface p-5 space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">New correction request</h2>
        <button onClick={() => setOpen(false)} className="btn-ghost text-xs inline-flex items-center gap-1">
          <X className="size-3.5" /> Close
        </button>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {isManager && (
          <Field label="Employee">
            <SelectField value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.id === currentUserId ? " (me)" : ""}
                </option>
              ))}
            </SelectField>
          </Field>
        )}

        <Field label="Date">
          <DatePicker value={attendanceDate} onChange={setAttendanceDate} max={todayStr()} clearable={false} />
        </Field>

        <Field label="Requested status">
          <SelectField value={requestedStatus} onChange={(e) => setRequestedStatus(e.target.value)}>
            {Object.entries(ATTENDANCE_STATUS_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </SelectField>
        </Field>

        <Field label="Clock-in (optional)">
          <input type="time" value={clockIn} onChange={(e) => setClockIn(e.target.value)} className="input-base" />
        </Field>

        <Field label="Clock-out (optional)">
          <input type="time" value={clockOut} onChange={(e) => setClockOut(e.target.value)} className="input-base" />
        </Field>
      </div>

      <Field label="Reason">
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Why this correction is needed…"
          className="input-base"
        />
      </Field>

      <div className="flex justify-end pt-2 border-t border-border">
        <button onClick={save} disabled={!canSave || busy} className="btn-primary">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} File correction
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
