"use client";

/**
 * Notification history — the full list behind the topbar bell. Reuses
 * GET /api/notifications (latest 50 + live birthday reminder) and
 * POST /api/notifications/mark-read. Filters are client-side: severity chips +
 * unread-only toggle.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell, Check, Loader2, Cake } from "lucide-react";

type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  severity: "info" | "success" | "warning" | "critical";
  readAt: string | null;
  createdAt: string;
};

const SEV_TONE: Record<string, string> = {
  info: "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/50 dark:text-sky-200 dark:border-sky-900",
  success: "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-900",
  warning: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-900",
  critical: "bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-200 dark:border-rose-900",
};

const SEVERITIES = ["all", "info", "success", "warning", "critical"] as const;

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [sev, setSev] = useState<(typeof SEVERITIES)[number]>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/notifications${unreadOnly ? "?unreadOnly=1" : ""}`);
      const j = await res.json().catch(() => ({}));
      setItems(Array.isArray(j.notifications) ? j.notifications : Array.isArray(j.list) ? j.list : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadOnly]);

  async function markAllRead() {
    await fetch("/api/notifications/mark-read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => {});
    void load();
  }

  const visible = useMemo(
    () => (sev === "all" ? items : items.filter((n) => n.severity === sev)),
    [items, sev]
  );

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Bell className="size-6" /> Notifications
        </h1>
        <button onClick={markAllRead} className="btn-secondary text-xs">
          <Check className="size-3.5" /> Mark all read
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {SEVERITIES.map((s) => (
          <button
            key={s}
            onClick={() => setSev(s)}
            className={`chip text-xs capitalize ${sev === s ? "bg-brand-cyan text-white" : "bg-secondary text-muted-foreground"}`}
          >
            {s}
          </button>
        ))}
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none ml-2">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
            className="size-3.5 rounded border-border accent-brand-cyan"
          />
          Unread only
        </label>
      </div>

      <div className="overflow-y-auto scrollbar-none max-h-[calc(100vh-14rem)] -mx-1 px-1">
      {loading ? (
        <div className="card-surface p-8 grid place-items-center text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin mb-2" /> Loading…
        </div>
      ) : visible.length === 0 ? (
        <div className="card-surface p-10 text-center text-sm text-muted-foreground">
          No notifications{sev !== "all" ? ` with severity “${sev}”` : ""}{unreadOnly ? " (unread)" : ""}.
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((n) => {
            const inner = (
              <div
                className={`rounded-xl border p-3.5 flex items-start gap-3 transition-colors ${
                  n.readAt ? "border-border bg-card opacity-75" : "border-border bg-card shadow-sm"
                } ${n.linkUrl ? "hover:border-brand-cyan/50" : ""}`}
              >
                <span className={`mt-0.5 shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${SEV_TONE[n.severity] ?? SEV_TONE.info}`}>
                  {n.severity}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium flex items-center gap-1.5">
                    {n.kind === "birthday_today" && <Cake className="size-3.5 text-violet-500" />}
                    {n.title}
                    {!n.readAt && <span className="size-1.5 rounded-full bg-brand-cyan inline-block" aria-label="unread" />}
                  </div>
                  {n.body && <p className="text-xs text-muted-foreground mt-0.5 break-words">{n.body}</p>}
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {new Date(n.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                  </div>
                </div>
              </div>
            );
            return (
              <li key={n.id}>
                {n.linkUrl ? <Link href={n.linkUrl}>{inner}</Link> : inner}
              </li>
            );
          })}
        </ul>
      )}
      </div>
    </div>
  );
}
