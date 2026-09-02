/**
 * Admin "Onboarding form fields" settings — required/optional overrides.
 *
 *   GET  /api/settings/onboarding-fields  — load the saved override map
 *   PUT  /api/settings/onboarding-fields  — replace the override map
 *
 * The override map is { fieldKey: boolean } where true = mandatory, false =
 * optional; an absent key keeps the catalog default. `applyRequiredOverrides`
 * (already wired into the onboarding form GET) honours this firm-wide.
 *
 * The `onboarding_field_settings` table (migration 0160) has no Drizzle schema —
 * it's queried with RAW SQL inside withTenant(). RLS scopes by app.tenant_id;
 * we also pin tenant_id explicitly as defence-in-depth.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { handleApiError } from "@/lib/api/error-handler";
import { getAllUniqueFields } from "@/lib/onboarding/kyc-fields";

export const dynamic = "force-dynamic";

const PutBody = z.object({
  overrides: z.record(z.string(), z.boolean()),
});

async function loadOverrides(tenantId: string): Promise<Record<string, boolean>> {
  return withTenant(tenantId, async (tx) => {
    const res = await tx.execute(sql`
      SELECT required_overrides
      FROM onboarding_field_settings
      WHERE tenant_id = ${tenantId}::uuid
      LIMIT 1
    `);
    const row = res.rows[0] as { required_overrides?: Record<string, boolean> } | undefined;
    return (row?.required_overrides ?? {}) as Record<string, boolean>;
  });
}

export async function GET() {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    const overrides = await loadOverrides(session.tenantId);
    // Include the field catalog so the mobile app can render the toggle list
    // (the web reads getAllUniqueFields() at render — there was no JSON for it).
    const catalog = getAllUniqueFields().map((f) => ({
      key: f.key,
      label: f.label,
      section: (f as any).section ?? "Other",
      required: !!f.required,
    }));
    return NextResponse.json({ overrides, catalog });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = PutBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }

    // Sanitise — keep only keys that exist in the catalog; drop anything unknown.
    const validKeys = new Set(getAllUniqueFields().map((f) => f.key));
    const clean: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parse.data.overrides)) {
      if (validKeys.has(key)) clean[key] = value;
    }

    await withTenant(session.tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO onboarding_field_settings (tenant_id, required_overrides, updated_by, updated_at)
        VALUES (${session.tenantId}::uuid, ${JSON.stringify(clean)}::jsonb, ${session.userId}::uuid, now())
        ON CONFLICT (tenant_id) DO UPDATE SET
          required_overrides = EXCLUDED.required_overrides,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
      `);
    });

    return NextResponse.json({ ok: true, overrides: clean });
  } catch (err) {
    return handleApiError(err);
  }
}
