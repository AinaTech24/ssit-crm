/**
 * Google Drive - the firm's video archive.
 *
 * The firm connects ONE Google account (an owner-managed, firm-wide connection stored encrypted in
 * tenant_integrations, provider "google_drive"). Videos uploaded in the CRM are then copied into
 * that Drive, in month folders:
 *
 *     Equitywala Content / 2026 / 11 - November / <file>
 *
 * Scope is `drive.file`: the CRM can only see and touch files and folders it created itself,
 * never the rest of the Drive. The refresh token is the only long-lived secret; short-lived
 * access tokens are minted from it on demand.
 *
 * Registered redirect URI (add this EXACT value to the OAuth client in Google Cloud):
 *   {origin}/api/settings/integrations/google-drive/oauth/callback
 */

import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { tenantIntegrations } from "@/db/schema/tenant_integrations";
import { decrypt, encrypt } from "@/lib/crypto";
import { objectSize, readObjectRange } from "@/lib/storage/s3";
import { MAX_DRIVE_UPLOAD_BYTES } from "@/lib/integrations/drive-limits";

export const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file", "openid", "email"];
export const DRIVE_ROOT_FOLDER = "Equitywala Content";
export { MAX_DRIVE_UPLOAD_BYTES };
/** Drive's resumable upload wants chunks in multiples of 256 KiB; 8 MiB keeps memory small and calls few. */
const CHUNK = 8 * 1024 * 1024;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export interface DriveConfig {
  clientId: string;
  clientSecret: string;
  /** Present once the owner has signed in to Google and approved. */
  refreshToken?: string;
  email?: string;
  /** The "Equitywala Content" folder, created on first use. */
  rootFolderId?: string;
  /**
   * The CRM's public web address (e.g. https://crm.equitywala.com), typed on the settings page. The redirect
   * address Google is given is built from it, so it matches what is registered in Google Cloud even when the
   * server only knows its own internal name (localhost:3000) behind the load balancer.
   */
  redirectBase?: string;
}

const isLocalHost = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(u);

/** "https://crm.equitywala.com/anything/" -> "https://crm.equitywala.com"; null when it is not a web address. */
export function cleanBaseUrl(raw: string | null | undefined): string | null {
  try {
    const u = new URL(String(raw ?? "").trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * The address Google redirects back to. Order: what the owner typed on the settings page, then the server's
 * configured public address, then the address the request arrived on - but a request that arrived as
 * "localhost" is only used when nothing better is known.
 */
export const driveRedirectUri = (origin: string, cfg?: Pick<DriveConfig, "redirectBase"> | null) => {
  const envBase = [process.env.OAUTH_REDIRECT_BASE, process.env.APP_URL, process.env.NEXTAUTH_URL, process.env.NEXT_PUBLIC_APP_URL]
    .map((v) => cleanBaseUrl(v))
    .find((v) => !!v && !isLocalHost(v));
  const typed = cleanBaseUrl(cfg?.redirectBase);
  const fromRequest = cleanBaseUrl(origin);
  const base = typed ?? (fromRequest && !isLocalHost(fromRequest) ? fromRequest : envBase ?? fromRequest ?? origin.replace(/\/$/, ""));
  return `${base}/api/settings/integrations/google-drive/oauth/callback`;
};

// ── stored connection (firm-wide) ───────────────────────────────────────────

const tenantRow = (tenantId: string) =>
  and(eq(tenantIntegrations.tenantId, tenantId), isNull(tenantIntegrations.userId), eq(tenantIntegrations.provider, "google_drive"));

export async function getDriveConfig(tx: Tx, tenantId: string): Promise<DriveConfig | null> {
  const [row] = await tx.select().from(tenantIntegrations).where(and(tenantRow(tenantId), eq(tenantIntegrations.isActive, true))).limit(1);
  if (!row) return null;
  try {
    return JSON.parse(decrypt(row.encryptedConfig)) as DriveConfig;
  } catch {
    return null;
  }
}

export async function saveDriveConfig(tx: Tx, tenantId: string, config: DriveConfig): Promise<void> {
  const encryptedConfig = encrypt(JSON.stringify(config));
  const [existing] = await tx.select({ id: tenantIntegrations.id }).from(tenantIntegrations).where(tenantRow(tenantId)).limit(1);
  if (existing) {
    await tx.update(tenantIntegrations).set({ encryptedConfig, isActive: true, updatedAt: new Date() }).where(eq(tenantIntegrations.id, existing.id));
    return;
  }
  await tx.insert(tenantIntegrations).values({ tenantId, userId: null, provider: "google_drive", encryptedConfig, isActive: true });
}

export async function disconnectDrive(tx: Tx, tenantId: string): Promise<void> {
  await tx.update(tenantIntegrations).set({ isActive: false, updatedAt: new Date() }).where(tenantRow(tenantId));
}

/** What the settings screen may show - never a secret. */
export function driveStatusView(cfg: DriveConfig | null) {
  return {
    hasCredentials: !!cfg?.clientId && !!cfg?.clientSecret,
    /** The client ID is not a secret (Google shows it in the sign-in address), so it is shown in full. */
    clientId: cfg?.clientId ?? null,
    hasSecret: !!cfg?.clientSecret,
    redirectBase: cfg?.redirectBase ?? null,
    connected: !!cfg?.refreshToken,
    email: cfg?.email ?? null,
  };
}

// ── OAuth ───────────────────────────────────────────────────────────────────

export function driveAuthUrl(cfg: DriveConfig, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPES.join(" "),
    state,
    access_type: "offline", // ask for a refresh token
    prompt: "consent", // and get one even when the account approved before
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function emailFromIdToken(idToken?: string): string | undefined {
  const parts = (idToken ?? "").split(".");
  if (parts.length < 2) return undefined;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")).email || undefined;
  } catch {
    return undefined;
  }
}

export async function exchangeDriveCode(
  cfg: DriveConfig,
  code: string,
  redirectUri: string
): Promise<{ refreshToken: string; email?: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`Google did not accept the sign-in: ${j.error_description || j.error || res.status}`);
  if (!j.refresh_token) {
    throw new Error("Google did not return a long-lived connection. Remove the CRM under your Google Account → Security → Third-party access, then connect again.");
  }
  return { refreshToken: j.refresh_token, email: emailFromIdToken(j.id_token) };
}

async function accessToken(cfg: DriveConfig): Promise<string> {
  if (!cfg.refreshToken) throw new Error("Google Drive is not connected.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    if (j.error === "invalid_grant") throw new Error("Google has disconnected the CRM (the approval expired or was removed). Connect Google Drive again in Settings.");
    throw new Error(`Could not sign in to Google Drive: ${j.error_description || j.error || res.status}`);
  }
  return j.access_token as string;
}

// ── folders ─────────────────────────────────────────────────────────────────

const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function driveJson(token: string, url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init?.headers ?? {}) } });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google Drive: ${j?.error?.message || res.status}`);
  return j;
}

/** The folder named `name` under `parentId` (or at the top), created if it is not there. */
async function ensureFolder(token: string, name: string, parentId?: string): Promise<string> {
  const parent = parentId ? `'${q(parentId)}' in parents` : `'root' in parents`;
  const found = await driveJson(
    token,
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      `name='${q(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false and ${parent}`
    )}&fields=files(id)&pageSize=1`
  );
  if (found.files?.[0]?.id) return found.files[0].id as string;
  const made = await driveJson(token, "https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", ...(parentId ? { parents: [parentId] } : {}) }),
  });
  return made.id as string;
}

/** "2026-11-03" → ["Equitywala Content", "2026", "11 - November"] */
export function monthFolderPath(isoDate: string): string[] {
  const [y, m] = isoDate.split("-").map(Number);
  return [DRIVE_ROOT_FOLDER, String(y), `${String(m).padStart(2, "0")} - ${MONTHS[(m || 1) - 1]}`];
}

// ── the upload ──────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Move one stored file into Drive: make sure the month folder exists, then send the file in
 * 8 MiB pieces over Google's resumable upload (each piece retried). Resolves with the Drive file
 * id and link only after Drive reports the final size equal to the stored size.
 */
export async function copyStoredFileToDrive(
  cfg: DriveConfig,
  input: { storageKey: string; fileName: string; contentType: string; folderDate: string }
): Promise<{ fileId: string; url: string; folder: string; newRootFolderId?: string }> {
  const size = await objectSize(input.storageKey);
  if (size == null) throw new Error("The uploaded file is no longer in storage - upload it again.");
  if (size > MAX_DRIVE_UPLOAD_BYTES) throw new Error("This file is larger than the limit - upload it to Drive yourself and paste the link.");
  if (size === 0) throw new Error("The uploaded file is empty.");

  const token = await accessToken(cfg);
  const path = monthFolderPath(input.folderDate);
  let parentId: string | undefined;
  let rootId: string | undefined;
  for (let i = 0; i < path.length; i++) {
    parentId = await ensureFolder(token, path[i], parentId);
    if (i === 0) rootId = parentId;
  }

  // Start the resumable session.
  const init = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink,size",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": input.contentType || "application/octet-stream",
        "x-upload-content-length": String(size),
      },
      body: JSON.stringify({ name: input.fileName, parents: parentId ? [parentId] : undefined }),
    }
  );
  const session = init.headers.get("location");
  if (!init.ok || !session) {
    const j: any = await init.json().catch(() => ({}));
    throw new Error(`Google Drive would not start the upload: ${j?.error?.message || init.status}`);
  }

  let sent = 0;
  let last: any = null;
  while (sent < size) {
    const end = Math.min(sent + CHUNK, size) - 1;
    const body = await readObjectRange(input.storageKey, sent, end);
    if (body.length !== end - sent + 1) throw new Error("Could not read the whole file from storage.");
    let ok = false;
    for (let attempt = 0; attempt < 4 && !ok; attempt++) {
      try {
        const res = await fetch(session, {
          method: "PUT",
          headers: { "content-range": `bytes ${sent}-${end}/${size}` },
          body: new Uint8Array(body),
          // Drive answers an accepted piece with 308 "Resume Incomplete" - that is progress, not a redirect.
          redirect: "manual",
        });
        if (res.status === 308) {
          ok = true; // piece accepted, more to come
        } else if (res.ok) {
          last = await res.json().catch(() => ({}));
          ok = true;
        } else if (res.status >= 500 || res.status === 429) {
          await sleep(1500 * (attempt + 1));
        } else {
          const j: any = await res.json().catch(() => ({}));
          throw new Error(`Google Drive refused the upload: ${j?.error?.message || res.status}`);
        }
      } catch (e: any) {
        if (String(e?.message ?? "").startsWith("Google Drive refused")) throw e;
        await sleep(1500 * (attempt + 1)); // network blip - try the same piece again
      }
    }
    if (!ok) throw new Error("The connection to Google Drive kept failing - try again in a few minutes.");
    sent = end + 1;
  }

  if (!last?.id) throw new Error("Google Drive did not confirm the file.");
  if (last.size != null && Number(last.size) !== size) throw new Error("Google Drive received a different size than was sent - try again.");
  return {
    fileId: String(last.id),
    url: String(last.webViewLink ?? `https://drive.google.com/file/d/${last.id}/view`),
    folder: path.join(" / "),
    newRootFolderId: rootId && rootId !== cfg.rootFolderId ? rootId : undefined,
  };
}
