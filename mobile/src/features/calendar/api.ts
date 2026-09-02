/**
 * Calendar data — GET /api/calendar?month=YYYY-MM (reuses getCalendarItems, same
 * as web). Returns dated items (tasks, meetings, reviews, follow-ups, birthdays,
 * renewals…) for the month, scoped to the viewer's book.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

export interface CalendarItem {
  id: string;
  kind: string;
  date: string; // YYYY-MM-DD
  at: string | null; // ISO datetime, or null = all-day
  title: string;
  href: string;
  subjectType?: "investor" | "lead";
  avatarUrl?: string | null;
}

export interface CalendarFeed {
  month: string;
  monthLabel: string;
  from: string;
  to: string;
  items: CalendarItem[];
}

export function useCalendar(month: string) {
  return useQuery({
    queryKey: ["calendar", month],
    queryFn: () => api.get<CalendarFeed>("/api/calendar", { month }),
    staleTime: 60_000,
  });
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function currentMonth(): string {
  // Avoid argless Date in shared code paths is fine here (client runtime).
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** The 6 kinds getCalendarItems produces — mirrors the web InteractiveCalendar
 *  KIND_META (label + icon + colour). Drives the filter legend + day dots. */
export const CALENDAR_KINDS: { value: string; label: string; icon: string; color: string }[] = [
  { value: "task", label: "Task", icon: "check-square", color: "#D97706" },
  { value: "follow_up", label: "Follow-up", icon: "phone-call", color: "#2563EB" },
  { value: "review", label: "Review", icon: "users", color: "#7C3AED" },
  { value: "sip", label: "SIP", icon: "repeat", color: "#16A34A" },
  { value: "campaign", label: "Campaign", icon: "send", color: "#DB2777" },
  { value: "compliance", label: "Compliance", icon: "shield", color: "#E11D48" },
];
export const kindLabel = (k: string) => CALENDAR_KINDS.find((x) => x.value === k)?.label ?? k.replace(/_/g, " ");

const KIND_ICON: Record<string, string> = {
  task: "check-square",
  meeting: "users",
  review: "users",
  review_meeting: "users",
  follow_up: "phone-call",
  birthday: "gift",
  anniversary: "gift",
  renewal: "shield",
  kyc: "shield",
  compliance: "shield",
  campaign: "send",
  sip: "repeat",
};
export const kindIcon = (k: string) => KIND_ICON[k] ?? "calendar";

const KIND_COLOR: Record<string, string> = {
  task: "#D97706",
  meeting: "#7C3AED",
  review_meeting: "#7C3AED",
  review: "#7C3AED",
  follow_up: "#2563EB",
  birthday: "#DB2777",
  anniversary: "#DB2777",
  renewal: "#16A34A",
  sip: "#16A34A",
  campaign: "#DB2777",
  compliance: "#E11D48",
};
export const kindColor = (k: string) => KIND_COLOR[k] ?? "#64748B";
