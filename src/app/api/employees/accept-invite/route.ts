import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/employees/accept-invite
 * Body: { token, password, name? }
 *
 * Validates the invite token, creates the user with the granted roles,
 * stamps the invite as accepted, and logs the new user in.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withSystem, withTenant } from "@/db/client";
import { signSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";
import { ASSIGNABLE_ROLES } from "@/lib/auth/rbac";
import { autoEnrol } from "@/lib/induction/engine";

const ASSIGNABLE = new Set<string>(ASSIGNABLE_ROLES);

export const dynamic = "force-dynamic";

const Body = z.object({
  token: z.string().min(20),
  password: z.string().min(8),
  name: z.string().min(2).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const { token, password, name } = parse.data;
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const result = await withSystem(async (tx) => {
      const inv = (
        await tx.execute(sql`SELECT * FROM user_invites WHERE token_hash = ${tokenHash} LIMIT 1`)
      ).rows[0] as any;
      if (!inv) throw Object.assign(new Error("invalid token"), { status: 400 });
      if (inv.accepted_at) throw Object.assign(new Error("invite already used"), { status: 409 });
      if (inv.revoked_at) throw Object.assign(new Error("invite revoked"), { status: 410 });
      if (new Date(inv.expires_at).getTime() < Date.now()) {
        throw Object.assign(new Error("invite expired"), { status: 410 });
      }

      const userId = uuid();
      const pwHash = await bcrypt.hash(password, 12);

      // Re-validate the granted roles against the assignable allowlist and bind
      // them as a PARAMETER (never string-interpolated). This closes both the
      // SQL-injection vector (the old sql.raw(`ARRAY[...]`) built the literal
      // from invite-supplied strings) and any privilege-escalation attempt to
      // smuggle in a platform role.
      const safeRoles = ((inv.roles_to_grant as string[] | null) ?? []).filter((r) => ASSIGNABLE.has(r));
      if (safeRoles.length === 0) {
        throw Object.assign(new Error("invite has no valid roles to grant"), { status: 400 });
      }

      // Build the roles array as ARRAY[$1, $2, …]::text[]. Embedding a JS array
      // directly (`${safeRoles}`) makes Drizzle EXPAND it into comma-separated
      // placeholders, which adds an extra value to the VALUES list and 500s when
      // the invite grants 2+ roles. sql.join keeps each role a single bound param.
      const rolesSql = sql`ARRAY[${sql.join(safeRoles.map((r) => sql`${r}`), sql`, `)}]::text[]`;

      // Accepting an emailed invite token PROVES ownership of the address, so
      // the new user is email-verified on creation. Without this they'd be
      // permanently blocked from inviting their own team (the invite endpoint
      // gates on email_verified_at, and verification is otherwise only wired
      // into self-serve signup — an invited manager has no path to it).
      await tx.execute(sql`
        INSERT INTO users (
          id, tenant_id, branch_id, email, name, password_hash, roles, status,
          email_verified_at, activated_at, created_at, updated_at
        )
        VALUES (
          ${userId}, ${inv.tenant_id}, ${inv.branch_id}, ${inv.email}, ${name ?? inv.name ?? inv.email},
          ${pwHash}, ${rolesSql}, 'active', now(), now(), now(), now()
        )
        ON CONFLICT (tenant_id, email) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            roles = EXCLUDED.roles,
            status = 'active',
            email_verified_at = COALESCE(users.email_verified_at, now()),
            activated_at = now(),
            updated_at = now()
        RETURNING id
      `);

      await tx.execute(sql`
        UPDATE user_invites SET accepted_at = now(), accepted_user_id = ${userId} WHERE id = ${inv.id}
      `);

      return {
        userId,
        tenantId: inv.tenant_id,
        branchId: inv.branch_id,
        email: inv.email,
        name: name ?? inv.name ?? inv.email,
        roles: safeRoles,
      };
    });

    // Auto-enrol the joiner on the induction track matching their roles.
    // Deliberately outside the invite transaction and swallowed on failure —
    // a training assignment must never block someone from accepting their
    // invite and signing in. If it doesn't happen, an admin can enrol manually.
    try {
      await withTenant(result.tenantId, async (tx) => {
        await autoEnrol(tx, result.tenantId, result.userId, result.roles);
      });
    } catch {
      /* non-fatal — see above */
    }

    const tokenJwt = await signSession({
      userId: result.userId,
      tenantId: result.tenantId,
      branchId: result.branchId,
      roles: result.roles,
      email: result.email,
      name: result.name,
    });

    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, tokenJwt, {
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
