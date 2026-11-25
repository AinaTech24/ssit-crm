/**
 * GET /api/settings/integrations/google-drive/oauth/start
 *
 * "Connect Google Drive": signs a short-lived state (who is connecting) and sends the owner to
 * Google's consent screen, using the client id / secret saved on the settings page.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { signState } from "@/lib/comms/oauth";
import { driveAuthUrl, driveRedirectUri, getDriveConfig } from "@/lib/integrations/google-drive";
import { requestBaseUrl } from "@/lib/url/request-base";

export const dynamic = "force-dynamic";

const SETTINGS = "/dashboard/settings/google-drive";

export async function GET(req: NextRequest) {
  // The address people use in the browser (behind the load balancer the request's own origin can be internal).
  const origin = await requestBaseUrl();
  const back = (params: string) => NextResponse.redirect(new URL(`${SETTINGS}?${params}`, origin));

  const session = await requireSession();
  if (!can(session.roles, "settings.users", session.permissions)) return back("drive_error=Only an owner or admin can connect Google Drive.");

  const cfg = await withTenant(session.tenantId, (tx) => getDriveConfig(tx, session.tenantId));
  if (!cfg?.clientId || !cfg.clientSecret) return back("drive_error=Save the Google client ID and secret first.");

  const redirectUri = driveRedirectUri(origin, cfg);
  const state = signState({
    tenantId: session.tenantId,
    userId: session.userId,
    provider: "google",
    scope: "tenant",
    redirectUri,
    iat: Date.now(),
  });
  return NextResponse.redirect(driveAuthUrl(cfg, redirectUri, state));
}
