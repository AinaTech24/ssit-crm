"use client";

/**
 * Bottom-right pop-ups for what needs attention now: tasks, meetings and
 * follow-ups that are due, plus notifications that just arrived (a note added on
 * one of your clients, a task assigned to you…).
 *
 * Each pop-up shows once per item per day — dismissing it, or opening it, is
 * remembered in localStorage so a refresh does not bring the same card back.
 * Storage can be blocked (private window); then the pop-ups simply repeat per
 * page load, which is noisy but never wrong.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CalendarClock, CheckSquare, PhoneCall, X } from "lucide-react";

type Popup = {
  key: string;
  kind: "task" | "meeting" | "followup" | "notice";
  title: string;
  detail: string;
  href: string;
};

const SEEN_KEY = "popup-alerts-seen-v1";
const MAX_VISIBLE = 4;

const todayStamp = () => new Date().toISOString().slice(0, 10);

function loadSeen(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}");
    return new Set<string>(raw.day === todayStamp() ? (raw.keys ?? []) : []);
  } catch {
    return new Set();
  }
}
function saveSeen(seen: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify({ day: todayStamp(), keys: [...seen].slice(-300) }));
  } catch {
    /* storage blocked — pop-ups repeat per load */
  }
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" });

const ICON = { task: CheckSquare, meeting: CalendarClock, followup: PhoneCall, notice: Bell } as const;
const LABEL = { task: "Task due", meeting: "Meeting soon", followup: "Follow-up due", notice: "Update" } as const;
// One theme token for every kind — the icon already says which kind it is.
const TONE = {
  task: "text-primary",
  meeting: "text-primary",
  followup: "text-primary",
  notice: "text-primary",
} as const;

export function PopupAlerts() {
  const pathname = usePathname();
  const seen = useRef<Set<string>>(new Set());
  const [queue, setQueue] = useState<Popup[]>([]);
  const ready = useRef(false);

  const dismiss = useCallback((key: string) => {
    seen.current.add(key);
    saveSeen(seen.current);
    setQueue((q) => q.filter((p) => p.key !== key));
  }, []);

  const poll = useCallback(async () => {
    if (!ready.current) return;
    const found: Popup[] = [];
    try {
      const [rem, notif] = await Promise.all([
        fetch("/api/reminders", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
        fetch("/api/notifications?unreadOnly=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      ]);
      for (const t of rem?.tasks ?? []) {
        const overdue = new Date(t.due_at).getTime() < Date.now();
        found.push({
          key: `task-${t.id}`,
          kind: "task",
          title: t.title,
          detail: `${overdue ? "Overdue since" : "Due"} ${fmtTime(t.due_at)}`,
          href: "/dashboard/tasks",
        });
      }
      for (const m of rem?.meetings ?? []) {
        found.push({
          key: `meeting-${m.id}`,
          kind: "meeting",
          title: m.subject || (m.party ? `Meeting with ${m.party}` : "Meeting"),
          detail: `${m.party ? `${m.party} · ` : ""}${fmtTime(m.meeting_date)}`,
          href: `/dashboard/review-meetings/${m.id}`,
        });
      }
      for (const f of rem?.followUps ?? []) {
        found.push({
          key: `followup-${f.id}`,
          kind: "followup",
          title: f.title,
          detail: `Follow-up ${new Date(f.at).getTime() < Date.now() ? "was due" : "due"} ${fmtTime(f.at)}`,
          href: f.href,
        });
      }
      // Notifications that arrived in the last 15 minutes, so opening the app
      // after a week away does not throw a week of old news at the corner.
      for (const n of notif?.notifications ?? []) {
        if (n.readAt || Date.now() - new Date(n.createdAt).getTime() > 15 * 60_000) continue;
        if (n.kind === "birthday_today") continue;
        found.push({
          key: `notice-${n.id}`,
          kind: "notice",
          title: n.title,
          detail: n.body ?? "",
          href: n.linkUrl ?? "/dashboard",
        });
      }
    } catch {
      return; // transient — the next poll retries
    }
    const fresh = found.filter((p) => !seen.current.has(p.key));
    setQueue((q) => {
      const have = new Set(q.map((p) => p.key));
      return [...q, ...fresh.filter((p) => !have.has(p.key))].slice(0, 12);
    });
  }, []);

  useEffect(() => {
    seen.current = loadSeen();
    ready.current = true;
    void poll();
    const i = setInterval(() => void poll(), 60_000);
    return () => clearInterval(i);
  }, [poll]);

  // Opening a page that deals with the item is as good as dismissing it.
  useEffect(() => {
    setQueue((q) => q.filter((p) => p.href !== pathname));
  }, [pathname]);

  const visible = queue.slice(0, MAX_VISIBLE);
  if (visible.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {visible.map((p) => {
        const Icon = ICON[p.kind];
        return (
          <div key={p.key} className="rounded-lg border bg-card p-3 shadow-lg">
            <div className="flex items-start gap-2.5">
              <Icon className={`mt-0.5 size-4 shrink-0 ${TONE[p.kind]}`} />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{LABEL[p.kind]}</div>
                <Link
                  href={p.href}
                  onClick={() => dismiss(p.key)}
                  className="block truncate text-sm font-medium hover:underline"
                  title={p.title}
                >
                  {p.title}
                </Link>
                {p.detail && <div className="line-clamp-2 text-xs text-muted-foreground">{p.detail}</div>}
              </div>
              <button
                type="button"
                onClick={() => dismiss(p.key)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="Dismiss"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        );
      })}
      {queue.length > MAX_VISIBLE && (
        <div className="text-right text-[11px] text-muted-foreground">+{queue.length - MAX_VISIBLE} more</div>
      )}
    </div>
  );
}
