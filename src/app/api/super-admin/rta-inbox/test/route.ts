/**
 * Equitywala Admin → RTA Mailbox → "Test connection". Connects to the saved catch-all
 * mailbox over IMAP and confirms the INBOX is readable, so the operator can
 * verify credentials before relying on the auto-import. Platform-admin only.
 */
import { handleApiError } from "@/lib/api/error-handler";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { verifyImap } from "@/lib/comms/imap";
import { testSesInbox } from "@/lib/rta/ses-inbox";
import { loadRtaInboxConfig, invalidateRtaInboxConfigCache } from "@/lib/rta/inbox-config";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");

    // Use the freshly-saved config (skip the 60s cache).
    invalidateRtaInboxConfigCache();
    const cfg = await loadRtaInboxConfig(true);
    if (!cfg.configured) {
      return NextResponse.json(
        { ok: false, error: "Save the settings first — for Amazon SES that means the region and bucket name." },
        { status: 400 }
      );
    }
    if (cfg.mode === "ses") {
      const r = await testSesInbox(cfg.ses);
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
      return NextResponse.json({ ok: true, waiting: r.waiting });
    }
    await verifyImap({ host: cfg.host!, port: cfg.port, secure: cfg.secure, user: cfg.user!, pass: cfg.pass! });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    // verifyImap throws an actionable message (bad login / IMAP disabled / etc).
    return NextResponse.json(
      { ok: false, error: err?.message || "Could not connect to the mailbox." },
      { status: 400 }
    );
  }
}
