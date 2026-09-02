/**
 * SSIT Admin → RTA Mailbox. Read the current catch-all inbox config (never the
 * raw password — only a "saved" flag) and update it. Platform-admin only.
 *
 * This is the ONE mailbox every MFD forwards their CAMS/KFintech mailback to. The
 * IMAP password is encrypted (AES-256-GCM) before it touches the DB. Submitting a
 * blank password keeps the previously-saved one.
 */
import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { getRtaInboxStatusForAdmin, revealRtaInboxPassword, saveRtaInboxConfig } from "@/lib/rta/inbox-config";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    // ?reveal=1 → return the decrypted mailbox password so the operator can read
    // back / correct their own catch-all credential. Platform-admin only (gated
    // above); force-dynamic keeps it out of any cache.
    if (req.nextUrl.searchParams.get("reveal") === "1") {
      const password = await revealRtaInboxPassword();
      return NextResponse.json({ password: password ?? "" });
    }
    const status = await getRtaInboxStatusForAdmin();
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
  domain: z.string().trim().max(200).optional(),
  /** Mailbox cleanup: delete forwarded mail once it has been imported. */
  deleteAfterImport: z.boolean().optional(),
  retentionDays: z.number().int().min(0).max(365).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });
    }
    await saveRtaInboxConfig(parsed.data, session.userId);
    const status = await getRtaInboxStatusForAdmin();
    return NextResponse.json({ ok: true, status });
  } catch (err) {
    return handleApiError(err);
  }
}
