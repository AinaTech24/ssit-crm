"use client";

/**
 * TaskTimePanel — estimate vs. logged time, a start/stop timer, and manual
 * time logs. Talks to /api/tasks/[id]/time. Estimate is saved via the task
 * PATCH (it's a task column).
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Play, Square, Plus, Timer } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

type Log = { id: string; minutes: number; note: string | null; loggedAt: string; userName: string | null };

export function fmtMinutes(m: number | null | undefined): string {
  const n = Math.max(0, Math.round(m ?? 0));
  if (n === 0) return "0m";
  const h = Math.floor(n / 60);
  const min = n % 60;
  return h ? `${h}h${min ? ` ${min}m` : ""}` : `${min}m`;
}

export function TaskTimePanel({
  taskId,
  initialEstimate,
  initialSpent,
  initialRunningSince,
  onChanged,
}: {
  taskId: string;
  initialEstimate: number | null;
  initialSpent: number;
  initialRunningSince: string | Date | null;
  onChanged?: () => void;
}) {
  const toast = useToast();
  const [estimate, setEstimate] = useState<string>(initialEstimate != null ? String(initialEstimate) : "");
  const [spent, setSpent] = useState(initialSpent);
  const [runningSince, setRunningSince] = useState<string | Date | null>(initialRunningSince);
  const [logs, setLogs] = useState<Log[]>([]);
  const [logMin, setLogMin] = useState("");
  const [logNote, setLogNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const tick = useRef<any>(null);

  useEffect(() => {
    fetch(`/api/tasks/${taskId}/time`)
      .then((r) => r.json())
      .then((j) => {
        if (Array.isArray(j.logs)) setLogs(j.logs);
        if (typeof j.spentMinutes === "number") setSpent(j.spentMinutes);
        setRunningSince(j.runningSince ?? null);
      })
      .catch(() => {});
  }, [taskId]);

  // Live elapsed while a timer runs.
  useEffect(() => {
    if (runningSince) {
      tick.current = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(tick.current);
    }
  }, [runningSince]);

  const runningMin = runningSince ? Math.max(0, Math.floor((now - new Date(runningSince).getTime()) / 60000)) : 0;
  const runningSec = runningSince ? Math.max(0, Math.floor((now - new Date(runningSince).getTime()) / 1000)) % 60 : 0;

  async function post(action: "start" | "stop" | "log", extra?: { minutes?: number; note?: string }) {
    setBusy(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/time`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "Failed");
      if (action === "start") setRunningSince(j.running ?? new Date().toISOString());
      else setRunningSince(null);
      if (typeof j.spent === "number") setSpent(j.spent);
      // refresh logs after stop/log
      if (action !== "start") {
        const lr = await fetch(`/api/tasks/${taskId}/time`).then((r) => r.json()).catch(() => ({}));
        if (Array.isArray(lr.logs)) setLogs(lr.logs);
      }
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Time action failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveEstimate() {
    const v = estimate.trim() === "" ? null : Math.max(0, parseInt(estimate, 10) || 0);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estimateMinutes: v }),
      });
      if (!res.ok) throw new Error();
      onChanged?.();
    } catch {
      toast.error("Couldn't save estimate");
    }
  }

  function addManual() {
    const m = parseInt(logMin, 10);
    if (!m || m < 1) return;
    post("log", { minutes: m, note: logNote.trim() || undefined });
    setLogMin("");
    setLogNote("");
  }

  const est = estimate.trim() === "" ? null : parseInt(estimate, 10) || 0;
  const over = est != null && spent > est;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] uppercase font-bold text-slate-500 flex items-center gap-1.5">
          <Timer className="size-3.5" /> Time
        </h4>
        <div className="text-[11px] text-slate-500">
          <span className={`font-semibold ${over ? "text-rose-600" : "text-slate-700"}`}>{fmtMinutes(spent)}</span>
          {est != null && <span> / {fmtMinutes(est)} est</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 items-end">
        <label className="block">
          <span className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Estimate (min)</span>
          <input
            type="number"
            min={0}
            value={estimate}
            onChange={(e) => setEstimate(e.target.value)}
            onBlur={saveEstimate}
            placeholder="e.g. 90"
            className="input-base h-8 text-xs bg-white"
          />
        </label>
        <div>
          {runningSince ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => post("stop")}
              className="w-full h-8 text-xs rounded-md bg-rose-600 text-white font-semibold flex items-center justify-center gap-1.5 hover:brightness-110"
            >
              <Square className="size-3.5" /> Stop · {runningMin}:{String(runningSec).padStart(2, "0")}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => post("start")}
              className="w-full h-8 text-xs rounded-md bg-brand-cyan text-white font-semibold flex items-center justify-center gap-1.5 hover:brightness-110"
            >
              <Play className="size-3.5" /> Start timer
            </button>
          )}
        </div>
      </div>

      {/* Manual log */}
      <div className="flex gap-2">
        <input
          type="number"
          min={1}
          value={logMin}
          onChange={(e) => setLogMin(e.target.value)}
          placeholder="min"
          className="input-base h-8 text-xs w-16 bg-white"
        />
        <input
          value={logNote}
          onChange={(e) => setLogNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addManual(); } }}
          placeholder="What did you work on? (optional)"
          className="input-base h-8 text-xs flex-1 bg-white"
        />
        <button type="button" onClick={addManual} disabled={busy || !logMin} className="btn-secondary text-xs px-2.5 disabled:opacity-50" aria-label="Log time">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
        </button>
      </div>

      {logs.length > 0 && (
        <ul className="space-y-1 max-h-40 overflow-y-auto pr-1 scrollbar-thin">
          {logs.map((l) => (
            <li key={l.id} className="text-[11px] text-slate-600 flex items-center gap-2 border-b border-slate-50 pb-1">
              <span className="font-semibold text-slate-700 tabular-nums w-12 shrink-0">{fmtMinutes(l.minutes)}</span>
              <span className="truncate flex-1">{l.note || <span className="text-slate-400">—</span>}</span>
              <span className="text-slate-400 shrink-0">{l.userName ?? ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
