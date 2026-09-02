/**
 * SSIT Admin → AI & Models. Read the current AI provider/model config (never
 * the raw key — only a masked last-4) and update it. Platform-admin only.
 *
 * The API key is encrypted (AES-256-GCM) before it touches the DB. Submitting a
 * blank key keeps the previously-saved one (lets you change the model without
 * re-pasting the key).
 */

import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { getAiStatusForAdmin, saveAiConfig, AI_PROVIDERS } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    const status = await getAiStatusForAdmin();
    return NextResponse.json({ status, providers: AI_PROVIDERS });
  } catch (err) {
    return handleApiError(err);
  }
}

const Body = z.object({
  provider: z.enum(["anthropic", "google", "openai"]),
  apiKey: z.string().max(400).optional(), // blank → keep existing
  fastModel: z.string().trim().max(120).optional(),
  reasoningModel: z.string().trim().max(120).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });
    }
    const { provider, apiKey, fastModel, reasoningModel } = parsed.data;

    // Provenance is captured on the row itself (updated_by + updated_at). The
    // raw key is never logged — only the encrypted blob is persisted.
    await saveAiConfig({ provider, apiKey, fastModel, reasoningModel }, session.userId);

    const status = await getAiStatusForAdmin();
    return NextResponse.json({ ok: true, status });
  } catch (err) {
    return handleApiError(err);
  }
}
