/**
 * Email click tracking.
 *
 * Campaign emails get their links rewritten to a signed redirect through
 * `/lc/<token>`. The token carries the originating communication id + the real
 * destination URL, HMAC-signed so it can't be forged into an open redirect.
 * When the link is hit, we stamp `communications.clicked_at` (first click only)
 * + bump the campaign's `clicked_count`, then 302 to the real URL.
 *
 * Tracking is best-effort and must NEVER break a send: wrapLinksForTracking is
 * wrapped in a try/catch by its caller and falls back to the original HTML.
 */

import crypto from "crypto";

function secret(): string {
  return (
    process.env.CLICK_TRACK_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "mfd-click-fallback-secret"
  );
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export interface ClickPayload {
  /** communications.id */
  c: string;
  /** destination URL */
  u: string;
}

export function signClickToken(payload: ClickPayload): string {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyClickToken(token: string): ClickPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
  // Constant-time compare.
  if (sig.length !== expected.length) return null;
  let r = 0;
  for (let i = 0; i < sig.length; i++) r |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (r !== 0) return null;
  try {
    const parsed = JSON.parse(b64urlDecode(body).toString("utf8")) as ClickPayload;
    if (!parsed?.c || !parsed?.u || !/^https?:\/\//i.test(parsed.u)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
}

/**
 * Rewrite http(s) anchor hrefs in an email's HTML to go through `/lc/<token>`.
 * Skips links we must not break or shouldn't track: unsubscribe, mailto/tel
 * (not http), and any link already pointing at our own redirect. No-ops (returns
 * the input) if the app base URL isn't configured.
 */
export function wrapLinksForTracking(html: string, communicationId: string): string {
  const base = appBase();
  if (!base || !html) return html;
  return html.replace(/href\s*=\s*"(https?:\/\/[^"]+)"/gi, (full, url: string) => {
    if (/\/lc\//.test(url) || /unsubscribe/i.test(url)) return full; // don't double-wrap / don't track opt-out
    const token = signClickToken({ c: communicationId, u: url });
    return `href="${base}/lc/${token}"`;
  });
}
