/**
 * Daily Job Tracker — the MFD's plan-and-reflect ritual. GET/POST
 * /api/daily-tracker?date=. The morning side is "Today's focus" (a short list
 * of priorities, each optionally tagged client/lead/other); the evening side is
 * a key learning + one breakthrough + one breakdown. Task context (completed
 * yesterday, carried-over, due today, productivity %) is auto-derived server-side.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

export type FocusItem = { text: string; taskId?: string; done?: boolean; forType?: "client" | "lead" | "other" };

export interface DailyTracker {
  date: string;
  keyLearning: string;
  breakdown: string;
  breakthrough: string;
  todayFocus: FocusItem[];
  completedYesterday: { id: string; title: string; for: string | null; at: string | null }[];
  incompleteCarried: { id: string; title: string; dueAt: string | null; priority: string }[];
  dueToday: { id: string; title: string; priority: string; for: string | null }[];
  productivityPct: number;
}

export interface SaveTrackerBody {
  date: string;
  keyLearning: string;
  breakdown: string;
  breakthrough: string;
  todayFocus: FocusItem[];
}

/** Local YYYY-MM-DD (never toISOString — shifts the day in IST). */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function useDailyTracker(date: string) {
  return useQuery({
    queryKey: ["daily-tracker", date],
    queryFn: () => api.get<DailyTracker>("/api/daily-tracker", { date }),
    staleTime: 30_000,
  });
}

export function useSaveDailyTracker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveTrackerBody) => api.post<{ ok: boolean }>("/api/daily-tracker", body),
    onSuccess: (_r, body) => qc.invalidateQueries({ queryKey: ["daily-tracker", body.date] }),
  });
}
