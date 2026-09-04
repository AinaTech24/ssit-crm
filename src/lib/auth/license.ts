/**
 * License gate helpers.
 *
 * Every MFD dashboard server component calls `loadTenantLicense(tenantId)`.
 * The returned object tells the dashboard layout whether to render the
 * full app or the restricted "Renew your license" screen.
 *
 * Allowed routes when restricted:
 *   - /dashboard/billing
 *   - /dashboard/support
 * Everything else shows the restricted screen, no data leaks.
 */

import { cache } from "react";
import { eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { subscriptions, packages } from "@/db/schema";
import { isPlatformAdmin } from "@/lib/platform";

export type LicenseState = {
  status: "pending" | "trial" | "active" | "past_due" | "suspended" | "expired" | "cancelled" | "no_subscription";
  packageKey: string | null;
  enabledModules: string[];
  /** Package GRANULAR feature grant (nav hrefs). null/[] = use coarse modules. */
  enabledFeatures: string[] | null;
  allowedFields: string[] | null;
  /** Admin → MFD sidebar nav grant (hrefs). null = package-module default. */
  allowedNav: string[] | null;
  /** Admin → MFD dashboard-widget grant (keys). null = all widgets visible. */
  allowedDashboardWidgets: string[] | null;
  featureFlags: Record<string, any>;
  maxUsers: number;
  maxInvestors: number;
  trialEndsAt: Date | null;
  licenseEndAt: Date | null;
  nextRenewalAt: Date | null;
  isRestricted: boolean; // true → only billing + support visible
  /** true → brand-new tenant hasn't chosen/paid for a plan yet; route to
   *  /onboarding/choose-plan instead of the dashboard or the billing gate. */
  needsOnboarding: boolean;
  reason?: string;
};

// "pending" (signed up, hasn't paid) is restricted too — strictly no app access
// until a plan is paid for. The dashboard layout sends `pending` to onboarding
// (needsOnboarding) before this matters for the UI; this also blocks API routes
// that call assertActiveLicense, so there's no back-door to the data.
const RESTRICTED_STATUSES = new Set(["pending", "suspended", "expired", "cancelled"]);

/**
 * Per-request memoized. The layout + several server components all call this
 * with the same (tenantId, session.roles) within one render; React.cache()
 * collapses them to a single subscription+package DB read. session.roles is a
 * stable reference per request (getSession is itself cached), so it hits.
 */
export const loadTenantLicense = cache(loadTenantLicenseImpl);

async function loadTenantLicenseImpl(tenantId: string, roles?: string[]): Promise<LicenseState> {
  // Licensing was removed along with the packages / subscriptions / billing
  // modules — Equitywala is provisioned directly, not sold by plan. Every tenant
  // therefore resolves to a single unrestricted, unlimited license.
  //
  // The shape below is deliberately unchanged so the ~160 call sites of
  // loadTenantLicense / assertActiveLicense / assertInvestorQuota keep working:
  //   - isRestricted false → no route is ever gated
  //   - allowedNav / enabledFeatures null and enabledModules []
  //     → tenantAccessibleNavKeys() takes its noGating branch (an empty module
  //       set means allow all), so the full sidebar renders
  //   - maxUsers / maxInvestors 1e9 → quota checks short-circuit as unlimited
  void tenantId;
  void roles;
  return {
    status: "active",
    packageKey: null,
    enabledModules: [],
    enabledFeatures: null,
    allowedFields: null,
    allowedNav: null,
    allowedDashboardWidgets: null,
    featureFlags: {},
    maxUsers: 1e9,
    maxInvestors: 1e9,
    trialEndsAt: null,
    licenseEndAt: null,
    nextRenewalAt: null,
    isRestricted: false,
    needsOnboarding: false,
  };
}

/**
 * Plan client-count gate. The package advertises `maxInvestors` and the UI
 * shows it, but nothing stopped a tenant from adding past it — so the
 * client-count pricing axis was unenforced (a tenant on a 200-client plan
 * could hold unlimited clients). Call this before creating investors.
 *
 * `incoming` is how many new investors this operation will add (default 1 for
 * a single create; pass the batch size for bulk/RTA imports). Platform admins
 * and unlimited plans (>= 1e9) pass freely. Throws a 402-shaped error so the
 * route surfaces an "upgrade your plan" message.
 */
export async function assertInvestorQuota(
  tenantId: string,
  roles: string[] | undefined,
  incoming = 1
): Promise<void> {
  if (isPlatformAdmin(roles)) return;
  const license = await loadTenantLicense(tenantId, roles);
  const cap = license.maxInvestors;
  if (!cap || cap >= 1e9) return; // unlimited / unset

  const current = await withTenant(tenantId, async (tx) => {
    const r = (await tx.execute(
      sql`SELECT count(*)::int c FROM investors WHERE tenant_id = ${tenantId}::uuid AND status <> 'closed' AND deleted_at IS NULL`
    )).rows[0] as { c?: number } | undefined;
    return Number(r?.c ?? 0);
  });

  if (current + incoming > cap) {
    const room = Math.max(0, cap - current);
    throw Object.assign(
      new Error(
        `Your plan includes ${cap} clients (${current} in use` +
          (incoming > 1 ? `, ${room} remaining; this import adds ${incoming}` : "") +
          `). Upgrade your plan to add more clients.`
      ),
      { status: 402 }
    );
  }
}

/** Allowed paths during restriction. */
export function isPathAllowedWhenRestricted(pathname: string): boolean {
  return (
    pathname === "/dashboard/billing" ||
    pathname.startsWith("/dashboard/billing/") ||
    pathname === "/dashboard/support" ||
    pathname.startsWith("/dashboard/support/") ||
    pathname === "/api/auth/logout"
  );
}

/**
 * API-side license guard. Call from any mutating endpoint to block writes when
 * the tenant's license is suspended/expired/cancelled. Platform admins always
 * pass. Throws a 402-shaped error (Payment Required) — the route handler's
 * catch block surfaces it as JSON.
 *
 * Read-only routes intentionally do NOT call this — restricted tenants can
 * still view their data, they just can't mutate.
 *
 * Usage:
 *   const session = await requireSession();
 *   await assertActiveLicense(session.tenantId, session.roles);
 */
export async function assertActiveLicense(tenantId: string, roles?: string[]): Promise<void> {
  const license = await loadTenantLicense(tenantId, roles);
  if (license.isRestricted) {
    throw Object.assign(new Error(`license ${license.status}: ${license.reason ?? "renew to continue"}`), {
      status: 402,
    });
  }
}

/**
 * Server-side MODULE gate. The sidebar already hides modules a tenant's plan
 * doesn't include, but that's UI-only — a direct URL/API hit would bypass it.
 * Call this in module APIs (e.g. leads, investors, campaigns) so a tenant
 * without the module in their plan can't reach the data through the back door.
 *
 * Platform admins always pass. FAIL-OPEN when a plan has NO modules configured
 * (misconfigured / legacy tenant) so we never accidentally lock a firm out of
 * their own data — we only block when the plan explicitly lists modules and
 * this one isn't among them. Throws a 403-shaped error.
 */
export async function assertModuleEnabled(
  tenantId: string,
  moduleKey: string,
  roles?: string[]
): Promise<void> {
  if (isPlatformAdmin(roles)) return;
  const license = await loadTenantLicense(tenantId, roles);
  if (license.enabledModules.length > 0 && !license.enabledModules.includes(moduleKey)) {
    throw Object.assign(
      new Error(`module '${moduleKey}' is not included in your plan`),
      { status: 403 }
    );
  }
}
