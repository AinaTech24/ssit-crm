"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogIn, LogOut } from "lucide-react";
import { fmtMinutes } from "@/lib/attendance/policy";
import { isClockedIn, punchesOf } from "@/lib/attendance/punches";

type Today = {
  clock_in_at: string | null;
  clock_out_at: string | null;
  total_minutes: number | null;
  punches?: Array<{ in: string; out: string | null }> | null;
  status: string | null;
} | null;

function hhmm(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export function ClockWidget({ today }: { today: Today }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const sessions = punchesOf(today);
  const running = isClockedIn(sessions);

  /** Best-effort browser geolocation (3s timeout); resolves null if denied. */
  function getGeo(): Promise<{ lat: number; lng: number } | null> {
    return new Promise((resolve) => {
      if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 3000, maximumAge: 60000 }
      );
    });
  }

  async function punch(action: "in" | "out") {
    setBusy(true);
    try {
      const geo = await getGeo();
      const res = await fetch("/api/attendance/clock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...(geo ? { lat: geo.lat, lng: geo.lng } : {}) }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error ?? "Punch failed"); return; }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-surface p-4 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4 text-sm flex-wrap">
          <span className="font-semibold">My attendance — today</span>
          <span className="text-muted-foreground">In <b className="text-foreground tabular-nums">{hhmm(today?.clock_in_at ?? null)}</b></span>
          <span className="text-muted-foreground">Out <b className="text-foreground tabular-nums">{running ? "—" : hhmm(today?.clock_out_at ?? null)}</b></span>
          {today?.total_minutes != null && <span className="text-muted-foreground">Worked <b className="text-foreground">{fmtMinutes(today.total_minutes)}</b></span>}
        </div>
        <div className="flex items-center gap-2">
          {!running && (
            <button onClick={() => punch("in")} disabled={busy} className="btn-primary text-sm inline-flex items-center gap-1">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
              {sessions.length ? "Clock in again" : "Clock in"}
            </button>
          )}
          {running && (
            <button onClick={() => punch("out")} disabled={busy} className="btn-accent text-sm inline-flex items-center gap-1">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />} Clock out
            </button>
          )}
        </div>
      </div>
      {sessions.length > 1 && (
        <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
          {sessions.map((s, i) => (
            <span key={i} className="rounded bg-secondary px-2 py-0.5 tabular-nums">
              {hhmm(s.in)} → {s.out ? hhmm(s.out) : "now"}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
