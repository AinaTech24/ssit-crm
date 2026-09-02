/**
 * Home dashboard data — GET /api/dashboard/home (the mobile JSON we added for
 * the role cockpits). KPI cards + a Today worklist of actionable counts.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

export interface Kpi {
  key: string;
  label: string;
  value: number;
  format: "number" | "inr";
}

export interface WorklistItem {
  key: string;
  label: string;
  count: number;
  icon: string;
  tone: "danger" | "warning" | "info" | "success" | "neutral";
  href: string;
}

export interface DashboardHome {
  scope: "firm" | "me";
  kpis: Kpi[];
  worklist: WorklistItem[];
}

export function useDashboardHome() {
  return useQuery({
    queryKey: ["dashboard-home"],
    queryFn: () => api.get<DashboardHome>("/api/dashboard/home"),
    staleTime: 60_000,
  });
}

// ── "My Day" — the field salesperson's daily driver (actual items, not counts) ──
export interface DayMeeting {
  id: string;
  at: string | null;
  subject: string | null;
  meeting_type: string | null;
  meeting_mode: string | null;
  status: string | null;
  client_name: string | null;
  phone: string | null;
  investor_id: string | null;
  lead_id: string | null;
}
export interface DayFollowup { id: string; name: string | null; phone: string | null; stage: string | null; next_follow_up_at: string | null; overdue: boolean }
export interface DayTask { id: string; title: string | null; due_at: string | null; priority: string | null; overdue: boolean }
/** One day in the Home week strip — counts for the dots. */
export interface AgendaDay { date: string; meetings: number; followups: number; tasks: number }
export interface Touchpoint {
  id: string;
  name: string | null;
  phone: string | null;
  whatsapp_phone: string | null;
  at: string | null; // the dob / onboarded date
  kind: "birthday" | "anniversary";
  days_until: number;
  years: number | null;
}
export interface MyDay {
  scope: "firm" | "me";
  date: string | null;
  meetings: DayMeeting[];
  followups: DayFollowup[];
  tasks: DayTask[];
  touchpoints: Touchpoint[];
  agenda: AgendaDay[];
}

/** `date` = YYYY-MM-DD. Omit for today. */
export function useMyDay(date?: string) {
  return useQuery({
    queryKey: ["my-day", date ?? "today"],
    queryFn: () => api.get<MyDay>("/api/dashboard/my-day", date ? { date } : undefined),
    staleTime: 60_000,
    // Keep the previous day's plan on screen while the next one loads — tapping
    // through the week strip shouldn't flash a skeleton each time.
    placeholderData: (prev) => prev,
  });
}

/** Local YYYY-MM-DD (never toISOString — that shifts the day in IST). */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── "My numbers" — targets vs achievement (same engine as the web scorecard) ──
export interface PerfKpi { key: string; label: string; actual: number; unit: "inr" | "count" | "pct"; score: number; weight: number; target?: number }
export interface PerfMember { userId: string; name: string; kraScore: number; band: "green" | "amber" | "red"; kpis: PerfKpi[] }
export interface MyPerformance {
  from: string;
  to: string;
  me: PerfMember | null;
  today: { calls: number; meetings: number; tasks: number };
  rank: number | null;
  outOf: number | null;
  leaderboard: { userId: string; name: string; kraScore: number; band: "green" | "amber" | "red" }[];
}

export function useMyPerformance() {
  return useQuery({
    queryKey: ["my-performance"],
    queryFn: () => api.get<MyPerformance>("/api/dashboard/my-performance"),
    staleTime: 120_000,
  });
}
