/**
 * Mailbox OAuth — "Connect Gmail / Connect Outlook" without storing the user's
 * password. We run the standard authorization-code flow, keep ONLY the long-lived
 * refresh token (encrypted, inside the mailbox row's config blob), and mint a
 * short-lived access token on demand for IMAP/SMTP via XOAUTH2.
 *
 * The whole flow is inert until the firm registers an OAuth app and sets the
 * client id/secret env vars — `isOAuthConfigured()` gates the UI + routes so an
 * un-provisioned button never half-works.
 *
 * Registered redirect URI (add this EXACT value in the Google / Microsoft app):
 *   {origin}/api/settings/integrations/mailbox/oauth/google/callback
 *   {origin}/api/settings/integrations/mailbox/oauth/microsoft/callback
 */

import crypto from "crypto";

export type OAuthProvider = "google" | "microsoft";

export interface OAuthProviderDef {
  id: OAuthProvider;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Mailbox host presets the connected account will sync/send through. */
  imap: { host: string; port: number; secure: boolean };
  smtp: { host: string; port: number; secure: boolean };
}

function microsoftTenant(): string {
  return process.env.MICROSOFT_OAUTH_TENANT?.trim() || "common";
}

export function getProviderDef(provider: OAuthProvider): OAuthProviderDef {
  if (provider === "google") {
    return {
      id: "google",
      label: "Gmail / Google Workspace",
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      // https://mail.google.com/ grants IMAP + SMTP (send) via XOAUTH2.
      scopes: ["https://mail.google.com/", "openid", "email"],
      imap: { host: "imap.gmail.com", port: 993, secure: true },
      smtp: { host: "smtp.gmail.com", port: 465, secure: true },
    };
  }
  const t = microsoftTenant();
  return {
    id: "microsoft",
    label: "Outlook / Microsoft 365",
    authorizeUrl: `https://login.microsoftonline.com/${t}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${t}/oauth2/v2.0/token`,
    scopes: [
      "https://outlook.office.com/IMAP.AccessAsUser.All",
      "https://outlook.office.com/SMTP.Send",
      "offline_access",
      "openid",
      "email",
    ],
    imap: { host: "outlook.office365.com", port: 993, secure: true },
    // 587 = STARTTLS → nodemailer wants secure:false (it upgrades the connection).
    smtp: { host: "smtp.office365.com", port: 587, secure: false },
  };
}

interface OAuthCreds {
  clientId: string;
  clientSecret: string;
}

export function getOAuthCreds(provider: OAuthProvider): OAuthCreds | null {
  const prefix = provider === "google" ? "GOOGLE" : "MICROSOFT";
  const clientId = process.env[`${prefix}_OAUTH_CLIENT_ID`]?.trim();
  const clientSecret = process.env[`${prefix}_OAUTH_CLIENT_SECRET`]?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function isOAuthConfigured(provider: OAuthProvider): boolean {
  return getOAuthCreds(provider) !== null;
}

/** The redirect URI must match what's registered in the provider console. */
export function buildRedirectUri(origin: string, provider: OAuthProvider): string {
  const base = process.env.OAUTH_REDIRECT_BASE?.replace(/\/$/, "") || origin.replace(/\/$/, "");
  return `${base}/api/settings/integrations/mailbox/oauth/${provider}/callback`;
}

// ── Signed state (CSRF + carries who is connecting) ──────────────────────────

function stateSecret(): string {
  return (
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.ENCRYPTION_KEY ||
    "mfd-oauth-dev-state-secret"
  );
}

export interface OAuthState {
  tenantId: string;
  userId: string;
  provider: OAuthProvider;
  /** "user" = personal mailbox; "tenant" = firm mailbox. */
  scope: "user" | "tenant";
  redirectUri: string;
  /** Unix ms — rejected after 10 minutes. */
  iat: number;
}

export function signState(state: OAuthState): string {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  const sig = crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyState(token: string): OAuthState | null {
  try {
    const [payload, sig] = (token || "").split(".");
    if (!payload || !sig) return null;
    const expected = crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
    if (!state.iat || Date.now() - state.iat > 10 * 60_000) return null;
    return state;
  } catch {
    return null;
  }
}

export function buildAuthUrl(provider: OAuthProvider, redirectUri: string, state: string): string {
  const def = getProviderDef(provider);
  const creds = getOAuthCreds(provider);
  if (!creds) throw new Error(`${provider} OAuth is not configured`);
  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: def.scopes.join(" "),
    state,
    access_type: "offline", // Google: ask for a refresh token
    prompt: "consent", // force a refresh token even on re-consent
  });
  return `${def.authorizeUrl}?${params.toString()}`;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresInSec: number;
  email?: string;
}

/** Best-effort email claim from an id_token (no signature check needed — it came
 *  straight from the provider's token endpoint over TLS). */
function emailFromIdToken(idToken?: string): string | undefined {
  if (!idToken) return undefined;
  const parts = idToken.split(".");
  if (parts.length < 2) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return claims.email || claims.preferred_username || claims.upn || undefined;
  } catch {
    return undefined;
  }
}

export async function exchangeCodeForTokens(
  provider: OAuthProvider,
  code: string,
  redirectUri: string
): Promise<OAuthTokens> {
  const def = getProviderDef(provider);
  const creds = getOAuthCreds(provider);
  if (!creds) throw new Error(`${provider} OAuth is not configured`);
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(def.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    throw new Error(`Token exchange failed: ${j.error_description || j.error || res.status}`);
  }
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresInSec: Number(j.expires_in ?? 3600),
    email: emailFromIdToken(j.id_token),
  };
}

/** Mint a fresh access token from a stored refresh token (called per send/poll).
 *  Some providers (Microsoft) rotate the refresh token — the new one is returned
 *  so callers can persist it. */
export async function refreshAccessToken(
  provider: OAuthProvider,
  refreshToken: string
): Promise<OAuthTokens> {
  const def = getProviderDef(provider);
  const creds = getOAuthCreds(provider);
  if (!creds) throw new Error(`${provider} OAuth is not configured`);
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(def.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    throw new Error(`Token refresh failed: ${j.error_description || j.error || res.status}`);
  }
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token || refreshToken, // keep old if not rotated
    expiresInSec: Number(j.expires_in ?? 3600),
  };
}
