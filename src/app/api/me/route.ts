import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/me
 *
 * The native mobile app's gating payload. Returns the authenticated user plus
 * everything the app needs to hide/disable UI exactly the way the server
 * enforces it — so the client never shows an action the backend would reject.
 *
 *   - user:         identity + roles (from the verified session)
 *   - capabilities: the concrete list of capability keys this user passes (the
 *                   same `can()` matrix the API routes use), so the app gates
 *                   tabs/drawer items/buttons/fields off a flat string[].
 *   - license:      subscription status + enabled modules/features + allowed
 *                   fields + restriction flags — drives the license gate, module
 *                   visibility, and field-level masking on mobile.
 *
 * The server remains the source of truth: every real call is still authorized
 * server-side. This endpoint just lets the app avoid showing dead controls.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { ALL_CAPABILITIES, can, primaryRoleLabel, ROLE_LABELS } from "@/lib/auth/rbac";
import { loadTenantLicense } from "@/lib/auth/license";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    const roles = session.roles ?? [];
    const permissions = (session as any).permissions ?? [];

    // The concrete capabilities this user has — filter the full matrix through
    // the same can() the server uses. Flat string[] is cheap to ship + check.
    const capabilities = ALL_CAPABILITIES.filter((cap) => can(roles, cap, permissions));

    const license = await loadTenantLicense(session.tenantId, roles);
    // Cheap single-column lookup — the JWT session doesn't carry the (mutable)
    // avatar, and this endpoint is the one every screen's header avatar reads.
    const avatarUrl = await withTenant(
      session.tenantId,
      async (tx) => {
        const [u] = await tx.select({ avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, session.userId)).limit(1);
        return u?.avatarUrl ?? null;
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    return NextResponse.json({
      user: {
        id: session.userId,
        name: session.name,
        email: session.email,
        avatarUrl,
        roles,
        roleLabel: primaryRoleLabel(roles),
        branchId: session.branchId ?? null,
        tenantId: session.tenantId,
        isPlatformAdmin: !!session.isPlatformAdmin,
      },
      roleLabels: ROLE_LABELS,
      capabilities,
      // Per-tenant access grants (Equitywala Admin -> Module & Field Access
      // Center). No package / trial / renewal fields — that model is gone.
      license: {
        status: license.status,
        enabledModules: license.enabledModules,
        enabledFeatures: license.enabledFeatures,
        allowedNav: license.allowedNav,
        allowedFields: license.allowedFields,
        allowedDashboardWidgets: license.allowedDashboardWidgets,
        featureFlags: license.featureFlags,
        isRestricted: license.isRestricted,
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
