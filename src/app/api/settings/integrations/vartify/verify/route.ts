/**
 * GET /api/settings/integrations/vartify/verify
 *
 * Live connection check against the firm's connected Vartify workspace. Calls
 * GET /me — Vartify's documented connection test — and returns the account it
 * resolves to, so the firm can confirm exactly which Vartify workspace their
 * saved token belongs to (i.e. where their WhatsApp templates must be approved).
 * Never returns the token itself.
 */

import { NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { getTenantIntegration } from "@/lib/comms/integrations";
import { whatsappProviderId } from "@/lib/comms/adapters/whatsapp";
import { vartifyCheckConnection } from "@/lib/comms/adapters/vartify";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    const integ = await withTenant(session.tenantId, async (tx) =>
      getTenantIntegration(tx, session.tenantId, whatsappProviderId)
    );
    const apiKey = (integ?.config as any)?.apiKey as string | undefined;
    const baseUrl = (integ?.config as any)?.webhookUrl as string | undefined;
    if (!integ?.isActive || !apiKey) {
      return NextResponse.json({ ok: false, connected: false, error: "WhatsApp isn't connected." });
    }
    // GET /me is Vartify's documented connection test — it returns the account
    // the token belongs to. Vartify exposes no sender-number list, so `numbers`
    // is intentionally absent rather than faked.
    const result = await vartifyCheckConnection(apiKey, baseUrl);
    return NextResponse.json({
      connected: true,
      ok: result.ok,
      workspaceName: result.account?.workspaceName ?? null,
      accountEmail: result.account?.email ?? null,
      plan: result.account?.plan ?? null,
      error: result.error ?? null,
      httpStatus: result.httpStatus ?? null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
