"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogIn, LogOut, CheckCircle2 } from "lucide-react";
import { fmtMinutes } from "@/lib/attendance/policy";

type Today = {
  clock_in_at: string | null;
  clock_out_at: string | null;
  total_minutes: number | null;
  status: string | null;
} | null;

function hhmm(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export function ClockWidget({ today }: { today: Today }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const inAt = today?.clock_in_at ?? null;
  const outAt = today?.clock_out_at ?? null;

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
    <div className="card-surface p-4 flex items-center justify-between flex-wrap gap-3">
      <div className="flex items-center gap-4 text-sm">
        <span className="font-semibold">My attendance — today</span>
        <span className="text-muted-foreground">In <b className="text-foreground tabular-nums">{hhmm(inAt)}</b></span>
        <span className="text-muted-foreground">Out <b className="text-foreground tabular-nums">{hhmm(outAt)}</b></span>
        {today?.total_minutes != null && <span className="text-muted-foreground">Worked <b className="text-foreground">{fmtMinutes(today.total_minutes)}</b></span>}
      </div>
      <div className="flex items-center gap-2">
        {!inAt && (
          <button onClick={() => punch("in")} disabled={busy} className="btn-primary text-sm inline-flex items-center gap-1">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />} Clock in
          </button>
        )}
        {inAt && !outAt && (
          <button onClick={() => punch("out")} disabled={busy} className="btn-accent text-sm inline-flex items-center gap-1">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />} Clock out
          </button>
        )}
        {inAt && outAt && (
          <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700 font-medium">
            <CheckCircle2 className="size-4" /> Done for today
          </span>
        )}
      </div>
    </div>
  );
}
