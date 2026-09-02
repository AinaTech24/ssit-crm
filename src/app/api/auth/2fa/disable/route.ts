import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/auth/2fa/disable   Body: { password }
 *   Turns 2FA off for the logged-in user. Requires the account password as a
 *   re-auth step (so a hijacked session alone can't strip the second factor),
 *   and clears the secret + backup codes.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { withSystem } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const Body = z.object({ password: z.string().min(1) });

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "password required" }, { status: 400 });
    }

    const row = await withSystem(async (tx) => {
      const r = await tx.execute(sql`
        SELECT password_hash FROM users WHERE id = ${session.userId} LIMIT 1
      `);
      return (r.rows[0] ?? null) as { password_hash: string | null } | null;
    });
    if (!row?.password_hash || !(await bcrypt.compare(parse.data.password, row.password_hash))) {
      return NextResponse.json({ error: "invalid password" }, { status: 401 });
    }

    await withSystem(async (tx) => {
      await tx.execute(sql`
        UPDATE users
        SET two_fa_enabled = false,
            two_fa_secret = NULL,
            two_fa_backup_codes = NULL,
            updated_at = now()
        WHERE id = ${session.userId}
      `);
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "user.2fa_disabled",
        entityType: "user",
        entityId: session.userId,
        before: { twoFaEnabled: true },
        after: { twoFaEnabled: false },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
