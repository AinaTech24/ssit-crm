import { or, isNull, eq } from "drizzle-orm";
import { contentLibraryAssets } from "@/db/schema";
import { bucket, getObjectBytes, getLocalUploadBytes } from "@/lib/storage/s3";

const LOCAL_UPLOAD_PREFIX = "/api/upload-local/";

/**
 * A content-library asset is visible to a tenant iff it's platform-global
 * (tenant_id IS NULL) OR belongs to that tenant. The table has no usable
 * single-tenant RLS policy (it's dual-purpose), so callers MUST apply this
 * predicate explicitly — especially the ones reading via withSystem (which
 * bypasses RLS entirely).
 */
export function assetVisibleTo(tenantId: string) {
  return or(isNull(contentLibraryAssets.tenantId), eq(contentLibraryAssets.tenantId, tenantId));
}

/** Reject URLs pointing at internal/loopback/link-local hosts (SSRF guard). */
export function isUnsafeAssetUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "invalid URL";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return `unsupported protocol "${u.protocol}"`;
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "::1" || host === "::") {
    return "host is loopback/unspecified";
  }
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      return "host is a private/loopback/link-local IP";
    }
  }
  if (/^f[cd][0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) {
    return "host is a private/link-local IPv6 address";
  }
  return null;
}

const FETCH_TIMEOUT_MS = 10_000;
const MAX_ASSET_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * If `fileUrl` points at our OWN storage (the configured private S3 bucket, or
 * the local-disk dev fallback), return the object key — otherwise null.
 *
 * Our uploads bucket is private (objects are SSE-encrypted, no public-read ACL),
 * so a plain HTTP GET of the "public" S3 URL 403s. Reads must go through the
 * authenticated SDK. This recognises the URL shapes we emit on upload:
 *   - virtual-hosted:  https://<bucket>.s3[.<region>].amazonaws.com/<key>
 *   - path-style:      https://s3[.<region>].amazonaws.com/<bucket>/<key>
 *
 * NOTE: local-disk uploads (/api/upload-local/<key>) are handled separately in
 * fetchAssetBytes — they must be read from disk, never via the S3 SDK.
 */
export function ownStorageKey(fileUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(fileUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const b = bucket();
  const host = u.hostname.toLowerCase();
  const key = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
  if (!key) return null;
  // virtual-hosted-style: <bucket>.s3.amazonaws.com or <bucket>.s3.<region>.amazonaws.com
  const vhost = host.match(/^([^.]+)\.s3(?:\.[a-z0-9-]+)?\.amazonaws\.com$/);
  if (vhost) return vhost[1] === b ? key : null;
  // path-style: s3.amazonaws.com/<bucket>/... or s3.<region>.amazonaws.com/<bucket>/...
  if (/^s3(?:\.[a-z0-9-]+)?\.amazonaws\.com$/.test(host)) {
    return key.startsWith(`${b}/`) ? key.slice(b.length + 1) || null : null;
  }
  return null;
}

/**
 * Fetch a content-library asset's bytes safely:
 *   - SSRF guard (no internal hosts — asset fileUrls are tenant-controllable)
 *   - 10s timeout (no hung connections)
 *   - 25 MB cap (pre-check Content-Length + post-check actual size → no OOM)
 *   - no redirect following (a 3xx to an internal host would bypass the guard)
 */
export async function fetchAssetBytes(fileUrl: string): Promise<{ ok: true; buf: Buffer } | { ok: false; status: number; error: string }> {
  // `/api/upload-local/<key>` is a UNIFIED asset URL — the object may live on
  // the local uploads volume (legacy / no-S3 era) OR in the S3 bucket (current
  // uploads, once keys were configured). Try local disk first, then fall back to
  // S3, exactly like the /api/upload-local GET route — so logos/avatars load
  // wherever the bytes actually landed.
  if (fileUrl.startsWith(LOCAL_UPLOAD_PREFIX)) {
    const lkey = decodeURIComponent(fileUrl.slice(LOCAL_UPLOAD_PREFIX.length));
    try {
      const buf = await getLocalUploadBytes(lkey);
      if (buf.byteLength > MAX_ASSET_BYTES) return { ok: false, status: 413, error: "asset too large" };
      return { ok: true, buf };
    } catch {
      // Not on the local volume — read it from S3.
      try {
        const buf = await getObjectBytes(lkey);
        if (buf.byteLength > MAX_ASSET_BYTES) return { ok: false, status: 413, error: "asset too large" };
        return { ok: true, buf };
      } catch (e: any) {
        return { ok: false, status: 502, error: `upload read failed: ${e?.message ?? String(e)}` };
      }
    }
  }

  // Our own S3 uploads live in a PRIVATE bucket — read them with the
  // authenticated SDK, not a public fetch (which 403s). Only genuinely-external
  // URLs fall through to the SSRF-guarded public fetch below.
  const key = ownStorageKey(fileUrl);
  if (key) {
    try {
      const buf = await getObjectBytes(key);
      if (buf.byteLength > MAX_ASSET_BYTES) return { ok: false, status: 413, error: "asset too large" };
      return { ok: true, buf };
    } catch (e: any) {
      return { ok: false, status: 502, error: `storage read failed: ${e?.message ?? String(e)}` };
    }
  }

  const unsafe = isUnsafeAssetUrl(fileUrl);
  if (unsafe) return { ok: false, status: 400, error: `Blocked asset URL (${unsafe})` };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(fileUrl, { signal: controller.signal, redirect: "manual" });
    if (!res.ok) return { ok: false, status: 502, error: `source fetch failed (${res.status})` };
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > MAX_ASSET_BYTES) return { ok: false, status: 413, error: "asset too large" };
    const ab = await res.arrayBuffer();
    if (ab.byteLength > MAX_ASSET_BYTES) return { ok: false, status: 413, error: "asset too large" };
    return { ok: true, buf: Buffer.from(ab) };
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? "source fetch timed out" : e?.message ?? String(e);
    return { ok: false, status: 502, error: msg };
  } finally {
    clearTimeout(timer);
  }
}
