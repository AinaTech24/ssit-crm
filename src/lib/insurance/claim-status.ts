/**
 * Claim ↔ policy status reconciliation + settlement-TAT helpers.
 */

/** Map a claim status onto the policy status it implies (null = no change). */
export function policyStatusForClaim(claimStatus: string): "claim_filed" | "claim_settled" | null {
  if (claimStatus === "settled_fully" || claimStatus === "settled_partially") return "claim_settled";
  if (
    ["claim_intimated", "file_awaited", "file_received", "add_info_awaited", "query", "query_replied", "under_process"].includes(claimStatus)
  ) {
    return "claim_filed";
  }
  return null; // rejected / withdrawn / empty — leave the policy as-is
}

/** Claim statuses that are still open (not settled/rejected/withdrawn). */
export const OPEN_CLAIM_STATUSES = [
  "empty",
  "claim_intimated",
  "file_awaited",
  "file_received",
  "add_info_awaited",
  "query",
  "query_replied",
  "under_process",
] as const;

/** Turnaround time (days) between intimation and settlement; null if not settled. */
export function claimTatDays(intimationDate: string | Date | null | undefined, settlementDate: string | Date | null | undefined): number | null {
  if (!intimationDate || !settlementDate) return null;
  const a = new Date(intimationDate).getTime();
  const b = new Date(settlementDate).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** How long an OPEN claim has been pending (days since intimation). */
export function claimAgeDays(intimationDate: string | Date | null | undefined, now: Date = new Date()): number | null {
  if (!intimationDate) return null;
  const a = new Date(intimationDate).getTime();
  if (Number.isNaN(a)) return null;
  return Math.max(0, Math.round((now.getTime() - a) / 86_400_000));
}
