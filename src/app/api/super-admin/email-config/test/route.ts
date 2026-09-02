/**
 * SSIT Admin → Email → "Send test email". Sends a real transactional email to
 * the given address using the saved config, so the operator can confirm delivery
 * end-to-end before relying on it for resets/invites. Platform-admin only.
 */
import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { sendSystemEmail } from "@/lib/comms/system-email";
import { invalidateEmailConfigCache } from "@/lib/comms/email-config";

export const dynamic = "force-dynamic";

const Body = z.object({ to: z.string().email() });

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    // Read freshly-saved config (skip the 60s cache).
    invalidateEmailConfigCache();
    const res = await sendSystemEmail({
      tenantId: session.tenantId,
      to: parsed.data.to,
      subject: "SSIT CRM — test email",
      text: "This is a test email from SSIT Admin. If you received it, your email sending is configured correctly.",
      html: "<p>This is a <strong>test email</strong> from SSIT Admin.</p><p>If you received it, your email sending is configured correctly. 🎉</p>",
    });
    if (!res.sent) {
      const msg =
        res.reason === "email_not_configured"
          ? "No API key configured yet — save your key first, then test."
          : "Send failed — check the API key and From address (it must be a verified sender/domain).";
      return NextResponse.json({ ok: false, error: msg, reason: res.reason }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
