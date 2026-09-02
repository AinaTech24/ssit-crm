/**
 * requestBaseUrl — the absolute origin of the CURRENT request (proto + host),
 * so links generated in emails (invites, verification, password reset) land on
 * the same host the user is actually on — including a firm's vanity subdomain
 * or custom domain. Falls back to APP_URL outside a request context (workers,
 * cron). NODE runtime only (uses next/headers).
 */

import { headers } from "next/headers";

export async function requestBaseUrl(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "https";
    if (host) return `${proto}://${host.split(",")[0]!.trim()}`;
  } catch {
    /* no request context (worker/cron) — fall through */
  }
  return process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";
}
