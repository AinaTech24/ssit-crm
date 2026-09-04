/**
 * Email-verification token issuance + consumption.
 *
 * Mirrors the password-reset flow: a random token is emailed, only its
 * SHA-256 hash is stored, the token is single-use with a TTL. Consuming a
 * valid token stamps users.email_verified_at.
 *
 * Sending is best-effort (never throws) so signup never 500s just because
 * platform email isn't wired — the same contract as sendSystemEmail.
 */

import crypto from "node:crypto";
import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { sendSystemEmail, actionEmailHtml } from "@/lib/comms/system-email";

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Create a fresh verification token for a user, persist its hash, and email
 * the verification link. Returns the link so callers can surface it if email
 * isn't configured (parity with the invite flow).
 */
export async function issueEmailVerification(args: {
  userId: string;
  tenantId: string;
  email: string;
  name?: string;
  firmName?: string;
  /** Origin the link should point at — pass the request host so white-labeled
   *  firms get links on their own domain. Defaults to APP_URL. */
  baseUrl?: string;
}): Promise<{ verifyUrl: string; emailSent: boolean }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + TTL_MS);

  await withSystem(async (tx) => {
    await tx.execute(sql`
      INSERT INTO email_verifications (id, user_id, tenant_id, email, token_hash, expires_at, created_at, updated_at)
      VALUES (${uuid()}, ${args.userId}::uuid, ${args.tenantId}::uuid, ${args.email}, ${tokenHash}, ${expiresAt}, now(), now())
    `);
  });

  const base = args.baseUrl ?? process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const verifyUrl = `${base}/api/auth/verify-email?token=${token}`;

  const res = await sendSystemEmail({
    tenantId: args.tenantId,
    to: args.email,
    subject: "Confirm your email to activate your Equitywala workspace",
    text:
      `Welcome${args.name ? `, ${args.name}` : ""}! Confirm this email address to finish setting up ` +
      `${args.firmName ?? "your firm"}'s workspace (link valid for 24 hours):\n\n${verifyUrl}`,
    html: actionEmailHtml({
      heading: "Confirm your email",
      intro: `Welcome${args.name ? `, ${args.name}` : ""}! Confirm this email address to finish setting up ${
        args.firmName ?? "your firm"
      }'s workspace. This link is valid for 24 hours.`,
      buttonLabel: "Confirm email",
      buttonUrl: verifyUrl,
    }),
    idempotencyKey: `verify:${tokenHash.slice(0, 24)}`,
  });

  return { verifyUrl, emailSent: res.sent };
}

/**
 * Consume a verification token. Returns the verified user id on success, or a
 * failure reason. Marks the token consumed and stamps email_verified_at in one
 * system transaction.
 */
export async function consumeEmailVerification(
  token: string
): Promise<{ ok: true; userId: string } | { ok: false; reason: "invalid" | "expired" | "used" }> {
  if (!token) return { ok: false, reason: "invalid" };
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  return withSystem(async (tx) => {
    const row = (
      await tx.execute(sql`
        SELECT id, user_id, tenant_id, expires_at, consumed_at
        FROM email_verifications
        WHERE token_hash = ${tokenHash}
        LIMIT 1
      `)
    ).rows[0] as
      | { id: string; user_id: string; tenant_id: string; expires_at: string; consumed_at: string | null }
      | undefined;

    if (!row) return { ok: false as const, reason: "invalid" as const };
    if (row.consumed_at) return { ok: false as const, reason: "used" as const };
    if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false as const, reason: "expired" as const };

    await tx.execute(sql`UPDATE email_verifications SET consumed_at = now(), updated_at = now() WHERE id = ${row.id}::uuid`);
    await tx.execute(sql`UPDATE users SET email_verified_at = now(), updated_at = now() WHERE id = ${row.user_id}::uuid`);

    return { ok: true as const, userId: row.user_id as string };
  });
}
