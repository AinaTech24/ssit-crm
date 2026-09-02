/**
 * SIP Tracker — the RM's revenue-protection list. GET /api/sips is the feed the
 * server already exposes "for the mobile SIP Tracker"; a bounced SIP is book
 * value walking out this month, so the screen leads with failures.
 *
 * POST /api/sips/[id]/defend is the "Save the SIP" action — it raises a
 * high-priority follow-up task for the SIP's RM (and de-dupes if one is open).
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

export interface Sip {
  id: string;
  schemeName: string | null;
  amcName: string | null;
  amount: number | null;
  frequency: string | null;
  status: string | null;
  nextDate: string | null;
  folioNumber: string | null;
  consecutiveFailures: number;
  /** Rejected SIP debits on the ledger for this client — the real bounce signal
   *  (same source the SIP-health report counts, so the numbers agree). */
  failedCount: number;
  lastFailureReason: string | null;
  lastFailureAt: string | null;
  investorId: string | null;
  investorName: string | null;
}

export function useSips() {
  return useQuery({
    queryKey: ["sips"],
    queryFn: () => api.get<{ sips: Sip[] }>("/api/sips").then((r) => r.sips),
    staleTime: 60_000,
  });
}

/** "Save the SIP" — raises a high-priority recovery task for the RM. */
export function useDefendSip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; note?: string }) =>
      api.post<{ taskId: string; deduped?: boolean }>(`/api/sips/${v.id}/defend`, { note: v.note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sips"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["my-day"] });
    },
  });
}

/** At risk = a bounced debit on the ledger, or a feed-reported failure streak. */
export const isAtRisk = (s: Sip) => (s.failedCount ?? 0) > 0 || (s.consecutiveFailures ?? 0) > 0;
export const failureCount = (s: Sip) => Math.max(s.failedCount ?? 0, s.consecutiveFailures ?? 0);
const STOPPED = new Set(["stopped", "cancelled", "rejected", "expired"]);
export const isStopped = (s: Sip) => STOPPED.has(String(s.status ?? "").toLowerCase());
export const isLive = (s: Sip) => String(s.status ?? "").toLowerCase() === "active";

export interface SipBuckets { atRisk: Sip[]; live: Sip[]; stopped: Sip[]; all: Sip[] }
export function bucketSips(rows: Sip[] | undefined): SipBuckets {
  const all = rows ?? [];
  return {
    all,
    // At-risk first and sorted by damage — biggest instalment at the top.
    atRisk: all.filter(isAtRisk).sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)),
    live: all.filter((s) => isLive(s) && !isAtRisk(s)),
    stopped: all.filter(isStopped),
  };
}

export const sumAmount = (rows: Sip[]) => rows.reduce((n, s) => n + (s.amount ?? 0), 0);
