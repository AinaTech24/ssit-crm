import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { subscriptions, subscriptionEvents } from "@/db/schema";
import { areKnownNavKeys } from "@/config/nav-access";
import { areKnownWidgetKeys } from "@/config/dashboard-widgets";
import { sanitizeFeatureFlagOverride } from "@/config/feature-flags";

export const dynamic = "force-dynamic";

const Body = z.object({
  modulesOverride: z.array(z.string()).nullable().optional(),
  allowedFields: z.array(z.string()).nullable().optional(),
  /** Admin → MFD sidebar access — nav hrefs the firm can open. null = default. */
  allowedNav: z.array(z.string()).nullable().optional(),
  /** Admin → MFD dashboard widgets — widget keys the firm can see. null = all. */
  allowedDashboardWidgets: z.array(z.string()).nullable().optional(),
  /** Per-tenant feature-flag override. null = inherit the package's flags. */
  featureFlags: z.record(z.string(), z.any()).nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tenantId } = await params;
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.package.manage");

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const { modulesOverride, allowedFields, allowedNav, allowedDashboardWidgets, featureFlags } = parse.data;
    if (allowedNav != null && !areKnownNavKeys(allowedNav)) {
      return NextResponse.json({ error: "one or more sidebar items are not recognised" }, { status: 400 });
    }
    if (allowedDashboardWidgets != null && !areKnownWidgetKeys(allowedDashboardWidgets)) {
      return NextResponse.json({ error: "one or more dashboard widgets are not recognised" }, { status: 400 });
    }

    const result = await withPlatformAdmin(session.userId, async (tx) => {
      const sub = (
        await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1)
      )[0];
      if (!sub) throw Object.assign(new Error("subscription not found"), { status: 404 });

      const patch: any = { updatedAt: new Date() };
      if (modulesOverride !== undefined) patch.modulesOverride = modulesOverride;
      if (allowedFields !== undefined) patch.allowedFields = allowedFields;
      if (allowedNav !== undefined) patch.allowedNav = allowedNav;
      if (allowedDashboardWidgets !== undefined) patch.allowedDashboardWidgets = allowedDashboardWidgets;
      // Per-tenant feature-flag override — sanitize to known flags; null clears it.
      if (featureFlags !== undefined) patch.featureFlagsOverride = featureFlags === null ? null : sanitizeFeatureFlagOverride(featureFlags);

      await tx.update(subscriptions).set(patch).where(eq(subscriptions.id, sub.id));

      await tx.insert(subscriptionEvents).values({
        subscriptionId: sub.id,
        tenantId,
        eventType: "upgraded",
        actor: `ssit_admin:${session.userId}`,
        notes: "SSIT Platform Admin customized module & field overrides",
        meta: { modulesOverride, allowedFields } as any,
      } as any);

      return { ok: true };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
