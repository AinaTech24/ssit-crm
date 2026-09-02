/**
 * Proposals data layer — GET/POST /api/proposals, /[id], /[id]/send, plus the MF
 * scheme catalog search used by the builder. JSON is camelCase (DB is snake_case).
 * Mirrors the web proposal builder: a proposal is a recipient + product line
 * items (5 kinds) + framing, created as a draft, then sent (with a suitability
 * gate) over WhatsApp or email.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

// ── Line items (discriminated by `kind`) — exact shape of proposals.products ──
export type MfLine = { kind: "mf"; schemeName: string; amcName?: string; schemeCode?: string; category?: string; monthlyAmount?: number; lumpsum?: number; sipTermYears?: number; expectedReturn?: number; riskRating?: "low" | "moderate" | "high" | "very_high"; projectedCorpus?: number; notes?: string };
export type InsuranceLine = { kind: "insurance"; policyName: string; insurer?: string; policyType?: "term" | "ulip" | "endowment" | "health" | "money_back" | "other"; sumAssured?: number; annualPremium?: number; termYears?: number; riderNotes?: string; notes?: string };
export type PmsLine = { kind: "pms"; strategyName: string; manager?: string; minInvestment?: number; proposedAmount?: number; expectedReturn?: number; termYears?: number; exitLoad?: string; notes?: string };
export type AifLine = { kind: "aif"; fundName: string; manager?: string; category?: "cat1" | "cat2" | "cat3"; minInvestment?: number; proposedAmount?: number; lockInYears?: number; targetIrr?: number; notes?: string };
export type OtherLine = { kind: "other"; productName: string; company?: string; amount?: number; expectedReturn?: number; termYears?: number; remarks?: string; notes?: string };
export type ProposalLine = MfLine | InsuranceLine | PmsLine | AifLine | OtherLine;
export type LineKind = ProposalLine["kind"];

export type ProposalStatus = "draft" | "ready" | "sent" | "viewed" | "accepted" | "rejected" | "expired";
export type RecipientType = "investor" | "lead" | "family";
export type ProposalType = "comprehensive" | "mutual_fund" | "insurance" | "pms" | "aif" | "mixed";
export type RiskRating = "conservative" | "moderate" | "aggressive" | "mixed";

export interface Proposal {
  id: string;
  proposalNumber: string;
  recipientType: RecipientType;
  investorId: string | null;
  leadId: string | null;
  familyId: string | null;
  recipientName: string;
  recipientEmail: string | null;
  recipientPhone: string | null;
  type: ProposalType;
  title: string;
  summary: string | null;
  coverLetter: string | null;
  disclaimer: string | null;
  products: ProposalLine[];
  totalInvestment: string | number | null;
  expectedCorpus: string | number | null;
  riskRating: RiskRating | null;
  status: ProposalStatus;
  validUntil: string | null;
  sentAt: string | null;
  suitabilityNote: string | null;
  createdAt: string;
}

export interface CreateProposalBody {
  recipientType: RecipientType;
  investorId?: string;
  leadId?: string;
  familyId?: string;
  recipientName?: string;
  recipientEmail?: string;
  recipientPhone?: string;
  type?: ProposalType;
  title: string;
  summary?: string;
  coverLetter?: string;
  disclaimer?: string;
  products: ProposalLine[];
  riskRating?: RiskRating;
  validUntil?: string;
  suitabilityNote?: string;
}

export function useProposals() {
  return useQuery({
    queryKey: ["proposals"],
    queryFn: () => api.get<{ proposals: Proposal[] }>("/api/proposals").then((r) => r.proposals),
    staleTime: 30_000,
  });
}

export function useProposal(id: string) {
  return useQuery({
    queryKey: ["proposal", id],
    queryFn: () => api.get<Proposal>(`/api/proposals/${id}`),
    enabled: !!id,
  });
}

export function useCreateProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProposalBody) => api.post<{ id: string }>("/api/proposals", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["proposals"] }),
  });
}

export function useUpdateProposal(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Proposal> & { status?: ProposalStatus }) => api.patch<Proposal>(`/api/proposals/${id}`, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["proposal", id] }); qc.invalidateQueries({ queryKey: ["proposals"] }); },
  });
}

export function useDeleteProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/proposals/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["proposals"] }),
  });
}

/** Send returns a wa.me URL for WhatsApp (the RM opens it), or dispatches email. */
export interface SendResult { ok: boolean; channel: "email" | "whatsapp"; externalId: string | null; waUrl: string | null }
export function useSendProposal(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channel: "email" | "whatsapp") => api.post<SendResult>(`/api/proposals/${id}/send`, { channel }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["proposal", id] }); qc.invalidateQueries({ queryKey: ["proposals"] }); },
  });
}

// ── MF scheme catalog (for the MF line picker) ──
export interface SchemeHit { schemeCode: string; schemeName: string; amc: string | null; category: string | null; nav: number | null; navDate: string | null; risk: { band: string; label: string; tone: string } | null }
export function useSchemeSearch(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: ["mf-schemes", term],
    queryFn: () => api.get<{ schemes: SchemeHit[] }>("/api/mf/schemes", { q: term, limit: "12" }).then((r) => r.schemes),
    enabled: term.length >= 2,
    staleTime: 60_000,
  });
}

// ── helpers ──
export const num = (v: unknown): number => { const n = Number(v ?? 0); return isFinite(n) ? n : 0; };

/** Investment amount a line contributes (matches the web builder's tally). */
export function lineAmount(l: ProposalLine): number {
  switch (l.kind) {
    case "mf": return num(l.lumpsum) + num(l.monthlyAmount) * 12 * num(l.sipTermYears || 1);
    case "insurance": return num(l.annualPremium);
    case "pms": return num(l.proposedAmount);
    case "aif": return num(l.proposedAmount);
    case "other": return num(l.amount);
  }
}

export function lineTitle(l: ProposalLine): string {
  switch (l.kind) {
    case "mf": return l.schemeName;
    case "insurance": return l.policyName;
    case "pms": return l.strategyName;
    case "aif": return l.fundName;
    case "other": return l.productName;
  }
}

export const LINE_KIND_LABEL: Record<LineKind, string> = {
  mf: "Mutual Fund", insurance: "Insurance", pms: "PMS", aif: "AIF", other: "Other",
};
