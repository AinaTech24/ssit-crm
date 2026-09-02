/**
 * Live "Test connection" for the AI provider — pings the model with the entered
 * (or saved) key before the operator commits. Returns 200 with { ok, error? }
 * so the form shows the provider's message inline. Platform-admin only.
 */

import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { testAiConnection } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";

const Body = z.object({
  provider: z.enum(["anthropic", "google", "openai"]),
  apiKey: z.string().max(400).optional(),
  model: z.string().trim().max(120).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "invalid input" }, { status: 400 });
    }
    const result = await testAiConnection(parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
