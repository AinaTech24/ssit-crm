/**
 * Investors data layer. Infinite-scroll list (GET /api/investors) + single
 * record (GET /api/investors/[id]) + KPI strip (GET /api/investors/kpis) +
 * delete. Same endpoints + full web filter/sort param set (q, segment, category,
 * tier, kyc, status, rm, created_from/to, sort, dir, page, limit).
 */

import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

export interface Investor {
  id: string;
  name: string;
  pan: string | null;
  phone: string | null;
  email: string | null;
  segmentTag: string | null;
  clientCategory: string | null;
  status: string | null;
  kycStatus: string | null;
  serviceTier: string | null;
  healthBand: string | null;
  healthScore: number | null;
  aum: string | null;
  activeSipAmount: string | null;
  rmId: string | null;
  nomineeName?: string | null;
  lastTransactionAt?: string | null;
  nextReviewAt?: string | null;
  city?: string | null;
  updatedAt?: string | null;
  // The row carries ~110 fields; the detail screen reads more off `any`.
  [key: string]: any;
}

interface ListResponse {
  rows: Investor[];
  total: number;
  page: number;
  limit: number;
}

const PAGE_SIZE = 30;

export interface InvestorFilters {
  q?: string;
  /** Comma-joined multi-selects, matching the web FilterBar. */
  segment?: string;
  category?: string;
  tier?: string;
  kyc?: string;
  status?: string;
  rm?: string;
  created_from?: string;
  created_to?: string;
  sort?: string; // aum | created | name | sip | health | review
  dir?: "asc" | "desc";
}

export function useInvestors(filters: InvestorFilters) {
  return useInfiniteQuery({
    queryKey: ["investors", filters],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.get<ListResponse>("/api/investors", {
        q: filters.q || undefined,
        segment: filters.segment || undefined,
        category: filters.category || undefined,
        tier: filters.tier || undefined,
        kyc: filters.kyc || undefined,
        status: filters.status || undefined,
        rm: filters.rm || undefined,
        created_from: filters.created_from || undefined,
        created_to: filters.created_to || undefined,
        sort: filters.sort || undefined,
        dir: filters.dir || undefined,
        page: pageParam,
        limit: PAGE_SIZE,
      }),
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.rows.length, 0);
      return loaded < last.total ? last.page + 1 : undefined;
    },
  });
}

/** Flatten infinite-query pages into one row array + the reported total. */
export function flattenInvestors(data?: { pages: ListResponse[] }): { rows: Investor[]; total: number } {
  if (!data) return { rows: [], total: 0 };
  return { rows: data.pages.flatMap((p) => p.rows), total: data.pages[0]?.total ?? 0 };
}

export interface InvestorKpis {
  totalActive: number;
  totalAll: number;
  totalAum: number;
  sipBook: number;
  tierA: number;
  tierAPct: number;
  reviewsDue: number;
  kycExpiring: number;
  nomineeMissing: number;
  dormant: number;
}

export function useInvestorKpis() {
  return useQuery({
    queryKey: ["investor-kpis"],
    queryFn: () => api.get<InvestorKpis>("/api/investors/kpis"),
    staleTime: 60_000,
  });
}

export function useInvestor(id?: string) {
  return useQuery({
    queryKey: ["investor", id],
    enabled: !!id,
    queryFn: () => api.get<Investor>(`/api/investors/${id}`),
  });
}

/** The complete client-360 payload (GET /api/investors/[id]/full). */
export function useInvestorFull(id?: string) {
  return useQuery({
    queryKey: ["investor-full", id],
    enabled: !!id,
    queryFn: () => api.get<any>(`/api/investors/${id}/full`),
    staleTime: 30_000,
  });
}

/**
 * Record a client's communication consent (POST /api/comms/consent).
 *
 * This is the RM asserting a real-world opt-in the client gave them verbally or
 * in writing — and it's what the comms pipeline checks before every send, so a
 * client with no consent silently gets `skipped_*` instead of a message. The
 * person who can capture it is the one sitting in front of the client.
 */
export function useSetConsent(investorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { channel: "whatsapp" | "email" | "sms" | "call"; scope: "transactional" | "marketing" | "all"; status: "granted" | "revoked" }) =>
      api.post("/api/comms/consent", { investorId, ...v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["investor-full", investorId] }),
  });
}

export function useVerifyContact(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { channel: "email" | "phone"; verified: boolean }) =>
      api.post(`/api/investors/${id}/verify-contact`, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["investor-full", id] }),
  });
}

export function useSetReviewCadence(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { reviewFrequency: string; reviewFrequencyDays?: number | null }) =>
      api.patch(`/api/investors/${id}`, v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["investor-full", id] });
      qc.invalidateQueries({ queryKey: ["investor", id] });
    },
  });
}

export function useSendStatement(id: string) {
  return useMutation({
    mutationFn: (channel: "email" | "whatsapp") =>
      api.post<{ ok?: boolean; waUrl?: string; message?: string }>(`/api/investors/${id}/statement/send`, { channel }),
  });
}

/** Template sends work for a client or a prospect — same shape, different route. */
export type CommSubject = "investor" | "lead";
const dispatchPath = (subject: CommSubject, id: string) =>
  subject === "lead" ? `/api/leads/${id}/dispatch` : `/api/investors/${id}/dispatch`;

export function useInvestorTemplates(id: string, enabled: boolean, subject: CommSubject = "investor") {
  return useQuery({
    queryKey: ["comm-templates", subject, id],
    enabled,
    queryFn: () => api.get<any>(dispatchPath(subject, id)),
    staleTime: 60_000,
  });
}

export function useDispatchComm(id: string, subject: CommSubject = "investor") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { channel: string; templateKey: string; variables?: Record<string, string> }) =>
      api.post(dispatchPath(subject, id), v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [subject === "lead" ? "lead-full" : "investor-full", id] });
      qc.invalidateQueries({ queryKey: ["activity-timeline"] });
    },
  });
}

export function useDeleteInvestor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/investors/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["investors"] });
      qc.invalidateQueries({ queryKey: ["investor-kpis"] });
    },
  });
}
