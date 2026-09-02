/**
 * The `/api/me` payload + capability helpers. This is how the app gates UI the
 * same way the server enforces: tabs, drawer items, buttons, and fields all
 * check `can()` against the capability list the backend computed for this user.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

export interface License {
  status: "pending" | "trial" | "active" | "past_due" | "suspended" | "expired" | "cancelled" | "no_subscription";
  packageKey: string | null;
  enabledModules: string[];
  enabledFeatures: string[] | null;
  allowedNav: string[] | null;
  allowedFields: string[] | null;
  allowedDashboardWidgets: string[] | null;
  featureFlags: Record<string, any>;
  isRestricted: boolean;
  needsOnboarding: boolean;
  maxUsers: number;
  maxInvestors: number;
  trialEndsAt: string | null;
  licenseEndAt: string | null;
  nextRenewalAt: string | null;
}

export interface Me {
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
    roles: string[];
    roleLabel: string;
    branchId: string | null;
    tenantId: string;
    isPlatformAdmin: boolean;
  };
  roleLabels: Record<string, string>;
  capabilities: string[];
  license: License;
}

export function fetchMe(): Promise<Me> {
  return api.get<Me>("/api/me");
}

export const ME_KEY = ["me"] as const;

export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: fetchMe, staleTime: 5 * 60_000 });
}

/** True if the user holds the capability. Pass the Me payload's `capabilities`. */
export function hasCap(capabilities: string[] | undefined, cap: string): boolean {
  return !!capabilities?.includes(cap);
}

/** True if the user holds ANY of the capabilities (for grouped nav visibility). */
export function hasAnyCap(capabilities: string[] | undefined, caps: string[]): boolean {
  if (!capabilities) return false;
  return caps.some((c) => capabilities.includes(c));
}

/** A field is allowed unless the tenant license explicitly restricts the set. */
export function isFieldAllowed(license: License | undefined, fqName: string): boolean {
  const allowed = license?.allowedFields;
  if (!allowed || allowed.length === 0) return true;
  return allowed.includes(fqName);
}
