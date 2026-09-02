"use client";

/**
 * Holiday master manager — add-form (DatePicker + name + optional flag) and the
 * per-row delete buttons. Talks to /api/attendance/holidays and refreshes the
 * server-rendered list on success. Managers (owner / branch_head) only see the
 * add/delete controls; the page already gates `canManage`.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, CalendarOff } from "lucide-react";
import { DatePicker, formatDisplayDate } from "@/components/ui/DatePicker";
import { useToast } from "@/components/ui/Toast";

export type HolidayRow = {
  id: string;
  holidayDate: string;
  name: string;
  isOptional: boolean;
};

export function HolidayManager({
  holidays,
  canManage,
}: {
  holidays: HolidayRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [isOptional, setIsOptional] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const canAdd = !!date && name.trim().length > 0 && !adding;

  async function add() {
    setAdding(true);
    try {
      const res = await fetch("/api/attendance/holidays", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date, name: name.trim(), isOptional }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? `Could not add holiday (${res.status})`, "Add failed");
        return;
      }
      toast.success("Holiday added");
      setDate("");
      setName("");
      setIsOptional(false);
      router.refresh();
    } finally {
      setAdding(false);
    }
  }

  async function remove(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/attendance/holidays?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? `Could not remove holiday (${res.status})`, "Delete failed");
        return;
      }
      toast.success("Holiday removed");
      router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {canManage && (
        <div className="card-surface p-5 space-y-4 max-w-3xl">
          <div className="text-sm font-semibold text-foreground/80">Add a holiday</div>
          <div className="grid sm:grid-cols-3 gap-4">
            <label className="block">
              <div className="text-xs font-semibold text-foreground/80 mb-1.5">Date</div>
              <DatePicker value={date} onChange={setDate} ariaLabel="Holiday date" />
            </label>
            <label className="block sm:col-span-2">
              <div className="text-xs font-semibold text-foreground/80 mb-1.5">Name</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Diwali, Independence Day…"
                className="input-base"
                maxLength={120}
              />
            </label>
          </div>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-foreground/80 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isOptional}
                onChange={(e) => setIsOptional(e.target.checked)}
                className="size-4 rounded border-border accent-brand-cyan"
              />
              Optional / restricted holiday
            </label>
            <button onClick={add} disabled={!canAdd} className="btn-primary">
              {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add holiday
            </button>
          </div>
        </div>
      )}

      {holidays.length === 0 ? (
        <div className="card-surface p-10 text-center">
          <CalendarOff className="size-8 text-muted-foreground mx-auto mb-3" />
          <div className="font-semibold">No holidays yet</div>
          <p className="text-sm text-muted-foreground mt-1">
            {canManage
              ? "Add your firm's non-working days above so attendance auto-marks them."
              : "No holidays have been configured for this year."}
          </p>
        </div>
      ) : (
        <ul className="card-surface divide-y divide-border overflow-hidden">
          {holidays.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {h.name}
                  {h.isOptional && (
                    <span className="ml-2 text-[11px] font-medium rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5">
                      Optional
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums mt-0.5">
                  {formatDisplayDate(h.holidayDate)}
                </div>
              </div>
              {canManage && (
                <button
                  onClick={() => remove(h.id)}
                  disabled={deletingId === h.id}
                  className="shrink-0 inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                  aria-label={`Delete ${h.name}`}
                >
                  {deletingId === h.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
