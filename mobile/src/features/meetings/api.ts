/**
 * Review Meetings data layer — full web-parity filter/sort set + stats ribbon.
 *
 *   GET   /api/review-meetings            → { meetings[], stats }
 *   GET   /api/review-meetings/[id]       → meeting bundle (+ prep brief)
 *   PATCH /api/review-meetings/[id]       → status / notes / action items / reschedule
 *   DELETE/api/review-meetings/[id]       → cancel (status='cancelled')
 *
 * The list GET returns snake_case (raw SQL), so the Meeting interface is
 * snake_case; the PATCH/POST bodies stay camelCase (Zod-validated server-side).
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { Tone } from "../../theme";

export interface Meeting {
  id: string;
  subject: string | null;
  meeting_type: string | null;
  category: string | null;
  meeting_date: string | null;
  duration_minutes: string | null;
  meeting_mode: string | null;
  location_or_link: string | null;
  status: string | null;
  outcome: string | null;
  outcome_notes: string | null;
  discussion_points: string | null;
  meeting_notes: string | null;
  action_items?: any[] | null;
  attendees?: any[] | null;
  attachments?: any[] | null;
  next_review_date?: string | null;
  reschedule_count?: number | null;
  follow_up_task_created?: string | null;
  investor_id: string | null;
  lead_id: string | null;
  family_id: string | null;
  rm_id: string | null;
  // joined
  investor_name?: string | null;
  lead_name?: string | null;
  segment_tag?: string | null;
  investor_pan?: string | null;
  rm_name?: string | null;
  subject_name?: string | null;
  subject_kind?: "client" | "lead" | null;
  prep?: any | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: any;
}

export interface MeetingStats {
  upcoming: number;
  this_week: number;
  completed_mtd: number;
  overdue: number;
}

export interface MeetingFilters {
  q?: string;
  /** Comma-joined multi-selects. */
  category?: string;
  status?: string;
  mode?: string;
  type?: string;
  rm?: string;
  meeting_from?: string;
  meeting_to?: string;
  sort?: "meeting_asc" | "meeting_desc";
}

export function useMeetings(filters: MeetingFilters = {}) {
  return useQuery({
    queryKey: ["meetings", filters],
    queryFn: () =>
      api.get<{ meetings: Meeting[]; stats: MeetingStats }>("/api/review-meetings", {
        q: filters.q || undefined,
        category: filters.category || undefined,
        status: filters.status || undefined,
        mode: filters.mode || undefined,
        type: filters.type || undefined,
        rm: filters.rm || undefined,
        meeting_from: filters.meeting_from || undefined,
        meeting_to: filters.meeting_to || undefined,
        sort: filters.sort || undefined,
      }),
  });
}

export function useMeeting(id?: string) {
  return useQuery({
    queryKey: ["meeting", id],
    enabled: !!id,
    queryFn: () => api.get<Meeting>(`/api/review-meetings/${id}`),
    staleTime: 15_000,
  });
}

function invalidateMeeting(qc: ReturnType<typeof useQueryClient>, id: string) {
  qc.invalidateQueries({ queryKey: ["meeting", id] });
  qc.invalidateQueries({ queryKey: ["meetings"] });
}

/** PATCH a meeting — status / notes / discussion / action items / attendees /
 *  outcome / next review / reschedule. The server runs the completion chain. */
export function useUpdateMeeting(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, any>) => api.patch<{ ok: boolean; completed?: boolean }>(`/api/review-meetings/${id}`, body),
    onSuccess: () => invalidateMeeting(qc, id),
  });
}

/** Cancel a meeting (status → cancelled). */
export function useCancelMeeting(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del(`/api/review-meetings/${id}`),
    onSuccess: () => invalidateMeeting(qc, id),
  });
}

// ── Enums (mirror src/db/schema/review_meetings.ts) ──
export const MEETING_STATUSES = ["scheduled", "confirmed", "in_progress", "completed", "rescheduled", "cancelled", "no_show"];

export const MEETING_MODES = ["office", "client_place", "online", "phone"];

export const MEETING_CATEGORIES: { value: string; label: string }[] = [
  { value: "new", label: "New Meeting" },
  { value: "review", label: "Review Meeting" },
  { value: "follow_up", label: "Follow-up Meeting" },
];

export const MEETING_OUTCOMES: { value: string; label: string }[] = [
  { value: "ready", label: "Ready to proceed" },
  { value: "more_info", label: "Wants more info" },
  { value: "not_ready", label: "Not ready right now" },
  { value: "not_interested", label: "Not interested" },
  { value: "no_show", label: "No-show" },
];

export const MEETING_TYPES = [
  "portfolio_review", "goal_review", "service_discussion", "family_review", "complaint_discussion",
  "discovery_call", "new_client_kickoff", "new_investment_discussion", "product_demo", "sales_pitch",
  "follow_up_call", "follow_up_visit", "other",
];

export const ATTENDEE_ROLES: { value: string; label: string }[] = [
  { value: "rm", label: "RM (firm)" },
  { value: "investor", label: "Investor" },
  { value: "spouse", label: "Spouse" },
  { value: "family", label: "Family member" },
  { value: "ca", label: "CA / Tax advisor" },
  { value: "amc_rm", label: "AMC RM" },
  { value: "sub_distributor", label: "Sub-distributor" },
  { value: "back_office", label: "Back office" },
  { value: "compliance", label: "Compliance" },
  { value: "other", label: "Other" },
];

/** External unless the role is firm-internal (mirrors the web toggle). */
export const isExternalRole = (role: string) => !["rm", "back_office", "compliance"].includes(role);

export const OUTCOME_TONE: Record<string, Tone> = {
  ready: "success", more_info: "warning", not_ready: "neutral", not_interested: "danger", no_show: "danger",
};
