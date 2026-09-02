/**
 * GET /api/integrations/zoho/callback
 *
 * OAuth redirect target. Exchanges the authorization code (using the MFD's own
 * app credentials) for a long-lived refresh token, stores it on the tenant's
 * Zoho connection, then bounces the user back to Settings → Integrations.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { withTenant } from "@/db/client";
import { dcFromLocation } from "@/lib/integrations/zoho/datacenters";
import { exchangeCodeForTokens } from "@/lib/integrations/zoho/client";
import { getZohoAppCreds, saveZohoRefreshToken } from "@/lib/integrations/zoho/credentials";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await requireSession();
  const sp = req.nextUrl.searchParams;

  // Build the public origin from the forwarded host (behind Caddy `req.url` is
  // the container's internal http://localhost — never redirect users there).
  // localhost dev has no TLS, so use http for it; everything else is https.
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const proto = req.headers.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)/i.test(host) ? "http" : "https");
  const origin = host ? `${proto}://${host}` : req.nextUrl.origin;
  const settingsUrl = new URL("/dashboard/settings/integrations", origin);

  const code = sp.get("code");
  if (sp.get("error") || !code) {
    settingsUrl.searchParams.set("zoho", "error");
    return NextResponse.redirect(settingsUrl);
  }

  const creds = await withTenant(session.tenantId, async (tx) => getZohoAppCreds(tx, session.tenantId));
  if (!creds) {
    settingsUrl.searchParams.set("zoho", "nocreds");
    return NextResponse.redirect(settingsUrl);
  }

  // Zoho returns the user's DC in `location`; fall back to the saved DC.
  const dc = sp.get("location") ? dcFromLocation(sp.get("location")) : creds.dataCenter;
  const redirectUri = `${origin}/api/integrations/zoho/callback`;

  const result = await exchangeCodeForTokens(dc, code, redirectUri, creds.clientId, creds.clientSecret);
  if ("error" in result) {
    console.error("[zoho] token exchange failed:", result.error);
    settingsUrl.searchParams.set("zoho", "error");
    return NextResponse.redirect(settingsUrl);
  }

  await withTenant(session.tenantId, async (tx) => {
    await saveZohoRefreshToken(tx, session.tenantId, {
      refreshToken: result.refreshToken,
      dataCenter: dc,
      grantedBy: session.email ?? session.userId,
    });
  });

  settingsUrl.searchParams.set("zoho", "connected");
  return NextResponse.redirect(settingsUrl);
}
