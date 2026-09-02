/**
 * Helpers for the calculator PDF / share routes (server-only).
 */

import fs from "fs";
import path from "path";

/** pdf-lib can only embed PNG or JPEG — validate by magic bytes (more reliable
 *  than trusting a Content-Type header) and enforce a sane size cap. */
function validImageBytes(buf: Uint8Array): Uint8Array | null {
  if (buf.length < 8 || buf.length >= 3_000_000) return null;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  return isPng || isJpg ? buf : null;
}

/**
 * Best-effort fetch of the firm logo bytes for the PDF letterhead. Handles the
 * three ways a logo URL shows up in this app, in order:
 *   1. the local-disk upload store (`/api/upload-local/<key>`) — read straight
 *      off disk, no network round-trip (this is how prod serves firm logos);
 *   2. a site-relative path (`/...`) — resolved against the request origin and
 *      fetched over HTTP;
 *   3. an absolute http(s) URL (e.g. a public S3/CDN link) — fetched directly.
 * Any failure just drops the logo (the PDF still renders, sans letterhead mark).
 */
export async function fetchBrandLogoBytes(
  logoUrl?: string | null,
  origin?: string | null
): Promise<Uint8Array | null> {
  if (!logoUrl) return null;

  // 1. Local-disk upload store — mirrors src/app/api/upload-local/[...key]/route.ts
  const localMatch = logoUrl.match(/\/api\/upload-local\/(.+)$/);
  if (localMatch) {
    try {
      const key = decodeURIComponent(localMatch[1].split("?")[0]);
      const ROOT = path.join(process.cwd(), "node-local", "uploads");
      const full = path.resolve(ROOT, key);
      if ((full === ROOT || full.startsWith(ROOT + path.sep)) && fs.existsSync(full)) {
        return validImageBytes(new Uint8Array(await fs.promises.readFile(full)));
      }
    } catch {
      /* fall through to HTTP — e.g. an S3-backed deploy where it's not on disk */
    }
  }

  // 2 + 3. Resolve a site-relative path against the caller's origin, then fetch.
  let url = logoUrl;
  if (url.startsWith("/") && origin) url = origin.replace(/\/+$/, "") + url;
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    return validImageBytes(new Uint8Array(await res.arrayBuffer()));
  } catch {
    return null;
  }
}

/** Normalise an Indian-or-international phone to digits with country code for
 *  a wa.me link (defaults to +91 when a bare 10-digit number is given). */
export function normalizeWaPhone(raw: string): string | null {
  const digits = (raw ?? "").replace(/[^\d]/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}
