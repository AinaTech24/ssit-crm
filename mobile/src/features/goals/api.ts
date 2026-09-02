/**
 * Goals data layer — the dedicated module (converted from the old registry
 * entry). GET /api/goals returns FLAT rows + a KPI ribbon; GET /api/goals/[id]/full
 * bundles the goal + investor + folios + active SIPs for the linked-investments
 * picker. Numerics come back as strings (numeric columns) — coerce with Number().
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { Tone } from "../../theme";

export interface Goal {
  id: string;
  investorId: string;
  name: string;
  category: string;
  targetAmount: string | number;
  targetDate: string;
  targetMode: string | null;
  presentTargetAmount: string | number | null;
  inflationPct: string | number | null;
  stepUpPct: string | number | null;
  currentValue: string | number | null;
  progressPct: string | number | null;
  expectedProgressPct: string | number | null;
  requiredMonthlySip: string | number | null;
  existingMonthlySip: string | number | null;
  monthlyContribution: string | number | null;
  gapAmount: string | number | null;
  expectedReturn: string | number | null;
  glidePath: string | null;
  status: string;
  nextReviewAt: string | null;
  remarks: string | null;
  linkedFolios?: string[] | null;
  linkedSips?: string[] | null;
  folioAllocations?: { folioId: string; allocationPct: number }[] | null;
  sipAllocations?: { sipId: string; allocationPct: number }[] | null;
  investorName?: string | null;
  investorAvatarUrl?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  [key: string]: any;
}

export interface GoalStats {
  total: number;
  on_track: number;
  behind: number;
  achieved: number;
  not_started: number;
  reviews_overdue: number;
}

export interface GoalFolio { id: string; amcName: string | null; folioNumber: string | null; aum: string | number | null }
export interface GoalSip { id: string; schemeName: string | null; amcName: string | null; amount: string | number | null; frequency: string | null; status: string | null }
export interface GoalFull {
  goal: Goal;
  investor: { id: string; name: string | null; pan: string | null; phone: string | null; whatsappPhone: string | null; email: string | null } | null;
  folios: GoalFolio[];
  sips: GoalSip[];
}

export interface GoalFilters {
  q?: string;
  status?: string; // csv
  sort?: "target_date_asc" | "target_date_desc" | "target_amount_desc" | "target_amount_asc";
}

export function useGoals(filters: GoalFilters = {}) {
  return useQuery({
    queryKey: ["goals", filters],
    queryFn: () => api.get<{ goals: Goal[]; stats: GoalStats }>("/api/goals", {
      q: filters.q || undefined,
      status: filters.status || undefined,
      sort: filters.sort || undefined,
    }),
  });
}

export function useGoalFull(id?: string) {
  return useQuery({
    queryKey: ["goal-full", id],
    enabled: !!id,
    queryFn: () => api.get<GoalFull>(`/api/goals/${id}/full`),
    staleTime: 15_000,
  });
}

function invalidateGoal(qc: ReturnType<typeof useQueryClient>, id: string) {
  qc.invalidateQueries({ queryKey: ["goal-full", id] });
  qc.invalidateQueries({ queryKey: ["goals"] });
}

/** PATCH a goal (assumptions edit or linked-investments). Server recomputes. */
export function usePatchGoal(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, any>) => api.patch<{ ok: boolean }>(`/api/goals/${id}`, body),
    onSuccess: () => invalidateGoal(qc, id),
  });
}

/** Recompute from live linked folios/SIPs. */
export function useRecomputeGoal(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean; goal: Goal }>(`/api/goals/${id}/recompute`, {}),
    onSuccess: () => invalidateGoal(qc, id),
  });
}

export function useDeleteGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/goals/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}

// ── Enums / metadata (mirror src/db/schema/goals.ts + calc.ts) ──
export const GOAL_CATEGORIES: { value: string; label: string }[] = [
  { value: "retirement", label: "Retirement" },
  { value: "child_education", label: "Child Education" },
  { value: "child_marriage", label: "Child Marriage" },
  { value: "house", label: "House" },
  { value: "car", label: "Car" },
  { value: "vacation", label: "Vacation" },
  { value: "emergency_fund", label: "Emergency Fund" },
  { value: "wealth_creation", label: "Wealth Creation" },
  { value: "other", label: "Other" },
];
const CATEGORY_ALIASES: Record<string, string> = {
  education: "child_education", vehicle: "car", emergency: "emergency_fund", wedding: "child_marriage", wealth: "wealth_creation",
};
export function categoryLabel(slug?: string | null): string {
  const s = CATEGORY_ALIASES[slug ?? ""] ?? slug ?? "";
  return GOAL_CATEGORIES.find((c) => c.value === s)?.label ?? (slug ? slug.replace(/_/g, " ") : "—");
}

export const GLIDE_PATHS: { value: string; label: string }[] = [
  { value: "none", label: "None (return held)" },
  { value: "conservative", label: "Conservative (de-risk from 7y)" },
  { value: "moderate", label: "Moderate (de-risk from 5y)" },
  { value: "aggressive", label: "Aggressive (de-risk from 3y)" },
];

export const GOAL_STATUSES: { value: string; label: string; tone: Tone }[] = [
  { value: "not_started", label: "Not started", tone: "neutral" },
  { value: "on_track", label: "On track", tone: "success" },
  { value: "behind_track", label: "Behind track", tone: "warning" },
  { value: "achieved", label: "Achieved", tone: "info" },
  { value: "active", label: "Active", tone: "neutral" },
  { value: "on_hold", label: "On hold", tone: "neutral" },
  { value: "abandoned", label: "Abandoned", tone: "danger" },
];
export function goalStatusBadge(status?: string | null): { label: string; tone: Tone } {
  const s = GOAL_STATUSES.find((x) => x.value === status);
  return s ? { label: s.label, tone: s.tone } : { label: status ? status.replace(/_/g, " ") : "—", tone: "neutral" };
}
