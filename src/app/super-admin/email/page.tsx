import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { getEmailStatusForAdmin } from "@/lib/comms/email-config";
import { EmailSettingsForm } from "@/components/super-admin/EmailSettingsForm";

export const dynamic = "force-dynamic";

export default async function PlatformEmailPage() {
  const session = await requireSession();
  requirePlatform(session.roles, "platform.settings.manage");

  const status = await getEmailStatusForAdmin();

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Email</h1>
        <p className="text-muted-foreground text-sm">
          Configure how the platform sends transactional email — password-reset links, team invites
          and staff alerts. Set the API key once here; no redeploy needed.
        </p>
      </div>

      <EmailSettingsForm initial={status} />

      <div className="border rounded-lg bg-muted/30 p-4 text-xs text-muted-foreground space-y-1.5 max-w-2xl">
        <p className="font-medium text-foreground">How it works</p>
        <p>
          Reset links, invites and alerts send through <strong>your own SMTP server</strong>. Enter the host, port,
          username and password from your email provider. Port <strong>465</strong> uses implicit TLS (tick the box);
          port <strong>587</strong> uses STARTTLS (leave it unticked) — common for Gmail/Workspace, Microsoft 365, Zoho, etc.
        </p>
        <p>
          The <strong>From</strong> address usually must match the authenticated mailbox/domain, or the provider rejects the
          send. If nothing is set here, the platform falls back to the <code className="bg-background px-1 rounded">SMTP_*</code>{" "}
          environment variables. Settings saved here always win; the password is stored encrypted (AES-256-GCM).
        </p>
        <p>
          Use <strong>Send test</strong> after saving to confirm end-to-end delivery before relying on it for resets.
        </p>
      </div>
    </div>
  );
}
