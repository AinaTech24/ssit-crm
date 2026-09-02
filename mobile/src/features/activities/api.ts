/**
 * Activities ("Calls") data layer — the unified interaction log (calls / visits /
 * notes / etc.). GET /api/activities returns snake_case rows + a KPI ribbon;
 * POST logs one; PATCH/DELETE /api/activities/[id] edit/remove. Dedicated module
 * (converted from the broken registry entry — the registry read camelCase but
 * the API is snake_case, so names/times rendered blank).
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { queuedPost } from "../../lib/offlineQueue";
import type { Tone } from "../../theme";

export interface Activity {
  id: string;
  subject_type: "investor" | "lead" | "family" | null;
  subject_id: string | null;
  subject_name: string | null;
  subject_phone: string | null;
  kind: string | null;
  direction: string | null;
  status: string | null; // outcome
  subject: string | null; // one-line summary
  notes: string | null;
  occurred_at: string | null;
  duration_sec: number | null;
  location_label: string | null;
  next_followup_at: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  [key: string]: any;
}

export interface ActivityStats { total: number; calls_today: number; visits_week: number; followups_due: number }

export interface ActivityFilters {
  q?: string;
  kind?: string; // csv
  mine?: string; // "1"
  from?: string; // yyyy-mm-dd
  to?: string;
}

export function useActivities(filters: ActivityFilters = {}) {
  return useQuery({
    queryKey: ["activities", filters],
    queryFn: () => api.get<{ activities: Activity[]; stats: ActivityStats }>("/api/activities", {
      q: filters.q || undefined,
      kind: filters.kind || undefined,
      mine: filters.mine || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
    }),
  });
}

/** One activity's full detail (GET /api/activities/[id]). */
export function useActivity(id: string) {
  return useQuery({
    queryKey: ["activity", id],
    queryFn: () => api.get<Activity>(`/api/activities/${id}`),
    enabled: !!id,
  });
}

/** A client/lead's interaction timeline — all activities for one subject. */
export function useActivityTimeline(subjectType?: string | null, subjectId?: string | null) {
  return useQuery({
    queryKey: ["activity-timeline", subjectType, subjectId],
    queryFn: () => api.get<{ activities: Activity[] }>("/api/activities", { subjectType: subjectType || undefined, subjectId: subjectId || undefined }).then((r) => r.activities),
    enabled: !!subjectType && !!subjectId,
    staleTime: 30_000,
  });
}

/**
 * Logging an interaction is the write most likely to happen with no signal (a
 * client's basement, a lift, a village branch), so it goes through the offline
 * queue: sent immediately when online, persisted and replayed when not.
 * Resolves to null when queued — callers should treat that as success.
 */
export function useLogActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, any>) => queuedPost<{ id: string }>("/api/activities", body, "Activity log"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["activities"] }),
  });
}

export function useUpdateActivity(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, any>) => api.patch(`/api/activities/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["activities"] });
      qc.invalidateQueries({ queryKey: ["activity", id] });
      qc.invalidateQueries({ queryKey: ["activity-timeline"] });
    },
  });
}

export function useDeleteActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/activities/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["activities"] }),
  });
}

// ── Enums / metadata (mirror src/db/schema/activities.ts) ──
export const ACTIVITY_KINDS: { value: string; label: string; icon: string; tone: Tone }[] = [
  { value: "call", label: "Call", icon: "phone", tone: "info" },
  { value: "visit", label: "Visit", icon: "map-pin", tone: "violet" },
  { value: "note", label: "Note", icon: "file-text", tone: "neutral" },
  { value: "whatsapp", label: "WhatsApp", icon: "message-circle", tone: "success" },
  { value: "email", label: "Email", icon: "mail", tone: "info" },
  { value: "sms", label: "SMS", icon: "message-square", tone: "neutral" },
  { value: "other", label: "Other", icon: "activity", tone: "neutral" },
];
export const kindMeta = (k?: string | null) => ACTIVITY_KINDS.find((x) => x.value === k) ?? { value: k ?? "", label: k ? k.replace(/_/g, " ") : "—", icon: "activity", tone: "neutral" as Tone };

export const ACTIVITY_DIRECTIONS = [
  { value: "outbound", label: "Outbound" },
  { value: "inbound", label: "Inbound" },
];

export const ACTIVITY_OUTCOMES: { value: string; label: string; tone: Tone }[] = [
  { value: "completed", label: "Completed", tone: "success" },
  { value: "answered", label: "Answered", tone: "success" },
  { value: "no_answer", label: "No answer", tone: "warning" },
  { value: "busy", label: "Busy", tone: "warning" },
  { value: "failed", label: "Failed", tone: "danger" },
  { value: "left_voicemail", label: "Left voicemail", tone: "info" },
  { value: "no_show", label: "No-show", tone: "danger" },
];
export const outcomeBadge = (s?: string | null): { label: string; tone: Tone } => {
  const o = ACTIVITY_OUTCOMES.find((x) => x.value === s);
  return o ? { label: o.label, tone: o.tone } : { label: s ? s.replace(/_/g, " ") : "", tone: "neutral" };
};
