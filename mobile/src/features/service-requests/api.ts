/**
 * Service Requests — the client-servicing queue ("change my bank account",
 * "send capital-gains report"). These carry an SLA, and Home's command-centre
 * surfaces breaches, so an RM needs to see and move them from the phone.
 *
 * GET  /api/service-requests        → { serviceRequests: rows } (full rows)
 * GET  /api/service-requests/[id]   → row
 * PATCH /api/service-requests/[id]  → status / priority / resolutionNotes
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { Tone } from "../../theme";

export type SrStatus = "open" | "in_progress" | "waiting_customer" | "resolved" | "closed" | "escalated";

export interface ServiceRequest {
  id: string;
  ticketNo: string | null;
  investorId: string | null;
  type: string | null;
  channel: string | null;
  subject: string | null;
  description: string | null;
  status: SrStatus | null;
  priority: string | null;
  assignedToUserId: string | null;
  slaResolutionAt: string | null;
  respondedAt: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  remarks: string | null;
  createdAt: string | null;
  [k: string]: any;
}

export function useServiceRequests() {
  return useQuery({
    queryKey: ["service-requests"],
    queryFn: () => api.get<{ serviceRequests: ServiceRequest[] }>("/api/service-requests").then((r) => r.serviceRequests),
    staleTime: 30_000,
  });
}

export function useServiceRequest(id: string) {
  return useQuery({
    queryKey: ["service-request", id],
    queryFn: () => api.get<ServiceRequest>(`/api/service-requests/${id}`),
    enabled: !!id,
  });
}

export function useUpdateServiceRequest(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: { status?: SrStatus; priority?: string; resolutionNotes?: string }) =>
      api.patch<ServiceRequest>(`/api/service-requests/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service-request", id] });
      qc.invalidateQueries({ queryKey: ["service-requests"] });
      qc.invalidateQueries({ queryKey: ["command-center"] });
    },
  });
}

// ── status metadata ──
export const SR_STATUSES: { value: SrStatus; label: string; tone: Tone }[] = [
  { value: "open", label: "Open", tone: "info" },
  { value: "in_progress", label: "In progress", tone: "brand" },
  { value: "waiting_customer", label: "Waiting on client", tone: "warning" },
  { value: "resolved", label: "Resolved", tone: "success" },
  { value: "closed", label: "Closed", tone: "neutral" },
  { value: "escalated", label: "Escalated", tone: "danger" },
];
export const srStatusMeta = (s?: string | null) =>
  SR_STATUSES.find((x) => x.value === s) ?? { value: "open" as SrStatus, label: s ? s.replace(/_/g, " ") : "—", tone: "neutral" as Tone };

const OPEN_SET = new Set(["open", "in_progress", "waiting_customer", "escalated"]);
export const isSrOpen = (r: ServiceRequest) => OPEN_SET.has(String(r.status ?? "open"));

/** SLA is breached when the resolution deadline has passed and it isn't done. */
export function isSlaBreached(r: ServiceRequest): boolean {
  if (!r.slaResolutionAt || !isSrOpen(r)) return false;
  const due = new Date(r.slaResolutionAt).getTime();
  return isFinite(due) && due < Date.now();
}

export const PRIORITY_TONE: Record<string, Tone> = { urgent: "danger", high: "warning", normal: "info", low: "neutral" };
