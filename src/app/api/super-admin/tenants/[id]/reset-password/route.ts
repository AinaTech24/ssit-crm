import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/super-admin/tenants/[id]/reset-password
 *
 * Platform-admin action: send a password-reset link to the tenant's owner (or,
 * if there's no owner, the oldest active user with an email). Mirrors the
 * self-service /api/auth/forgot flow — a one-time hashed token + emailed link,
 * valid for 1 hour — but initiated by Equitywala support. The admin never sees or
 * sets the password; the user picks a new one via the link.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { sendSystemEmail, actionEmailHtml } from "@/lib/comms/system-email";

export const dynamic = "force-dynamic";

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  const head = user.slice(0, 1);
  return `${head}${"*".repeat(Math.max(1, user.length - 1))}@${domain}`;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tenantId } = await params;
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.tenant.edit");

    const built = await withPlatformAdmin(session.userId, async (tx) => {
      // Prefer the owner; fall back to the oldest active user with an email.
      const userRows = await tx.execute(sql`
        SELECT id, email, name
        FROM users
        WHERE tenant_id = ${tenantId}::uuid AND status = 'active' AND email IS NOT NULL AND email <> ''
        ORDER BY (roles::text ILIKE '%owner%') DESC, created_at ASC
        LIMIT 1
      `);
      const user = (userRows.rows[0] as any) ?? null;
      if (!user) return null;

      const token = crypto.randomBytes(32).toString("base64url");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      const email = String(user.email).toLowerCase();

      await tx.execute(sql`
        INSERT INTO password_resets (id, user_id, tenant_id, email, token_hash, expires_at,
                                     request_ip, request_user_agent, created_at, updated_at)
        VALUES (${uuid()}, ${user.id}, ${tenantId}, ${email}, ${tokenHash}, ${expiresAt},
                ${req.headers.get("x-forwarded-for") ?? "ssit-admin"},
                ${req.headers.get("user-agent") ?? ""},
                now(), now())
      `);

      const base = process.env.APP_URL ?? "http://localhost:3000";
      return { resetUrl: `${base}/reset-password?token=${token}`, email, name: (user.name as string) ?? null };
    });

    if (!built) {
      return NextResponse.json({ error: "No active user with an email to reset for this tenant." }, { status: 404 });
    }

    const res = await sendSystemEmail({
      tenantId,
      to: built.email,
      subject: "Reset your password",
      text:
        `Hi${built.name ? " " + built.name : ""},\n\n` +
        `An administrator initiated a password reset for your account. Open this link to set a new password (valid for 1 hour):\n${built.resetUrl}\n\n` +
        `If you didn't expect this, contact support.`,
      html: actionEmailHtml({
        heading: "Reset your password",
        intro: `Hi${built.name ? " " + built.name : ""}, an administrator initiated a password reset for your account. This link is valid for 1 hour.`,
        buttonLabel: "Set a new password",
        buttonUrl: built.resetUrl,
        note: "If you didn't expect this, please contact support.",
      }),
      idempotencyKey: `pwreset-admin:${built.email}:${built.resetUrl.slice(-16)}`,
    });

    return NextResponse.json({
      ok: true,
      sentTo: maskEmail(built.email),
      emailSent: res.sent,
      // Dev convenience only — never leak the live link in production.
      ...(process.env.NODE_ENV !== "production" ? { devResetUrl: built.resetUrl } : {}),
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
