/**
 * GET /api/super-admin/ai-config/reveal — return the FULL decrypted AI API key.
 * Platform-admin only (same gate as saving it). Used by the "Show key" toggle in
 * SSIT Admin → AI & Models so the operator can verify / copy the saved key.
 * Never logged; force-dynamic + no-store so it isn't cached.
 */

import { handleApiError } from "@/lib/api/error-handler";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { loadAiConfig } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    const cfg = await loadAiConfig(true);
    return new NextResponse(JSON.stringify({ apiKey: cfg.apiKey ?? null, provider: cfg.provider, source: cfg.source }), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
