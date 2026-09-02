/**
 * Email-OTP helpers for public (unauthenticated) client forms.
 *
 * Used by:
 *   - POST /api/public/risk-profile/otp/send   — generate + store + email a code
 *   - POST /api/public/risk-profile/submit     — verify the code at submit time
 *
 * The code itself is never persisted or logged — only
 * sha256(`<code>:<secret>`) lands in `public_email_otps.code_hash`. The
 * secret mirrors the JWT/session code (src/lib/comms/oauth.ts pattern):
 * AUTH_SECRET first, NEXTAUTH_SECRET as the fallback the auth stack actually
 * requires in prod.
 */

import crypto from "node:crypto";

/** Code lifetime — 10 minutes. */
export const OTP_TTL_MS = 10 * 60 * 1000;
/** Wrong-code strikes before the code is treated as expired. */
export const OTP_MAX_ATTEMPTS = 5;
/** Minimum seconds between resends for the same token. */
export const OTP_RESEND_COOLDOWN_SEC = 60;

function otpSecret(): string {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
}

/** Cryptographically-random 6-digit numeric code ("042719" style, zero-padded). */
export function generateOtpCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** sha256 hex of `<code>:<secret>` — the only form the code is stored in. */
export function hashOtpCode(code: string): string {
  return crypto.createHash("sha256").update(`${code}:${otpSecret()}`).digest("hex");
}

/** Constant-time hash comparison (both sides are fixed-length sha256 hex). */
export function otpHashMatches(code: string, storedHash: string): boolean {
  const a = Buffer.from(hashOtpCode(code), "utf8");
  const b = Buffer.from(String(storedHash ?? ""), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** `pritesh@gmail.com` → `pr•••@gmail.com` (first 2 chars + domain). */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "•••";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const keep = local.slice(0, Math.min(2, local.length));
  return `${keep}•••@${domain}`;
}

/** Shared "looks like an email" check (mirrors calculators/share). */
export function isValidEmail(s: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}
