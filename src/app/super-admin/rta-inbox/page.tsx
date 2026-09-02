import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { getRtaInboxStatusForAdmin } from "@/lib/rta/inbox-config";
import { RtaInboxSettingsForm } from "@/components/super-admin/RtaInboxSettingsForm";

export const dynamic = "force-dynamic";

export default async function PlatformRtaInboxPage() {
  const session = await requireSession();
  requirePlatform(session.roles, "platform.settings.manage");

  const status = await getRtaInboxStatusForAdmin();

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">RTA Mailbox</h1>
        <p className="text-muted-foreground text-sm">
          The single catch-all mailbox that powers direct RTA mailback auto-import. Every MFD auto-forwards their
          daily CAMS / KFintech mailback email to a unique <code className="bg-muted px-1 rounded">rta-&lt;token&gt;@{status.domain}</code>{" "}
          address; a catch-all delivers them into this one mailbox, which the worker polls and imports.
        </p>
      </div>

      <RtaInboxSettingsForm initial={status} />

      <div className="border rounded-lg bg-muted/30 p-4 text-xs text-muted-foreground space-y-1.5 max-w-2xl">
        <p className="font-medium text-foreground">How it works</p>
        <p>
          Create ONE mailbox at your provider (e.g. <strong>rta@{status.domain}</strong> on Hostinger), turn on a{" "}
          <strong>catch-all</strong> for the domain pointing to it, and enter the <strong>IMAP</strong> details here — host,
          port (993 SSL), the mailbox address as username, and its password.
        </p>
        <p>
          Settings saved here always win; if nothing is set, the platform falls back to the{" "}
          <code className="bg-background px-1 rounded">RTA_INBOX_*</code> environment variables. The password is stored
          encrypted (AES-256-GCM) and never shown again. The poller re-reads this every ~2 minutes — no worker restart needed.
        </p>
        <p>
          Use <strong>Test connection</strong> after saving to confirm the mailbox is reachable before firms start forwarding.
        </p>
      </div>
    </div>
  );
}
