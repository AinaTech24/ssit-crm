/**
 * Billing — GET /api/billing (subscription + package + usage + events + trial
 * countdown). Read-only; auto-pay setup stays on web.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

export interface UsageMetric { used: number; limit: number | null; pct: number | null }

export interface BillingData {
  subscription: {
    status: string | null;
    billingCycle: string | null;
    licenseStartAt: string | null;
    licenseEndAt: string | null;
    trialEndsAt: string | null;
    nextRenewalAt: string | null;
    mandateStatus: string | null;
    failedPaymentCount: number | null;
    lastPaymentAt: string | null;
    lastPaymentPaise: number | null;
  } | null;
  package: {
    key: string | null;
    name: string | null;
    description: string | null;
    maxUsers: number | null;
    maxInvestors: number | null;
    storageLimitGb: number | null;
    enabledModules: string[] | null;
  } | null;
  usage: {
    users: UsageMetric;
    investors: UsageMetric;
    storage: UsageMetric;
    messages: UsageMetric;
  } | null;
  events: { id: string; eventType: string | null; toStatus: string | null; amountPaise: number | null; notes: string | null; at: string | null }[];
  computed: { daysLeft: number | null; isTrial: boolean };
}

export function useBilling() {
  return useQuery({
    queryKey: ["billing"],
    queryFn: () => api.get<BillingData>("/api/billing"),
    staleTime: 60_000,
  });
}
