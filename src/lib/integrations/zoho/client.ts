/**
 * Zoho CRM API client — OAuth token handling + record upsert.
 *
 * Credentials are per-tenant (each MFD registers their own Zoho OAuth app), so
 * the client id/secret travel with the call rather than coming from env.
 *
 * Access tokens last ~1 hour and Zoho blocks minting more than 10 per refresh
 * token per 10 minutes, so we cache the access token per tenant in-process.
 *
 * Idempotency: we UPSERT by an external-id field (the MFD adds a custom
 * single-line field, default "Equitywala_Record_ID", to each synced Zoho module), so
 * re-pushing a record updates the existing Zoho record instead of duplicating it.
 */
import { accountsServer, apiDomain, type ZohoDataCenter } from "./datacenters";
import type { ZohoConnection } from "./credentials";

const ZOHO_API_VERSION = "v8";

/** Exchange an authorization code (OAuth callback) for a long-lived refresh token. */
export async function exchangeCodeForTokens(
  dc: ZohoDataCenter,
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string
): Promise<{ refreshToken: string; apiDomain?: string } | { error: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });
  const res = await fetch(`${accountsServer(dc)}/oauth/v2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || j.error || !j.refresh_token) {
    return { error: j.error ?? `Token exchange failed (HTTP ${res.status})` };
  }
  return { refreshToken: j.refresh_token, apiDomain: j.api_domain };
}

// ── access-token cache ──────────────────────────────────────────────────────
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function accessTokenFor(conn: ZohoConnection): Promise<string> {
  const cached = tokenCache.get(conn.tenantId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: conn.clientId,
    client_secret: conn.clientSecret,
    refresh_token: conn.refreshToken,
  });
  const res = await fetch(`${accountsServer(conn.dataCenter)}/oauth/v2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || j.error || !j.access_token) {
    throw new Error(`Zoho token refresh failed: ${j.error ?? `HTTP ${res.status}`}`);
  }
  const expiresInMs = (Number(j.expires_in) || 3600) * 1000;
  tokenCache.set(conn.tenantId, { token: j.access_token, expiresAt: Date.now() + expiresInMs });
  return j.access_token;
}

export type ZohoUpsertResult = {
  externalIdValue: string;
  ok: boolean;
  zohoId?: string;
  error?: string;
};

/**
 * Upsert up to 100 records into a Zoho module, keyed by `externalIdField`.
 * Returns one result per input record.
 */
export async function upsertRecords(
  conn: ZohoConnection,
  module: string,
  records: Array<Record<string, any>>,
  externalIdField: string
): Promise<ZohoUpsertResult[]> {
  if (records.length === 0) return [];
  if (records.length > 100) throw new Error("Zoho upsert accepts at most 100 records per call.");
  const token = await accessTokenFor(conn);
  const res = await fetch(`${apiDomain(conn.dataCenter)}/crm/${ZOHO_API_VERSION}/${encodeURIComponent(module)}/upsert`, {
    method: "POST",
    headers: { Authorization: `Zoho-oauthtoken ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ data: records, duplicate_check_fields: [externalIdField] }),
  });
  const j = (await res.json().catch(() => ({}))) as any;
  const rows: any[] = Array.isArray(j?.data) ? j.data : [];
  return records.map((rec, i) => {
    const r = rows[i];
    const externalIdValue = String(rec[externalIdField] ?? "");
    if (r && (r.code === "SUCCESS" || r.status === "success")) {
      return { externalIdValue, ok: true, zohoId: r.details?.id != null ? String(r.details.id) : undefined };
    }
    const error = r?.message || j?.message || `HTTP ${res.status}`;
    return { externalIdValue, ok: false, error: String(error) };
  });
}
