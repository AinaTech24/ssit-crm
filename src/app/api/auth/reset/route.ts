import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/auth/reset  Body: { token, password }
 *
 * Consumes a password-reset token. Updates the user's password and logs them in.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withSystem } from "@/db/client";
import { signSession, SESSION_TTL_SECONDS } from "@/lib/auth/session";
import { sessionCookieForRoles } from "@/lib/auth/jwt";
import { clearSessionRevocationCache } from "@/lib/auth/revocation";
import { enforce } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const Body = z.object({
  token: z.string().min(20),
  password: z.string().min(8),
});

export async function POST(req: NextRequest) {
  // 20 reset attempts per IP per 15 min — wide enough for a legit user
  // who fat-fingers their new password a few times, narrow enough to stop
  // a token brute force (the hash is sha-256 so brute force is infeasible
  // anyway, but defence in depth).
  const limited = enforce(req, "auth.reset", { limit: 20, windowSec: 15 * 60 });
  if (limited) return limited;

  const parse = Body.safeParse(await req.json().catch(() => ({})));
  if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const tokenHash = crypto.createHash("sha256").update(parse.data.token).digest("hex");

  try {
    const session = await withSystem(async (tx) => {
      const r = await tx.execute(sql`
        SELECT pr.id, pr.user_id, pr.tenant_id, pr.expires_at, pr.consumed_at,
               u.email, u.name, u.branch_id, u.roles, u.permissions
        FROM password_resets pr
        JOIN users u ON u.id = pr.user_id
        WHERE pr.token_hash = ${tokenHash}
        LIMIT 1
      `);
      const row = (r.rows[0] as any) ?? null;
      if (!row) throw Object.assign(new Error("invalid token"), { status: 400 });
      if (row.consumed_at) throw Object.assign(new Error("token already used"), { status: 409 });
      if (new Date(row.expires_at).getTime() < Date.now())
        throw Object.assign(new Error("token expired"), { status: 410 });

      const passwordHash = await bcrypt.hash(parse.data.password, 12);
      // Reset the password AND revoke every session issued before now — a reset
      // must kill any token a thief might hold. We truncate the revocation epoch
      // to the second so the brand-new session we sign below (whose JWT `iat` is
      // floored to the current second) is never caught by its own reset.
      await tx.execute(sql`
        UPDATE users
        SET password_hash = ${passwordHash},
            sessions_invalid_after = date_trunc('second', now()),
            updated_at = now()
        WHERE id = ${row.user_id}
      `);
      await tx.execute(sql`
        UPDATE password_resets SET consumed_at = now() WHERE id = ${row.id}
      `);

      return {
        userId: row.user_id,
        tenantId: row.tenant_id,
        branchId: row.branch_id,
        roles: row.roles ?? [],
        email: row.email,
        name: row.name,
        permissions: row.permissions ?? [],
      };
    });

    // Drop any cached revocation epoch for this user so the new stamp takes
    // effect immediately across this process (older sessions die at once).
    clearSessionRevocationCache(session.userId);

    const token = await signSession(session);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(sessionCookieForRoles(session.roles), token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_TTL_SECONDS,
      path: "/",
    });
    return res;
  } catch (err: any) {
    return handleApiError(err);
  }
}
