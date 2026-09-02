/**
 * OAuth start — kicks off "Connect Gmail / Connect Outlook".
 *
 *   GET /api/settings/integrations/mailbox/oauth/:provider/start?scope=user|tenant
 *
 * Signs a short-lived state (carrying who is connecting + which scope) and
 * redirects to the provider's consent screen. Inert (redirects back with an
 * error) until the firm registers an OAuth app and sets the client id/secret.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import {
  buildAuthUrl,
  buildRedirectUri,
  isOAuthConfigured,
  signState,
  type OAuthProvider,
} from "@/lib/comms/oauth";

export const dynamic = "force-dynamic";

const SETTINGS = "/dashboard/settings/email";

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider: raw } = await ctx.params;
  const provider = raw as OAuthProvider;
  const origin = new URL(req.url).origin;
  const back = (params: string) => NextResponse.redirect(new URL(`${SETTINGS}?${params}`, origin));

  if (provider !== "google" && provider !== "microsoft") {
    return back("oauth_error=unknown_provider");
  }

  const session = await requireSession();
  const scope = new URL(req.url).searchParams.get("scope") === "user" ? "user" : "tenant";

  if (scope === "tenant" && !session.roles?.includes("owner")) {
    return back("oauth_error=only_owner_can_connect_firm_mailbox");
  }
  if (!isOAuthConfigured(provider)) {
    return back(`oauth_error=${provider}_oauth_not_configured`);
  }

  const redirectUri = buildRedirectUri(origin, provider);
  const state = signState({
    tenantId: session.tenantId,
    userId: session.userId,
    provider,
    scope,
    redirectUri,
    iat: Date.now(),
  });

  return NextResponse.redirect(buildAuthUrl(provider, redirectUri, state));
}
