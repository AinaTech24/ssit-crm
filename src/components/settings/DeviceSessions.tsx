"use client";

/**
 * "Your devices" — lists the current user's active login sessions (device name,
 * IP, last seen, online dot) with a per-device log-out button. Backed by
 * /api/me/devices (GET) and /api/me/devices/[id] (DELETE).
 */

import { useEffect, useState } from "react";
import { Loader2, LogOut, Monitor, Smartphone, ShieldCheck } from "lucide-react";

type Device = {
  id: string;
  deviceName: string | null;
  ipAddress: string | null;
  lastSeenAt: string;
  createdAt: string;
  current: boolean;
};

const ONLINE_MS = 5 * 60 * 1000;

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function DeviceSessions() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    // Self-heal: make sure THIS device is tracked (sessions issued before the
    // feature shipped have no row). If we just registered, the cookie was
    // re-issued with a sid — reload once so this device is correctly badged.
    try {
      const reg = await fetch("/api/me/session/register", { method: "POST" });
      const rj = await reg.json().catch(() => ({}));
      if (rj?.registered) {
        window.location.reload();
        return;
      }
    } catch {
      /* non-fatal — still try to load the list */
    }
    try {
      const r = await fetch("/api/me/devices");
      const j = await r.json().catch(() => ({}));
      setDevices(j.devices ?? []);
    } catch {
      setDevices([]);
    }
  }
  useEffect(() => {
    load();
    // Light refresh so the online dots + last-seen stay current.
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  async function logout(id: string, deviceName: string | null) {
    // Confirm before revoking — a per-device sign-out is destructive (that
    // device has to log in again).
    if (!window.confirm(`Sign out "${deviceName || "this device"}"? It will need to log in again.`)) return;
    setBusy(id);
    try {
      await fetch(`/api/me/devices/${id}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {devices === null ? (
        <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" /> Loading…</div>
      ) : devices.length === 0 ? (
        <div className="text-xs text-muted-foreground">No active sessions found.</div>
      ) : (
        <ul className="space-y-1.5">
          {devices.map((d) => {
            const online = Date.now() - new Date(d.lastSeenAt).getTime() < ONLINE_MS;
            const isMobile = /iOS|Android/i.test(d.deviceName ?? "");
            const Icon = isMobile ? Smartphone : Monitor;
            return (
              <li key={d.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                <div className="relative">
                  <Icon className="size-4 text-muted-foreground" />
                  <span className={`absolute -right-1 -bottom-1 size-2 rounded-full ring-2 ring-card ${online ? "bg-emerald-500" : "bg-slate-300"}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate flex items-center gap-1.5">
                    {d.deviceName || "Unknown device"}
                    {d.current && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1 py-0.5">
                        <ShieldCheck className="size-2.5" /> This device
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {d.ipAddress || "IP unknown"} · {online ? "online now" : `last active ${relTime(d.lastSeenAt)}`}
                  </div>
                </div>
                {!d.current && (
                  <button
                    onClick={() => logout(d.id, d.deviceName)}
                    disabled={busy === d.id}
                    title="Log out this device"
                    aria-label="Log out this device"
                    className="shrink-0 text-muted-foreground hover:text-rose-600 disabled:opacity-50 p-1.5 rounded-md hover:bg-rose-50"
                  >
                    {busy === d.id ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
