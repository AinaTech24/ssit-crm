/**
 * POST /api/desks/assign  → assign a user to a desk { userId, deskId|null }
 * Gated by settings.desks.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { assignUserDesk } from "@/lib/org/desks";

export const dynamic = "force-dynamic";

const Body = z.object({
  userId: z.string().uuid(),
  deskId: z.string().uuid().nullable(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.desks", session.permissions);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });
    }
    await withTenant(session.tenantId, async (tx) =>
      assignUserDesk(tx, parsed.data.userId, parsed.data.deskId)
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
