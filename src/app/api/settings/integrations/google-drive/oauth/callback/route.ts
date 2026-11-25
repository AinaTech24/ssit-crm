/**
 * GET /api/settings/integrations/google-drive/oauth/callback?code&state
 *
 * Google sends the owner back here after approving. The code is exchanged for the long-lived
 * refresh token, which is stored encrypted with the client id / secret. Register this exact
 * address as the OAuth client's redirect URI in Google Cloud.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { verifyState } from "@/lib/comms/oauth";
import { exchangeDriveCode, getDriveConfig, saveDriveConfig } from "@/lib/integrations/google-drive";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const SETTINGS = "/dashboard/settings/google-drive";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const back = (params: string) => NextResponse.redirect(new URL(`${SETTINGS}?${params}`, url.origin));

  const providerError = url.searchParams.get("error");
  if (providerError) return back(`drive_error=${encodeURIComponent(providerError)}`);

  const code = url.searchParams.get("code");
  const state = verifyState(url.searchParams.get("state") ?? "");
  if (!code || !state) return back("drive_error=The sign-in link expired. Try Connect again.");

  const session = await requireSession();
  if (session.userId !== state.userId || session.tenantId !== state.tenantId) return back("drive_error=That sign-in belongs to a different person. Try again.");
  if (!can(session.roles, "settings.users", session.permissions)) return back("drive_error=Only an owner or admin can connect Google Drive.");

  try {
    await withTenant(session.tenantId, async (tx) => {
      const cfg = await getDriveConfig(tx, session.tenantId);
      if (!cfg?.clientId || !cfg.clientSecret) throw new Error("Save the Google client ID and secret first.");
      const tokens = await exchangeDriveCode(cfg, code, state.redirectUri);
      await saveDriveConfig(tx, session.tenantId, { ...cfg, refreshToken: tokens.refreshToken, email: tokens.email });
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "integration.google_drive.connected",
        entityType: "integration",
        entityId: session.tenantId,
        after: { email: tokens.email ?? null } as any,
        ...clientMetaFromHeaders(req.headers),
      });
    });
  } catch (e) {
    return back(`drive_error=${encodeURIComponent((e as Error).message).slice(0, 300)}`);
  }
  return back("drive_connected=1");
}
