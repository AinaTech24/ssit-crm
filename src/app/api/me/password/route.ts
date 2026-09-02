/**
 * POST /api/me/password — change your own password while logged in.
 *
 * Verifies the current password (bcrypt) before setting the new one. Any
 * logged-in user (every role) can change their own password — this is the
 * self-service path that was previously missing (only the forgot-password
 * token flow existed). Tenant-scoped; you can only ever change your own row.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { users } from "@/db/schema";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

const Body = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8, "Use at least 8 characters").max(200),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid input", issues: parsed.error.issues },
        { status: 400 }
      );
    }
    const { currentPassword, newPassword } = parsed.data;

    const result = await withTenant(session.tenantId, async (tx) => {
      const [u] = await tx
        .select({ id: users.id, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, session.userId))
        .limit(1);
      if (!u || !u.passwordHash) return { ok: false as const, code: 400, msg: "No password set on this account" };

      const valid = await bcrypt.compare(currentPassword, u.passwordHash);
      if (!valid) return { ok: false as const, code: 401, msg: "Current password is incorrect" };

      const hash = await bcrypt.hash(newPassword, 12);
      await tx.update(users).set({ passwordHash: hash, updatedAt: new Date() }).where(eq(users.id, session.userId));
      return { ok: true as const };
    });

    if (!result.ok) return NextResponse.json({ error: result.msg }, { status: result.code });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
