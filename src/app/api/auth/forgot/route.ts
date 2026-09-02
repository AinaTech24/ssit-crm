/**
 * POST /api/auth/forgot  Body: { email }
 *
 * Generates a one-time token, stores its hash, returns the reset URL.
 *
 * IMPORTANT: response is the same shape whether the email exists or not
 * (to prevent enumeration). The link is only sent for real users.
 *
 * Email send is stubbed — we surface the URL in the dev response and via
 * server log. In production replace with the comms pipeline.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withSystem } from "@/db/client";
import { enforce } from "@/lib/rate-limit";
import { sendSystemEmail, actionEmailHtml } from "@/lib/comms/system-email";
import { requestBaseUrl } from "@/lib/url/request-base";

export const dynamic = "force-dynamic";

const Body = z.object({ email: z.string().email() });

export async function POST(req: NextRequest) {
  // 5 reset requests per IP per hour. Stops email-enumeration probes and
  // protects user mailboxes from being flooded with reset emails.
  const limited = enforce(req, "auth.forgot", { limit: 5, windowSec: 60 * 60 });
  if (limited) return limited;

  const parse = Body.safeParse(await req.json().catch(() => ({})));
  if (!parse.success) return NextResponse.json({ ok: true }); // shape-stable
  const email = parse.data.email.toLowerCase();
  // Point the reset link at the host the request came in on (a firm's own
  // white-label domain), falling back to APP_URL. Resolved in request context.
  const baseUrl = await requestBaseUrl();

  try {
    const { resetUrl, tenantId, name } = await withSystem(async (tx) => {
      const userRows = await tx.execute(sql`
        SELECT id, tenant_id, name FROM users WHERE lower(email) = ${email} LIMIT 1
      `);
      const user = (userRows.rows[0] as any) ?? null;

      // Always return 200 to avoid leaking which emails exist
      if (!user) return { resetUrl: null, tenantId: null, name: null };

      const token = crypto.randomBytes(32).toString("base64url");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await tx.execute(sql`
        INSERT INTO password_resets (id, user_id, tenant_id, email, token_hash, expires_at,
                                     request_ip, request_user_agent, created_at, updated_at)
        VALUES (${uuid()}, ${user.id}, ${user.tenant_id}, ${email}, ${tokenHash}, ${expiresAt},
                ${req.headers.get("x-forwarded-for") ?? ""},
                ${req.headers.get("user-agent") ?? ""},
                now(), now())
      `);

      const url = `${baseUrl}/reset-password?token=${token}`;

      return { resetUrl: url, tenantId: user.tenant_id as string, name: (user.name as string) ?? null };
    });

    // Send the reset email (best-effort, never throws / never leaks). Falls
    // back to a server log when email isn't configured so dev still works.
    if (resetUrl && tenantId) {
      const res = await sendSystemEmail({
        tenantId,
        to: email,
        subject: "Reset your password",
        text:
          `Hi${name ? " " + name : ""},\n\n` +
          `We received a request to reset your password. Open this link to set a new one (valid for 1 hour):\n${resetUrl}\n\n` +
          `If you didn't request this, you can safely ignore this email.`,
        html: actionEmailHtml({
          heading: "Reset your password",
          intro: `Hi${name ? " " + name : ""}, we received a request to reset your password. This link is valid for 1 hour.`,
          buttonLabel: "Set a new password",
          buttonUrl: resetUrl,
          note: "If you didn't request this, you can safely ignore this email.",
        }),
        idempotencyKey: `pwreset:${email}:${resetUrl.slice(-16)}`,
      });
      if (!res.sent) {
        // Never log the reset link (a live credential) in production. In dev the
        // link is already returned in the response below for testing.
        if (process.env.NODE_ENV !== "production") {
          console.log(`[forgot-password] email not sent (${res.reason}); dev link for ${email}: ${resetUrl}`);
        } else {
          console.warn(`[forgot-password] email send failed (${res.reason}) for a reset request`);
        }
      }
    }

    // In dev, surface the link for testing. Never in prod.
    if (process.env.NODE_ENV !== "production" && resetUrl) {
      return NextResponse.json({ ok: true, devResetUrl: resetUrl });
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[forgot-password]", err);
    return NextResponse.json({ ok: true }); // never leak
  }
}
