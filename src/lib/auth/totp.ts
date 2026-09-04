/**
 * TOTP (RFC 6238) — time-based one-time passwords for two-factor auth.
 *
 * Self-contained: HMAC-SHA1 via node:crypto + a small RFC 4648 base32 codec.
 * No external dependency. Compatible with Google Authenticator, Authy, 1Password,
 * Microsoft Authenticator, etc.
 *
 * Default parameters match every common authenticator app: 30s step, 6 digits,
 * SHA-1. verifyTotp() checks a ±1-step window to tolerate clock drift.
 *
 * SECURITY NOTE: the secret is the shared key — treat it like a password. We
 * store it in users.two_fa_secret. In production you should encrypt it at rest
 * with an app/KMS key; for now it's stored as the base32 string. It's only ever
 * returned to the enrolling user's own authenticated browser (in the QR / setup
 * response), never logged.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { encrypt, decrypt } from "@/lib/crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Encrypt a TOTP secret for storage at rest (AES-256-GCM via ENCRYPTION_KEY).
 * Store the result in users.two_fa_secret instead of the raw base32 string.
 */
export function encryptSecret(secret: string): string {
  return encrypt(secret);
}

/**
 * Decrypt a stored TOTP secret. BACKWARD-COMPATIBLE: the encrypted format is
 * `iv:tag:cipher` (3 colon-separated hex parts); a legacy plaintext base32
 * secret has no colons, so it's returned as-is. This lets already-enrolled
 * users keep working — they get re-encrypted next time they re-enroll.
 */
export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return "";
  if (stored.split(":").length !== 3) return stored; // legacy plaintext
  try {
    return decrypt(stored);
  } catch {
    return stored;
  }
}

/** Encode bytes to RFC 4648 base32 (no padding) — the format authenticators expect. */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Decode a base32 string (ignores spaces + padding, case-insensitive). */
export function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/=+$/,"").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue; // skip non-alphabet chars
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Generate a fresh 20-byte (160-bit) secret as a base32 string. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Compute the TOTP code for a given secret at unix time `nowMs`. */
export function totp(
  secretBase32: string,
  opts: { step?: number; digits?: number; nowMs?: number } = {}
): string {
  const step = opts.step ?? 30;
  const digits = opts.digits ?? 6;
  const nowMs = opts.nowMs ?? Date.now();
  const counter = Math.floor(nowMs / 1000 / step);

  // 8-byte big-endian counter.
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const key = base32Decode(secretBase32);
  const hmac = createHmac("sha1", key).update(counterBuf).digest();

  // Dynamic truncation (RFC 4226 §5.3).
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const code = (binCode % 10 ** digits).toString().padStart(digits, "0");
  return code;
}

/**
 * Verify a user-entered code against the secret, allowing ±`window` time steps
 * (default 1 = ±30s) for clock drift. Constant-time compare per candidate.
 */
export function verifyTotp(
  secretBase32: string,
  token: string,
  opts: { step?: number; digits?: number; window?: number; nowMs?: number } = {}
): boolean {
  const digits = opts.digits ?? 6;
  const cleaned = (token ?? "").replace(/\s+/g, "");
  if (!/^\d+$/.test(cleaned) || cleaned.length !== digits) return false;
  const step = opts.step ?? 30;
  const window = opts.window ?? 1;
  const nowMs = opts.nowMs ?? Date.now();

  for (let w = -window; w <= window; w++) {
    const candidate = totp(secretBase32, { step, digits, nowMs: nowMs + w * step * 1000 });
    if (safeEqual(candidate, cleaned)) return true;
  }
  return false;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Build the otpauth:// URI an authenticator app scans. `label` is usually the
 * user's email; `issuer` brands the entry (shows as "Equitywala").
 */
export function otpauthUri(secretBase32: string, label: string, issuer = "Equitywala"): string {
  const enc = encodeURIComponent;
  const acct = enc(label);
  const iss = enc(issuer);
  return `otpauth://totp/${iss}:${acct}?secret=${secretBase32}&issuer=${iss}&algorithm=SHA1&digits=6&period=30`;
}

/** Generate N human-friendly backup codes (recovery if the device is lost). */
export function generateBackupCodes(n = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < n; i++) {
    // 10 hex chars → "a1b2-c3d4e5" style, easy to read + type.
    const hex = randomBytes(5).toString("hex");
    codes.push(`${hex.slice(0, 5)}-${hex.slice(5)}`);
  }
  return codes;
}
