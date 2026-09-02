/**
 * OAuth callback — exchanges the authorization code for tokens and stores the
 * mailbox. ONLY the long-lived refresh token is persisted (encrypted, inside the
 * mailbox row's config blob); access tokens are minted on demand for IMAP/SMTP.
 *
 *   GET /api/settings/integrations/mailbox/oauth/:provider/callback?code&state
 *
 * The redirect URI registered with the provider must point here exactly.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { upsertTenantIntegration } from "@/lib/comms/integrations";
import {
  exchangeCodeForTokens,
  getProviderDef,
  verifyState,
  type OAuthProvider,
} from "@/lib/comms/oauth";

export const dynamic = "force-dynamic";

const SETTINGS = "/dashboard/settings/email";

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider: raw } = await ctx.params;
  const provider = raw as OAuthProvider;
  const url = new URL(req.url);
  const origin = url.origin;
  const back = (params: string) => NextResponse.redirect(new URL(`${SETTINGS}?${params}`, origin));

  if (provider !== "google" && provider !== "microsoft") return back("oauth_error=unknown_provider");

  const providerError = url.searchParams.get("error");
  if (providerError) return back(`oauth_error=${encodeURIComponent(providerError)}`);

  const code = url.searchParams.get("code");
  const stateToken = url.searchParams.get("state") ?? "";
  const state = verifyState(stateToken);
  if (!code || !state || state.provider !== provider) return back("oauth_error=invalid_state");

  // The browser returning from the provider still carries the app session — bind
  // the connection to the same user that started it.
  const session = await requireSession();
  if (session.userId !== state.userId || session.tenantId !== state.tenantId) {
    return back("oauth_error=session_mismatch");
  }
  if (state.scope === "tenant" && !session.roles?.includes("owner")) {
    return back("oauth_error=only_owner_can_connect_firm_mailbox");
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(provider, code, state.redirectUri);
  } catch (e) {
    return back(`oauth_error=${encodeURIComponent((e as Error).message).slice(0, 200)}`);
  }
  if (!tokens.refreshToken) {
    // No refresh token → we couldn't get offline access (often a re-consent that
    // didn't force prompt). Ask the user to retry; nothing usable was stored.
    return back("oauth_error=no_refresh_token_try_again");
  }

  const def = getProviderDef(provider);
  const email = tokens.email ?? "";
  const config = {
    oauth: { provider, refreshToken: tokens.refreshToken, email },
    imap: { host: def.imap.host, port: def.imap.port, secure: def.imap.secure, user: email },
    smtp: { host: def.smtp.host, port: def.smtp.port, secure: def.smtp.secure, user: email },
  };
  const userId = state.scope === "user" ? state.userId : null;

  await withTenant(session.tenantId, async (tx) => {
    await upsertTenantIntegration(
      tx,
      session.tenantId,
      "mailbox",
      config,
      { fromEmail: email || undefined, replyTo: email || undefined },
      { userId }
    );
  });

  return back(`connected=${provider}`);
}
