/**
 * Leads data layer. GET /api/leads (full web filter/sort set) + the bundled
 * GET /api/leads/[id]/full for the detail. Mutations: stage change, log activity,
 * convert-to-client, edit (via the form engine's PATCH), delete.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { Tone } from "../../theme";

export interface Lead {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  pan: string | null;
  city: string | null;
  source: string | null;
  stage: string | null;
  pipelineStage: string | null;
  score: string | number | null;
  leadScore: number | null;
  scoreBand: string | null;
  intendedAmount: string | null;
  expectedBusinessAmount: string | null;
  aumPotential?: string | null;
  leadType: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
  lastContactAt: string | null;
  nextFollowUpAt: string | null;
  followUpNotes?: string | null;
  convertedInvestorId: string | null;
  convertedAt: string | null;
  lostReason: string | null;
  notes: string | null;
  interestProducts?: string[] | null;
  tags?: string[] | null;
  createdAt?: string | null;
  [key: string]: any;
}

export interface LeadFilters {
  q?: string;
  /** Comma-joined multi-selects. */
  stage?: string;
  source?: string;
  owner?: string;
  created_from?: string;
  created_to?: string;
  sort?: "score" | "recent";
  dir?: "asc" | "desc";
  /** Quick-filter flags ("1" when on). */
  mine?: string;
  unassigned?: string;
  hot?: string;
  stuck?: string;
  followup_today?: string;
  followup_overdue?: string;
  new_week?: string;
}

export function useLeads(filters: LeadFilters) {
  return useQuery({
    queryKey: ["leads", filters],
    queryFn: () =>
      api.get<{ leads: Lead[]; total: number }>("/api/leads", {
        q: filters.q || undefined,
        stage: filters.stage || undefined,
        source: filters.source || undefined,
        owner: filters.owner || undefined,
        created_from: filters.created_from || undefined,
        created_to: filters.created_to || undefined,
        sort: filters.sort || undefined,
        dir: filters.dir || undefined,
        mine: filters.mine || undefined,
        unassigned: filters.unassigned || undefined,
        hot: filters.hot || undefined,
        stuck: filters.stuck || undefined,
        followup_today: filters.followup_today || undefined,
        followup_overdue: filters.followup_overdue || undefined,
        new_week: filters.new_week || undefined,
        limit: 400,
      }),
  });
}

export function useLead(id?: string) {
  return useQuery({ queryKey: ["lead", id], enabled: !!id, queryFn: () => api.get<Lead>(`/api/leads/${id}`) });
}

/** The bundled detail payload (lead + owner + tasks + comms + risk + proposal + stats). */
export function useLeadFull(id?: string) {
  return useQuery({
    queryKey: ["lead-full", id],
    enabled: !!id,
    queryFn: () => api.get<any>(`/api/leads/${id}/full`),
    staleTime: 20_000,
  });
}

function invalidateLead(qc: ReturnType<typeof useQueryClient>, id: string) {
  qc.invalidateQueries({ queryKey: ["lead-full", id] });
  qc.invalidateQueries({ queryKey: ["lead", id] });
  qc.invalidateQueries({ queryKey: ["leads"] });
}

/** Change stage (legacy /stage — no blueprint-seed dependency). Optional lostReason. */
export function useUpdateLeadStage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { stage: string; lostReason?: string }) =>
      v.lostReason ? api.patch(`/api/leads/${id}`, { stage: v.stage, lostReason: v.lostReason }) : api.post(`/api/leads/${id}/stage`, { stage: v.stage }),
    onSuccess: () => invalidateLead(qc, id),
  });
}

export function useLogActivity(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { note: string; activityType: string; nextFollowUpAt?: string }) => api.post(`/api/leads/${id}/notes`, v),
    onSuccess: () => invalidateLead(qc, id),
  });
}

export function useConvertLead(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { pan?: string; segmentTag?: string; investorCategory?: string; notes?: string }) =>
      api.post<{ investorId: string; alreadyConverted?: boolean }>(`/api/leads/${id}/convert`, v),
    onSuccess: () => invalidateLead(qc, id),
  });
}

export function useDeleteLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/leads/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}

// ── Stages (canonical 10 lead-phase blueprint stages, matching the web board) ──
export const LEAD_STAGES: { key: string; label: string; tone: Tone }[] = [
  { key: "new", label: "New", tone: "info" },
  { key: "call_done", label: "Call Done", tone: "info" },
  { key: "call_back_later", label: "Call Back Later", tone: "info" },
  { key: "call_not_connected", label: "Not Connected", tone: "neutral" },
  { key: "contact_in_future", label: "Contact in Future", tone: "neutral" },
  { key: "meeting_scheduled", label: "Meeting Scheduled", tone: "warning" },
  { key: "meeting_pending", label: "Meeting Pending", tone: "warning" },
  { key: "meeting_done", label: "Meeting Done", tone: "violet" },
  { key: "won_lead", label: "Won Lead", tone: "success" },
  { key: "not_qualified", label: "Not Qualified", tone: "danger" },
];

/** Legacy stage aliases fold onto the canonical key (so historic leads bucket right). */
const STAGE_ALIAS: Record<string, string> = {
  contacted: "call_done", first_call_pending: "call_done", follow_up: "contact_in_future",
  appointment_scheduled: "meeting_scheduled", qualified: "meeting_scheduled",
  converted: "won_lead", post_meeting_qualified: "won_lead",
  lost: "not_qualified", not_interested: "not_qualified", cold: "not_qualified",
};
export const canonicalStage = (s?: string | null): string => (s ? STAGE_ALIAS[s] ?? s : "new");
export const stageMeta = (s?: string | null) => LEAD_STAGES.find((x) => x.key === canonicalStage(s));

const STAGE_INDEX = new Map(LEAD_STAGES.map((s, i) => [s.key, i]));

/** Group leads into board columns in canonical stage order (all 10 shown). */
export function groupByStage(leads: Lead[]): { key: string; label: string; tone: Tone; leads: Lead[] }[] {
  const buckets = new Map<string, Lead[]>();
  for (const s of LEAD_STAGES) buckets.set(s.key, []);
  for (const l of leads) {
    const k = canonicalStage(l.stage);
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(l);
  }
  return Array.from(buckets.entries())
    .map(([key, ls]) => ({ key, label: stageMeta(key)?.label ?? key, tone: stageMeta(key)?.tone ?? "neutral", leads: ls }))
    .sort((a, b) => (STAGE_INDEX.get(a.key) ?? 99) - (STAGE_INDEX.get(b.key) ?? 99));
}

/** Client-side search fallback (name/phone/email/city). */
export function filterLeads(leads: Lead[], q: string): Lead[] {
  const s = q.trim().toLowerCase();
  if (!s) return leads;
  return leads.filter((l) => `${l.name ?? ""} ${l.phone ?? ""} ${l.email ?? ""} ${l.city ?? ""}`.toLowerCase().includes(s));
}
