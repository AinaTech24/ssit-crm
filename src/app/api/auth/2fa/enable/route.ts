import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/auth/2fa/enable   Body: { code }
 *   Confirms enrollment: verifies the 6-digit code against the pending secret,
 *   then flips two_fa_enabled=true and issues one-time backup codes (returned
 *   ONCE, stored bcrypt-hashed). After this, login requires the second factor.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { withSystem } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { verifyTotp, generateBackupCodes, decryptSecret } from "@/lib/auth/totp";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const Body = z.object({ code: z.string().min(6).max(10) });

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "code required" }, { status: 400 });
    }

    const row = await withSystem(async (tx) => {
      const r = await tx.execute(sql`
        SELECT two_fa_secret, two_fa_enabled FROM users WHERE id = ${session.userId} LIMIT 1
      `);
      return (r.rows[0] ?? null) as { two_fa_secret: string | null; two_fa_enabled: boolean } | null;
    });

    if (!row?.two_fa_secret) {
      return NextResponse.json({ error: "no pending enrollment — start setup first" }, { status: 409 });
    }
    if (!verifyTotp(decryptSecret(row.two_fa_secret), parse.data.code)) {
      return NextResponse.json({ error: "invalid code" }, { status: 401 });
    }

    // Issue backup codes — returned in plaintext ONCE, stored as bcrypt hashes.
    const backupCodes = generateBackupCodes(8);
    const hashed = await Promise.all(backupCodes.map((c) => bcrypt.hash(c, 10)));

    await withSystem(async (tx) => {
      await tx.execute(sql`
        UPDATE users
        SET two_fa_enabled = true,
            two_fa_backup_codes = ${JSON.stringify(hashed)}::jsonb,
            updated_at = now()
        WHERE id = ${session.userId}
      `);
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "user.2fa_enabled",
        entityType: "user",
        entityId: session.userId,
        before: { twoFaEnabled: false },
        after: { twoFaEnabled: true },
      });
    });

    return NextResponse.json({ ok: true, backupCodes });
  } catch (err: any) {
    return handleApiError(err);
  }
}
