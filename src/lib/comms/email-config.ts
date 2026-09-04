/**
 * Platform email configuration — the operator sets their own SMTP server from
 * Equitywala Admin (no redeploy / env edit). Powers system/transactional email:
 * password resets, team invites, staff alerts.
 *
 * Stored in platform_settings('email'); the SMTP password is encrypted at rest
 * (AES-256-GCM) and only decrypted in-process at send time (never logged or
 * returned to the UI). Env vars (SMTP_*) are the fallback.
 */
import { pool } from "@/db/client";
import { encrypt, decrypt } from "@/lib/crypto";

/** Shape persisted in platform_settings.value for key='email'. Password encrypted. */
type StoredEmailConfig = {
  host?: string | null;
  port?: number | null;
  secure?: boolean | null;
  user?: string | null;
  passEnc?: string | null;
  from?: string | null;
};

export type ResolvedEmailConfig = {
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  pass: string | null;
  from: string;
  configured: boolean;
  source: "db" | "env" | "none";
};

const DEFAULT_FROM = "Equitywala <connect@ssit.com>";
const TTL_MS = 60_000;
let _cache: { cfg: ResolvedEmailConfig; at: number } | null = null;

async function readStored(): Promise<StoredEmailConfig | null> {
  try {
    const r = await pool.query("SELECT value FROM platform_settings WHERE key = 'email' LIMIT 1");
    const v = r.rows?.[0]?.value;
    if (v && typeof v === "object") return v as StoredEmailConfig;
  } catch {
    // Table missing (pre-migration) → env fallback.
  }
  return null;
}

/** Resolve the active SMTP config — DB first (password decrypted), then env. */
export async function loadEmailConfig(force = false): Promise<ResolvedEmailConfig> {
  if (!force && _cache && Date.now() - _cache.at < TTL_MS) return _cache.cfg;
  const stored = await readStored();
  let cfg: ResolvedEmailConfig;
  if (stored?.host) {
    let pass: string | null = null;
    if (stored.passEnc) {
      try {
        pass = decrypt(stored.passEnc);
      } catch {
        pass = null; // bad/old ciphertext (e.g. ENCRYPTION_KEY rotated)
      }
    }
    cfg = {
      host: stored.host,
      port: stored.port ?? 587,
      secure: !!stored.secure,
      user: stored.user ?? null,
      pass,
      from: stored.from || DEFAULT_FROM,
      configured: !!(stored.host && stored.user && pass),
      source: "db",
    };
  } else {
    const host = process.env.SMTP_HOST || null;
    cfg = {
      host,
      port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587,
      secure: process.env.SMTP_SECURE === "true" || process.env.SMTP_SECURE === "1",
      user: process.env.SMTP_USER || null,
      pass: process.env.SMTP_PASS || null,
      from: process.env.EMAIL_FROM_TRANSACTIONAL || process.env.SMTP_FROM || DEFAULT_FROM,
      configured: !!(host && process.env.SMTP_USER && process.env.SMTP_PASS),
      source: host ? "env" : "none",
    };
  }
  _cache = { cfg, at: Date.now() };
  return cfg;
}

export function invalidateEmailConfigCache(): void {
  _cache = null;
}

/** Upsert the SMTP config. A blank password keeps the previously-saved one. */
export async function saveEmailConfig(
  input: { host?: string; port?: number; secure?: boolean; user?: string; pass?: string; from?: string },
  adminUserId: string
): Promise<void> {
  const prev = await readStored();
  let passEnc = prev?.passEnc ?? null;
  const freshPass = input.pass?.trim();
  if (freshPass) passEnc = encrypt(freshPass);

  const value: StoredEmailConfig = {
    host: input.host?.trim() || prev?.host || null,
    port: input.port ?? prev?.port ?? 587,
    secure: input.secure ?? prev?.secure ?? false,
    user: input.user?.trim() || prev?.user || null,
    passEnc,
    from: input.from?.trim() || prev?.from || DEFAULT_FROM,
  };
  await pool.query(
    `INSERT INTO platform_settings (key, value, updated_at, updated_by)
     VALUES ('email', $1::jsonb, now(), $2::uuid)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(value), adminUserId]
  );
  invalidateEmailConfigCache();
}

/** Masked status for the admin UI — never returns the password. */
export async function getEmailStatusForAdmin(): Promise<{
  configured: boolean;
  source: string;
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  from: string;
  hasPassword: boolean;
}> {
  const stored = await readStored();
  const cfg = await loadEmailConfig(true);
  return {
    configured: cfg.configured,
    source: cfg.source,
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user,
    from: cfg.from,
    hasPassword: !!(stored?.passEnc || process.env.SMTP_PASS),
  };
}
