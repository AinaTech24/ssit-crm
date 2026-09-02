/**
 * GET /api/integrations/zoho/connect
 *
 * Starts the Zoho OAuth consent flow for the signed-in MFD using THEIR OWN Zoho
 * app credentials (entered earlier in Settings → Integrations). Redirects the
 * browser to Zoho's authorize screen; Zoho redirects back to /callback with an
 * authorization code (and the user's data-center `location`).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { withTenant } from "@/db/client";
import { accountsServer } from "@/lib/integrations/zoho/datacenters";
import { getZohoAppCreds } from "@/lib/integrations/zoho/credentials";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await requireSession();
  const settingsUrl = new URL("/dashboard/settings/integrations", req.url);

  const creds = await withTenant(session.tenantId, async (tx) => getZohoAppCreds(tx, session.tenantId));
  if (!creds) {
    // No Client ID/Secret saved yet — send them back to enter them.
    settingsUrl.searchParams.set("zoho", "nocreds");
    return NextResponse.redirect(settingsUrl);
  }

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const proto = req.headers.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)/i.test(host) ? "http" : "https");
  const redirectUri = host ? `${proto}://${host}/api/integrations/zoho/callback` : `${req.nextUrl.origin}/api/integrations/zoho/callback`;

  const url = new URL(`${accountsServer(creds.dataCenter)}/oauth/v2/auth`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", creds.clientId);
  url.searchParams.set("scope", "ZohoCRM.modules.ALL,ZohoCRM.settings.ALL,ZohoCRM.org.READ");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("access_type", "offline"); // we need a refresh token
  url.searchParams.set("prompt", "consent");

  return NextResponse.redirect(url.toString());
}
