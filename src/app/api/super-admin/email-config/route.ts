/**
 * Equitywala Admin → Email. Read the current email-sending config (never the raw key —
 * only a masked last-4) and update it. Platform-admin only.
 *
 * The API key is encrypted (AES-256-GCM) before it touches the DB. Submitting a
 * blank key keeps the previously-saved one (lets you change the From address
 * without re-pasting the key).
 */
import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { getEmailStatusForAdmin, saveEmailConfig } from "@/lib/comms/email-config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    const status = await getEmailStatusForAdmin();
    return NextResponse.json({ status });
  } catch (err) {
    return handleApiError(err);
  }
}

const Body = z.object({
  host: z.string().trim().max(200).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  user: z.string().trim().max(200).optional(),
  pass: z.string().max(400).optional(), // blank → keep existing
  from: z.string().trim().max(200).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });
    }
    await saveEmailConfig(parsed.data, session.userId);
    const status = await getEmailStatusForAdmin();
    return NextResponse.json({ ok: true, status });
  } catch (err) {
    return handleApiError(err);
  }
}
