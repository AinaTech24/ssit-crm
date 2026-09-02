/**
 * RTA mailback catch-all inbox configuration — the operator sets it from SSIT
 * Admin (no redeploy / env edit), exactly like the platform email config.
 *
 * This is the ONE platform-level mailbox every MFD forwards their RTA mailback to
 * (e.g. rta@crm.ssit.com on Hostinger). It is NOT tenant-scoped — it lives in
 * platform_settings('rta_inbox'). The IMAP password is encrypted at rest
 * (AES-256-GCM) and only decrypted in-process by the poller. The RTA_INBOX_*
 * environment variables remain the fallback.
 */
import { pool } from "@/db/client";
import { encrypt, decrypt } from "@/lib/crypto";

/** Shape persisted in platform_settings.value for key='rta_inbox'. Password encrypted. */
type StoredInboxConfig = {
  host?: string | null;
  port?: number | null;
  secure?: boolean | null;
  user?: string | null;
  passEnc?: string | null;
  /** The domain unique forward addresses are minted under (rta-<token>@<domain>). */
  domain?: string | null;
  /** Delete forwarded mail from the catch-all once it has been imported. */
  deleteAfterImport?: boolean | null;
  /** Days to keep an imported mail before deleting it. 0 = delete on next sweep. */
  retentionDays?: number | null;
};

export type ResolvedInboxConfig = {
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  pass: string | null;
  domain: string;
  configured: boolean;
  source: "db" | "env" | "none";
  /** Cleanup: remove imported mail from the catch-all (off unless switched on). */
  deleteAfterImport: boolean;
  /** Grace period before an imported mail is deleted. */
  retentionDays: number;
};

const DEFAULT_DOMAIN = "crm.ssit.com";
/**
 * A week's grace by default. Long enough to notice a bad import and re-run it
 * from the original mail; short enough that the mailbox doesn't grow unbounded.
 */
const DEFAULT_RETENTION_DAYS = 7;

function normRetention(d: number | null | undefined): number {
  const n = Number(d);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_RETENTION_DAYS;
  return Math.min(Math.floor(n), 365);
}
const TTL_MS = 60_000;
let _cache: { cfg: ResolvedInboxConfig; at: number } | null = null;

function normDomain(d: string | null | undefined): string {
  return (d || DEFAULT_DOMAIN).trim().replace(/^@/, "").toLowerCase() || DEFAULT_DOMAIN;
}

async function readStored(): Promise<StoredInboxConfig | null> {
  try {
    const r = await pool.query("SELECT value FROM platform_settings WHERE key = 'rta_inbox' LIMIT 1");
    const v = r.rows?.[0]?.value;
    if (v && typeof v === "object") return v as StoredInboxConfig;
  } catch {
    // Table missing (pre-migration) → env fallback.
  }
  return null;
}

/** Resolve the active inbox config — DB first (password decrypted), then env. */
export async function loadRtaInboxConfig(force = false): Promise<ResolvedInboxConfig> {
  if (!force && _cache && Date.now() - _cache.at < TTL_MS) return _cache.cfg;
  const stored = await readStored();
  let cfg: ResolvedInboxConfig;
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
      port: stored.port ?? 993,
      secure: stored.secure ?? true,
      user: stored.user ?? null,
      pass,
      domain: normDomain(stored.domain),
      configured: !!(stored.host && stored.user && pass),
      source: "db",
      deleteAfterImport: stored.deleteAfterImport ?? false,
      retentionDays: normRetention(stored.retentionDays),
    };
  } else {
    const host = process.env.RTA_INBOX_HOST || null;
    const pass = process.env.RTA_INBOX_PASS || null;
    cfg = {
      host,
      port: process.env.RTA_INBOX_PORT ? Number(process.env.RTA_INBOX_PORT) : 993,
      secure: process.env.RTA_INBOX_SECURE ? process.env.RTA_INBOX_SECURE !== "false" : true,
      user: process.env.RTA_INBOX_USER || null,
      pass,
      domain: normDomain(process.env.RTA_INBOX_DOMAIN),
      configured: !!(host && process.env.RTA_INBOX_USER && pass),
      source: host ? "env" : "none",
      deleteAfterImport: process.env.RTA_INBOX_DELETE_AFTER_IMPORT === "1",
      retentionDays: normRetention(
        process.env.RTA_INBOX_RETENTION_DAYS ? Number(process.env.RTA_INBOX_RETENTION_DAYS) : undefined
      ),
    };
  }
  _cache = { cfg, at: Date.now() };
  return cfg;
}

export function invalidateRtaInboxConfigCache(): void {
  _cache = null;
}

/** The domain unique forward addresses are minted under (DB-first, env fallback). */
export async function getInboundDomain(): Promise<string> {
  return (await loadRtaInboxConfig()).domain;
}

/** Whether a catch-all inbox is actually connectable (poller no-ops otherwise). */
export async function isInboxConfigured(): Promise<boolean> {
  return (await loadRtaInboxConfig()).configured;
}

/** Upsert the inbox config. A blank password keeps the previously-saved one. */
export async function saveRtaInboxConfig(
  input: {
    host?: string;
    port?: number;
    secure?: boolean;
    user?: string;
    pass?: string;
    domain?: string;
    deleteAfterImport?: boolean;
    retentionDays?: number;
  },
  adminUserId: string
): Promise<void> {
  const prev = await readStored();
  let passEnc = prev?.passEnc ?? null;
  const freshPass = input.pass?.trim();
  if (freshPass) passEnc = encrypt(freshPass);

  const value: StoredInboxConfig = {
    host: input.host?.trim() || prev?.host || null,
    port: input.port ?? prev?.port ?? 993,
    secure: input.secure ?? prev?.secure ?? true,
    user: input.user?.trim() || prev?.user || null,
    passEnc,
    domain: normDomain(input.domain || prev?.domain),
    deleteAfterImport: input.deleteAfterImport ?? prev?.deleteAfterImport ?? false,
    retentionDays: normRetention(input.retentionDays ?? prev?.retentionDays),
  };
  await pool.query(
    `INSERT INTO platform_settings (key, value, updated_at, updated_by)
     VALUES ('rta_inbox', $1::jsonb, now(), $2::uuid)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(value), adminUserId]
  );
  invalidateRtaInboxConfigCache();
}

/**
 * Return the plaintext mailbox password for the platform-admin UI's "reveal"
 * action. Gated at the route to platform admins — this is the operator's OWN
 * catch-all mailbox credential, which they must be able to read back to verify
 * or correct it (a wrong password fails silently otherwise). Never logged.
 * Returns null when nothing is saved or the ciphertext can't be decrypted
 * (e.g. ENCRYPTION_KEY rotated); falls back to the env var when set.
 */
export async function revealRtaInboxPassword(): Promise<string | null> {
  const stored = await readStored();
  if (stored?.passEnc) {
    try {
      return decrypt(stored.passEnc);
    } catch {
      return null;
    }
  }
  return process.env.RTA_INBOX_PASS || null;
}

/** Masked status for the admin UI — never returns the password. */
export async function getRtaInboxStatusForAdmin(): Promise<{
  configured: boolean;
  source: string;
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  domain: string;
  hasPassword: boolean;
  deleteAfterImport: boolean;
  retentionDays: number;
}> {
  const stored = await readStored();
  const cfg = await loadRtaInboxConfig(true);
  return {
    configured: cfg.configured,
    source: cfg.source,
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user,
    domain: cfg.domain,
    hasPassword: !!(stored?.passEnc || process.env.RTA_INBOX_PASS),
    deleteAfterImport: cfg.deleteAfterImport,
    retentionDays: cfg.retentionDays,
  };
}
