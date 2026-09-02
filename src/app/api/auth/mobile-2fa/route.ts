import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/auth/mobile-2fa   Body: { challenge, code }
 *
 * Mobile sibling of /api/auth/2fa/verify. Completes a 2FA login: validates the
 * short-lived challenge (issued by /api/auth/mobile-login), verifies the TOTP
 * code OR a one-time backup code, then returns the session token in the body
 * (not a cookie). Backup codes are consumed on use.
 *
 * Pre-auth — the challenge token IS the credential, so this lives under
 * /api/auth/* with no requireSession.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { withSystem } from "@/db/client";
import { verify2faChallenge } from "@/lib/auth/jwt";
import { issueSessionToken } from "@/lib/auth/issue-session";
import { verifyTotp, decryptSecret } from "@/lib/auth/totp";
import { enforce } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const Body = z.object({ challenge: z.string().min(10), code: z.string().min(6).max(12) });

export async function POST(req: NextRequest) {
  try {
    const limited = enforce(req, "auth.2fa", { limit: 10, windowSec: 15 * 60 });
    if (limited) return limited;

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "challenge + code required" }, { status: 400 });
    }

    const claim = await verify2faChallenge(parse.data.challenge);
    if (!claim) {
      return NextResponse.json({ error: "challenge expired — sign in again" }, { status: 401 });
    }

    const user = await withSystem(async (tx) => {
      const r = await tx.execute(sql`
        SELECT id, tenant_id, branch_id, email, name, roles, status, permissions,
               two_fa_enabled, two_fa_secret, two_fa_backup_codes
        FROM users WHERE id = ${claim.userId} LIMIT 1
      `);
      return (r.rows[0] ?? null) as any;
    });

    if (!user || !user.two_fa_enabled || !user.two_fa_secret) {
      return NextResponse.json({ error: "invalid challenge" }, { status: 401 });
    }
    if (user.status === "suspended" || user.status === "offboarded") {
      return NextResponse.json({ error: "account inactive" }, { status: 403 });
    }

    const code = parse.data.code.trim();
    let authed = verifyTotp(decryptSecret(user.two_fa_secret), code);

    // Fall back to a one-time backup code (consume it on success).
    if (!authed && Array.isArray(user.two_fa_backup_codes)) {
      const hashes: string[] = user.two_fa_backup_codes;
      for (let i = 0; i < hashes.length; i++) {
        if (await bcrypt.compare(code, hashes[i])) {
          authed = true;
          const remaining = hashes.filter((_, idx) => idx !== i);
          await withSystem(async (tx) => {
            await tx.execute(sql`
              UPDATE users SET two_fa_backup_codes = ${JSON.stringify(remaining)}::jsonb WHERE id = ${user.id}
            `);
          });
          break;
        }
      }
    }

    if (!authed) {
      return NextResponse.json({ error: "invalid code" }, { status: 401 });
    }

    withSystem(async (tx) => {
      await tx.execute(sql`UPDATE users SET last_login_at = now() WHERE id = ${user.id}`);
    }).catch(() => {});

    const token = await issueSessionToken({
      userId: user.id,
      tenantId: user.tenant_id,
      branchId: user.branch_id,
      roles: user.roles,
      email: user.email,
      name: user.name,
      permissions: user.permissions,
    });

    return NextResponse.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, roles: user.roles },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
