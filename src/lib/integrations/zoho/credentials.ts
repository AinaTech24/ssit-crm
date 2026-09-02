/**
 * Per-tenant Zoho connection storage.
 *
 * Each MFD registers their OWN Zoho OAuth app and enters its Client ID +
 * Client Secret in the admin UI; we store them (encrypted, same crypto the
 * comms adapters use) in `tenant_integrations` (provider = "zoho"), then run the
 * OAuth flow with those creds and store the resulting refresh token alongside.
 *
 * Connection lifecycle (all in one encrypted config blob):
 *   1. no row                          → not configured
 *   2. {clientId, clientSecret, dc}    → credentials saved, awaiting OAuth
 *   3. + {refreshToken}                → fully connected (sync runs)
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { tenantIntegrations } from "@/db/schema/tenant_integrations";
import { decrypt, encrypt } from "@/lib/crypto";
import { dcFromLocation, type ZohoDataCenter } from "./datacenters";

const PROVIDER = "zoho" as const;

type StoredConfig = {
  clientId: string;
  clientSecret: string;
  dataCenter: string;
  refreshToken?: string;
  grantedBy?: string | null;
};

/** App credentials only (enough to start/exchange OAuth). */
export interface ZohoAppCreds {
  clientId: string;
  clientSecret: string;
  dataCenter: ZohoDataCenter;
}

/** Full connection — only returned once OAuth has produced a refresh token. */
export interface ZohoConnection extends ZohoAppCreds {
  tenantId: string;
  refreshToken: string;
  grantedBy?: string | null;
}

/** Non-secret status for the Settings UI. */
export interface ZohoState {
  hasCredentials: boolean;
  connected: boolean;
  dataCenter: ZohoDataCenter | null;
  grantedBy: string | null;
  clientIdHint: string | null;
}

async function readConfig(tx: Tx, tenantId: string): Promise<{ rowId: string; cfg: StoredConfig } | null> {
  const [row] = await tx
    .select()
    .from(tenantIntegrations)
    .where(
      and(
        eq(tenantIntegrations.tenantId, tenantId),
        eq(tenantIntegrations.provider, PROVIDER),
        isNull(tenantIntegrations.userId),
        eq(tenantIntegrations.isActive, true)
      )
    )
    .limit(1);
  if (!row) return null;
  try {
    return { rowId: row.id, cfg: JSON.parse(decrypt(row.encryptedConfig)) as StoredConfig };
  } catch (err) {
    console.error(`[zoho] failed to decrypt config for tenant ${tenantId}:`, (err as Error).message);
    return null;
  }
}

async function writeConfig(tx: Tx, tenantId: string, cfg: StoredConfig): Promise<void> {
  const encryptedConfig = encrypt(JSON.stringify(cfg));
  const existing = await readConfigRowId(tx, tenantId);
  if (existing) {
    await tx
      .update(tenantIntegrations)
      .set({ encryptedConfig, isActive: true, updatedAt: new Date() })
      .where(eq(tenantIntegrations.id, existing));
    return;
  }
  await tx.insert(tenantIntegrations).values({
    tenantId,
    userId: null,
    provider: PROVIDER,
    encryptedConfig,
    isActive: true,
  } as any);
}

async function readConfigRowId(tx: Tx, tenantId: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: tenantIntegrations.id })
    .from(tenantIntegrations)
    .where(
      and(eq(tenantIntegrations.tenantId, tenantId), eq(tenantIntegrations.provider, PROVIDER), isNull(tenantIntegrations.userId))
    )
    .limit(1);
  return row?.id ?? null;
}

/** Full sync-ready connection (clientId + secret + refresh token), or null. */
export async function getZohoConnection(tx: Tx, tenantId: string): Promise<ZohoConnection | null> {
  const read = await readConfig(tx, tenantId);
  if (!read) return null;
  const { cfg } = read;
  if (!cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) return null;
  return {
    tenantId,
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    dataCenter: dcFromLocation(cfg.dataCenter),
    refreshToken: cfg.refreshToken,
    grantedBy: cfg.grantedBy ?? null,
  };
}

/** App creds for starting/exchanging OAuth (no refresh token required yet). */
export async function getZohoAppCreds(tx: Tx, tenantId: string): Promise<ZohoAppCreds | null> {
  const read = await readConfig(tx, tenantId);
  if (!read?.cfg.clientId || !read.cfg.clientSecret) return null;
  return { clientId: read.cfg.clientId, clientSecret: read.cfg.clientSecret, dataCenter: dcFromLocation(read.cfg.dataCenter) };
}

export async function getZohoState(tx: Tx, tenantId: string): Promise<ZohoState> {
  const read = await readConfig(tx, tenantId);
  const cfg = read?.cfg;
  return {
    hasCredentials: !!(cfg?.clientId && cfg?.clientSecret),
    connected: !!cfg?.refreshToken,
    dataCenter: cfg ? dcFromLocation(cfg.dataCenter) : null,
    grantedBy: cfg?.grantedBy ?? null,
    clientIdHint: cfg?.clientId ? `…${cfg.clientId.slice(-8)}` : null,
  };
}

/**
 * Save the MFD's Zoho app credentials. Re-entering them invalidates any prior
 * refresh token (it belonged to a different app), so the MFD must re-authenticate.
 */
export async function saveZohoAppCredentials(
  tx: Tx,
  tenantId: string,
  input: { clientId: string; clientSecret: string; dataCenter: ZohoDataCenter }
): Promise<void> {
  await writeConfig(tx, tenantId, {
    clientId: input.clientId.trim(),
    clientSecret: input.clientSecret.trim(),
    dataCenter: input.dataCenter,
    refreshToken: undefined,
    grantedBy: null,
  });
}

/** Persist the refresh token after a successful OAuth grant (keeps the app creds). */
export async function saveZohoRefreshToken(
  tx: Tx,
  tenantId: string,
  input: { refreshToken: string; dataCenter?: ZohoDataCenter; grantedBy?: string | null }
): Promise<void> {
  const read = await readConfig(tx, tenantId);
  if (!read) throw new Error("Zoho app credentials are not set for this tenant.");
  await writeConfig(tx, tenantId, {
    ...read.cfg,
    refreshToken: input.refreshToken,
    dataCenter: input.dataCenter ?? read.cfg.dataCenter,
    grantedBy: input.grantedBy ?? null,
  });
}

/** Disconnect — drop the refresh token (stop syncing) but keep the app creds so
 *  the MFD can re-authenticate without re-entering Client ID/Secret. */
export async function disconnectZoho(tx: Tx, tenantId: string): Promise<void> {
  const read = await readConfig(tx, tenantId);
  if (!read) return;
  await writeConfig(tx, tenantId, { ...read.cfg, refreshToken: undefined, grantedBy: null });
}
