"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, MapPin } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

type Settings = {
  workStart: string;
  workEnd: string;
  graceMinutes: number;
  halfDayMinutes: number;
  fullDayMinutes: number;
  weekOffDays: number[];
  requireGeo: boolean;
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function AttendanceSettingsForm({
  initial,
  canManage,
}: {
  initial: Settings;
  canManage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [workStart, setWorkStart] = useState(initial.workStart);
  const [workEnd, setWorkEnd] = useState(initial.workEnd);
  const [graceMinutes, setGraceMinutes] = useState(initial.graceMinutes);
  const [halfDayMinutes, setHalfDayMinutes] = useState(initial.halfDayMinutes);
  const [fullDayMinutes, setFullDayMinutes] = useState(initial.fullDayMinutes);
  const [weekOffDays, setWeekOffDays] = useState<number[]>(initial.weekOffDays ?? []);
  const [requireGeo, setRequireGeo] = useState(initial.requireGeo);
  const [busy, setBusy] = useState(false);

  function toggleDay(dow: number) {
    setWeekOffDays((prev) =>
      prev.includes(dow) ? prev.filter((d) => d !== dow) : [...prev, dow].sort((a, b) => a - b)
    );
  }

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/attendance/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workStart,
          workEnd,
          graceMinutes: Number(graceMinutes) || 0,
          halfDayMinutes: Number(halfDayMinutes) || 0,
          fullDayMinutes: Number(fullDayMinutes) || 0,
          weekOffDays,
          requireGeo,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? `Save failed (${res.status})`, "Could not save");
        return;
      }
      toast.success("Attendance settings updated.");
      router.refresh();
    } catch {
      toast.error("Network error. Please try again.", "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-surface p-5 space-y-5 max-w-3xl">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Work start">
          <input
            type="time"
            value={workStart}
            onChange={(e) => setWorkStart(e.target.value)}
            disabled={!canManage}
            className="input-base"
          />
        </Field>
        <Field label="Work end">
          <input
            type="time"
            value={workEnd}
            onChange={(e) => setWorkEnd(e.target.value)}
            disabled={!canManage}
            className="input-base"
          />
        </Field>

        <Field label="Grace period (minutes)">
          <input
            type="number"
            min={0}
            value={graceMinutes}
            onChange={(e) => setGraceMinutes(e.target.valueAsNumber || 0)}
            disabled={!canManage}
            className="input-base"
          />
        </Field>
        <div className="hidden sm:block" />

        <Field label="Half-day threshold (minutes)">
          <input
            type="number"
            min={0}
            value={halfDayMinutes}
            onChange={(e) => setHalfDayMinutes(e.target.valueAsNumber || 0)}
            disabled={!canManage}
            className="input-base"
          />
        </Field>
        <Field label="Full-day threshold (minutes)">
          <input
            type="number"
            min={0}
            value={fullDayMinutes}
            onChange={(e) => setFullDayMinutes(e.target.valueAsNumber || 0)}
            disabled={!canManage}
            className="input-base"
          />
        </Field>
      </div>

      <div>
        <div className="text-xs font-semibold text-foreground/80 mb-2">Weekly off days</div>
        <div className="flex flex-wrap gap-2">
          {DAY_LABELS.map((label, dow) => {
            const on = weekOffDays.includes(dow);
            return (
              <label
                key={dow}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm cursor-pointer select-none transition-colors ${
                  on ? "border-brand-cyan bg-brand-cyan/10 text-foreground" : "border-border text-muted-foreground"
                } ${canManage ? "" : "opacity-60 cursor-not-allowed"}`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggleDay(dow)}
                  disabled={!canManage}
                  className="sr-only"
                />
                {label}
              </label>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5">
          Selected days are treated as weekly offs in the attendance grid.
        </p>
      </div>

      <label
        className={`flex items-start gap-3 rounded-md border border-border p-3 ${
          canManage ? "cursor-pointer" : "opacity-60 cursor-not-allowed"
        }`}
      >
        <input
          type="checkbox"
          checked={requireGeo}
          onChange={(e) => setRequireGeo(e.target.checked)}
          disabled={!canManage}
          className="mt-0.5 size-4"
        />
        <div>
          <div className="text-sm font-medium flex items-center gap-1.5">
            <MapPin className="size-4 text-muted-foreground" /> Require geolocation on clock-in
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ask employees to share their location when they clock in.
          </p>
        </div>
      </label>

      {canManage ? (
        <div className="flex justify-end pt-2 border-t border-border">
          <button onClick={save} disabled={busy} className="btn-primary">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save settings
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground border-t border-border pt-3">
          Only an owner or branch head can change these settings.
        </p>
      )}
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
