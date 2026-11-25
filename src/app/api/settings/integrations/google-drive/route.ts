import { handleApiError } from "@/lib/api/error-handler";
/**
 * The firm's Google Drive connection (owner / admin).
 *
 *   GET    /api/settings/integrations/google-drive   - status (never a secret) + the redirect URI to register
 *   PUT    /api/settings/integrations/google-drive   - save the OAuth client id + secret (encrypted); clears any old sign-in
 *   DELETE /api/settings/integrations/google-drive   - disconnect
 *
 * Signing in to Google (which yields the long-lived refresh token) is the /oauth/start + /oauth/callback pair.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { cleanBaseUrl, disconnectDrive, driveRedirectUri, driveStatusView, getDriveConfig, saveDriveConfig } from "@/lib/integrations/google-drive";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { requestBaseUrl } from "@/lib/url/request-base";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    const cfg = await withTenant(session.tenantId, (tx) => getDriveConfig(tx, session.tenantId));
    return NextResponse.json({ ...driveStatusView(cfg), redirectUri: driveRedirectUri(await requestBaseUrl(), cfg) });
  } catch (err: any) {
    return handleApiError(err);
  }
}

const Body = z.object({
  clientId: z.string().trim().min(10).max(300).refine((v) => v.endsWith(".apps.googleusercontent.com"), "That does not look like a Google client ID (it ends with .apps.googleusercontent.com)"),
  /** Leave empty to keep the saved secret (when only the client ID or the public address changes). */
  clientSecret: z.string().trim().max(300).optional(),
  /** The CRM's public web address, e.g. https://crm.equitywala.com - empty to detect it. */
  redirectBase: z.string().trim().max(200).optional(),
});

export async function PUT(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the client ID and secret" }, { status: 400 });
    }
    const base = parsed.data.redirectBase ? cleanBaseUrl(parsed.data.redirectBase) : null;
    if (parsed.data.redirectBase && !base) {
      return NextResponse.json({ error: "The public address must be a web address like https://crm.equitywala.com" }, { status: 400 });
    }
    const typedSecret = (parsed.data.clientSecret ?? "").trim();
    if (typedSecret && typedSecret.length < 10) {
      return NextResponse.json({ error: "That client secret looks too short." }, { status: 400 });
    }
    const problem = await withTenant(session.tenantId, async (tx) => {
      const old = await getDriveConfig(tx, session.tenantId);
      const secret = typedSecret || old?.clientSecret || "";
      if (!secret) return "Enter the client secret.";
      // A different client ID or secret means any earlier Google sign-in no longer applies; changing only the
      // public address keeps the connection.
      const sameClient = !!old && old.clientId === parsed.data.clientId && old.clientSecret === secret;
      await saveDriveConfig(tx, session.tenantId, {
        clientId: parsed.data.clientId,
        clientSecret: secret,
        ...(base ? { redirectBase: base } : {}),
        ...(sameClient ? { refreshToken: old?.refreshToken, email: old?.email, rootFolderId: old?.rootFolderId } : {}),
      });
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "integration.google_drive.credentials_saved",
        entityType: "integration",
        entityId: session.tenantId,
        ...clientMetaFromHeaders(req.headers),
      });
      return null;
    });
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    await withTenant(session.tenantId, async (tx) => {
      await disconnectDrive(tx, session.tenantId);
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "integration.google_drive.disconnected",
        entityType: "integration",
        entityId: session.tenantId,
        ...clientMetaFromHeaders(req.headers),
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
