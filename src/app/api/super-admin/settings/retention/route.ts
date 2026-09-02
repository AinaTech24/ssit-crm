import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/super-admin/settings/retention
 * Body: { days: number }
 *
 * Sets how many days a soft-deleted tenant (with all its data) is kept before
 * it becomes eligible for automatic permanent purge. Platform-admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { RETENTION_KEY } from "@/lib/platform/retention";

export const dynamic = "force-dynamic";

const Body = z.object({ days: z.number().int().min(1).max(3650) });

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.tenant.delete");
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "days must be 1–3650" }, { status: 400 });
    const { days } = parse.data;

    await withPlatformAdmin(session.userId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO platform_settings (key, value, updated_by, updated_at)
        VALUES (${RETENTION_KEY}, ${JSON.stringify({ softDeleteDays: days })}::jsonb, ${session.userId}::uuid, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
      `);
    });

    return NextResponse.json({ ok: true, days });
  } catch (err: any) {
    return handleApiError(err);
  }
}
