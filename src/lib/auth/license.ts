/**
 * Per-tenant ACCESS resolution.
 *
 * This file used to be a licensing gate — packages, trials, renewals, seat and
 * client quotas. All of that is gone: Equitywala provisions firms directly, it
 * does not sell them plans. What remains is the thing platform admins actually
 * use, in Equitywala Admin → MFD tenants → Module & Field Access Center:
 *
 *   allowedNav              the exact sidebar items this firm can open
 *   allowedFields           restricted data fields
 *   allowedDashboardWidgets which dashboard cards it sees
 *   modulesOverride         coarse module set (legacy; empty = everything)
 *   featureFlagsOverride    per-firm capability toggles (custom domain, …)
 *
 * Those live on the tenant's `subscriptions` row, which is now purely an
 * access-override record — no package, no billing, no expiry.
 *
 * The one thing that can still switch a firm OFF is `tenants.status`: a
 * platform admin suspending the firm. That is an operational action, not a
 * payment one.
 *
 * NOTE ON NAMES: `loadTenantLicense` / `assertActiveLicense` /
 * `assertModuleEnabled` keep their names because ~160 route handlers call them.
 * Read "license" as "access" throughout.
 */

import { cache } from "react";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { subscriptions, tenants } from "@/db/schema";
import { isPlatformAdmin } from "@/lib/platform";

export type LicenseState = {
  /** Mirrors tenants.status. Only "suspended"/"churned" restrict access. */
  status: string;
  /** Coarse module grant. EMPTY MEANS EVERYTHING (see tenantAccessibleNavKeys). */
  enabledModules: string[];
  /**
   * Granular feature grant. Always null now that packages are gone — the
   * granular grant is `allowedNav`. Kept so nav resolution keeps its shape.
   */
  enabledFeatures: string[] | null;
  allowedFields: string[] | null;
  /** Admin → MFD sidebar grant (nav hrefs). null = everything. */
  allowedNav: string[] | null;
  /**
   * The catalogue `allowedNav` was chosen from, stamped at save time
   * (migration 0224). null = a grant of unknown vintage, which therefore
   * holds back nothing the firm's package enables.
   */
  navGrantCatalog: string[] | null;
  /** Admin → MFD dashboard-widget grant (keys). null = all widgets visible. */
  allowedDashboardWidgets: string[] | null;
  featureFlags: Record<string, any>;
  /** true → the firm is suspended; only support + logout are reachable. */
  isRestricted: boolean;
  reason?: string;
};

/** Tenant states that lock a firm out of everything but support. */
const RESTRICTED_TENANT_STATUSES = new Set(["suspended", "churned"]);

/** Full access — platform admins, and the fallback when no override row exists. */
function unrestricted(status = "active"): LicenseState {
  return {
    status,
    enabledModules: [],
    enabledFeatures: null,
    allowedFields: null,
    allowedNav: null,
    navGrantCatalog: null,
    allowedDashboardWidgets: null,
    featureFlags: {},
    isRestricted: false,
  };
}

/**
 * Per-request memoized. The layout + several server components all call this
 * with the same (tenantId, session.roles) within one render; React.cache()
 * collapses them to a single DB read. session.roles is a stable reference per
 * request (getSession is itself cached), so it hits.
 */
export const loadTenantLicense = cache(loadTenantLicenseImpl);

async function loadTenantLicenseImpl(tenantId: string, roles?: string[]): Promise<LicenseState> {
  // Platform admins are never gated — they need to see every firm as-is.
  if (isPlatformAdmin(roles)) return unrestricted();

  const row = await withTenant(tenantId, async (tx) => {
    const [t] = await tx
      .select({ status: tenants.status })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const [s] = await tx
      .select({
        modulesOverride: subscriptions.modulesOverride,
        allowedFields: subscriptions.allowedFields,
        allowedNav: subscriptions.allowedNav,
        navGrantCatalog: subscriptions.navGrantCatalog,
        allowedDashboardWidgets: subscriptions.allowedDashboardWidgets,
        featureFlagsOverride: subscriptions.featureFlagsOverride,
        suspendedReason: subscriptions.suspendedReason,
      })
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenantId))
      .limit(1);
    return { tenantStatus: t?.status ?? "active", sub: s ?? null };
  });

  const status = row.tenantStatus;
  const isRestricted = RESTRICTED_TENANT_STATUSES.has(status);

  // No override row = a firm nobody has customised. Everything is on.
  if (!row.sub) {
    return { ...unrestricted(status), isRestricted, reason: isRestricted ? "This account is suspended." : undefined };
  }

  return {
    status,
    // An EMPTY array is meaningful here only as "not customised": the nav
    // resolver treats an empty module set as allow-all, which is what an
    // un-customised firm should get.
    enabledModules: (row.sub.modulesOverride as string[] | null) ?? [],
    enabledFeatures: null,
    allowedFields: (row.sub.allowedFields as string[] | null) ?? null,
    allowedNav: (row.sub.allowedNav as string[] | null) ?? null,
    navGrantCatalog: (row.sub.navGrantCatalog as string[] | null) ?? null,
    allowedDashboardWidgets: (row.sub.allowedDashboardWidgets as string[] | null) ?? null,
    featureFlags: (row.sub.featureFlagsOverride as Record<string, any> | null) ?? {},
    isRestricted,
    reason: isRestricted ? row.sub.suspendedReason ?? "This account is suspended." : undefined,
  };
}

/** Paths that stay reachable while a firm is suspended. */
export function isPathAllowedWhenRestricted(pathname: string): boolean {
  return (
    pathname === "/dashboard/support" ||
    pathname.startsWith("/dashboard/support/") ||
    pathname === "/api/auth/logout"
  );
}

/**
 * API-side guard. Call from any mutating endpoint so a SUSPENDED firm can't
 * write. Platform admins always pass. Throws a 403-shaped error, which the
 * route handler's catch block surfaces as JSON.
 *
 * Read-only routes intentionally do NOT call this — a suspended firm can still
 * view its own data, it just can't change it.
 */
export async function assertActiveLicense(tenantId: string, roles?: string[]): Promise<void> {
  const access = await loadTenantLicense(tenantId, roles);
  if (access.isRestricted) {
    throw Object.assign(new Error(access.reason ?? "This account is suspended."), { status: 403 });
  }
}

/**
 * Server-side MODULE gate. The sidebar already hides modules a firm isn't
 * granted, but that's UI-only — a direct URL/API hit would bypass it. Call this
 * in module APIs so a firm without the module can't reach the data.
 *
 * Platform admins always pass. FAIL-OPEN when no modules are configured (the
 * normal case) so we never lock a firm out of its own data — we only block when
 * the override explicitly lists modules and this one isn't among them.
 */
export async function assertModuleEnabled(
  tenantId: string,
  moduleKey: string,
  roles?: string[]
): Promise<void> {
  if (isPlatformAdmin(roles)) return;
  const access = await loadTenantLicense(tenantId, roles);
  if (access.enabledModules.length > 0 && !access.enabledModules.includes(moduleKey)) {
    throw Object.assign(new Error(`module '${moduleKey}' is not enabled for your firm`), { status: 403 });
  }
}
