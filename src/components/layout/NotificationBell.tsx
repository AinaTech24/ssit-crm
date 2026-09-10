"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, AlertTriangle, CheckCircle2, Info, AlertOctagon, Cake } from "lucide-react";

type Notification = {
  id: string;
  kind: string;
  title: string;
  body?: string | null;
  linkUrl?: string | null;
  severity: "info" | "success" | "warning" | "critical";
  readAt?: string | null;
  createdAt: string;
};

const SEVERITY = {
  info: { icon: Info, color: "text-blue-600" },
  success: { icon: CheckCircle2, color: "text-emerald-600" },
  warning: { icon: AlertTriangle, color: "text-amber-600" },
  critical: { icon: AlertOctagon, color: "text-rose-600" },
} as const;

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const j = await res.json();
      setItems(j.notifications ?? []);
      setUnread(j.unreadCount ?? 0);
    } catch {
      /* transient — the next poll retries */
    }
  }, []);

  // Live feed. The server holds the connection open and writes only when this
  // user's unread count or newest notification actually changes, so a task
  // assigned to you lands in seconds instead of waiting out a poll.
  //
  // The 90s poll stays as a fallback, at a longer interval: EventSource is
  // unavailable in a few embedded webviews, and a corporate proxy can break
  // long-lived responses. Losing the stream should make the bell slow, not dead.
  useEffect(() => {
    void load();

    let es: EventSource | null = null;
    let live = false;
    try {
      es = new EventSource("/api/notifications/stream");
      es.addEventListener("notifications", () => {
        live = true;
        void load();
      });
      es.onerror = () => {
        // EventSource retries on its own; the poll below covers the gap.
        live = false;
      };
    } catch {
      es = null;
    }

    const i = setInterval(() => {
      // Skip the poll while the stream is healthy — it would only duplicate work.
      if (!live) void load();
    }, 90_000);

    return () => {
      es?.close();
      clearInterval(i);
    };
  }, [load]);

  // Refetch on open — without this, doing something in the app and immediately
  // checking the bell showed nothing until the next poll, which reads as
  // notifications not working at all.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Click-outside to close
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (open && ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function markAllRead() {
    try {
      const res = await fetch("/api/notifications/mark-read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      if (!res.ok) return; // leave the badge alone — nothing was actually read
      setItems((arr) => arr.map((n) => ({ ...n, readAt: new Date().toISOString() })));
      setUnread(0);
    } catch {
      /* keep the current state; the next poll reconciles */
    }
  }

  // Opening a notification dismisses it from the panel + marks it read on the
  // server.
  function openOne(n: Notification) {
    setItems((arr) => arr.filter((x) => x.id !== n.id));
    const isSynthetic = n.kind === "birthday_today";
    if (!n.readAt && !isSynthetic) setUnread((u) => Math.max(0, u - 1));
    // The birthday reminder is computed per-request, not a stored row — its id
    // ("birthday-today") isn't a uuid, so mark-read rejects the whole call with
    // a 400. Skip the request rather than firing one that can only fail.
    if (!isSynthetic) {
      fetch("/api/notifications/mark-read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [n.id] }),
      }).catch(() => {});
    }
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md p-1.5 hover:bg-accent"
        aria-label="Notifications"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 size-4 grid place-items-center rounded-full bg-rose-600 text-white text-[10px] font-semibold">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 border bg-card rounded-md shadow-lg w-80 max-h-[70vh] z-[60] flex flex-col overflow-hidden">
          <div className="border-b px-3 py-2 flex items-center justify-between flex-shrink-0 bg-card">
            <div className="font-medium text-sm">Notifications</div>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-primary hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-none">
          {items.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No notifications yet.</div>
          ) : (
            <ul className="divide-y">
              {items.map((n) => {
                // Today's-birthday reminder is a live, pinned nudge — distinct
                // look (cake + violet wash), a "Today" label, and no unread dot.
                const isBday = n.kind === "birthday_today";
                const Sev = SEVERITY[n.severity] ?? SEVERITY.info;
                const Icon = isBday ? Cake : Sev.icon;
                const Inner = (
                  <div className={`flex items-start gap-2 px-3 py-2 hover:bg-accent ${isBday ? "bg-violet-50/60 dark:bg-violet-950/40" : ""} ${!isBday && n.readAt ? "opacity-60" : ""}`}>
                    <Icon className={`size-4 mt-0.5 flex-shrink-0 ${isBday ? "text-violet-600" : Sev.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium leading-tight">{n.title}</div>
                      {n.body && <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.body}</div>}
                      <div className="text-[10px] text-muted-foreground mt-1">
                        {isBday
                          ? "Today · tap to wish them"
                          : new Date(n.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                      </div>
                    </div>
                    {!isBday && !n.readAt && <span className="size-1.5 rounded-full bg-primary mt-1.5" />}
                  </div>
                );
                return (
                  <li key={n.id}>
                    {n.linkUrl ? (
                      <Link href={n.linkUrl} onClick={() => openOne(n)}>{Inner}</Link>
                    ) : (
                      Inner
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          </div>
          <div className="border-t border-border px-3 py-2 text-center flex-shrink-0 bg-card">
            <Link
              href="/dashboard/notifications"
              onClick={() => setOpen(false)}
              className="text-xs font-medium text-brand-cyan-deep hover:underline"
            >
              View all notifications →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
