import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/ai/models — the models the in-chat selector can offer. The CRM runs
 * ONE provider at a time (set in SSIT Admin); we expose its two tiers (fast +
 * reasoning) with human labels. Never returns the API key.
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { loadAiConfig, AI_PROVIDERS } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireSession();
    const cfg = await loadAiConfig();
    const providerLabel = AI_PROVIDERS.find((p) => p.value === cfg.provider)?.label ?? cfg.provider;
    return NextResponse.json({
      provider: cfg.provider,
      providerLabel,
      configured: !!cfg.apiKey,
      models: [
        { tier: "reasoning", name: cfg.reasoningModel, label: `${cfg.reasoningModel} · Reasoning` },
        { tier: "fast", name: cfg.fastModel, label: `${cfg.fastModel} · Fast` },
      ],
    });
  } catch (err) {
    return handleApiError(err);
  }
}
