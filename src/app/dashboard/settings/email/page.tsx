import Link from "next/link";
import { eq } from "drizzle-orm";
import { ChevronLeft, Mail, Check, AlertCircle, User2, Building2 } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { getTenantIntegration, getUserMailbox } from "@/lib/comms/integrations";
import { isOAuthConfigured } from "@/lib/comms/oauth";
import { tenants } from "@/db/schema";
import { EmailSenderForm } from "@/components/settings/EmailSenderForm";
import { MailboxForm } from "@/components/settings/MailboxForm";

export const dynamic = "force-dynamic";

function mailboxInitial(mailbox: any, tenant: any) {
  const smtp = mailbox?.config?.smtp;
  const imap = mailbox?.config?.imap;
  return {
    connected: !!(mailbox?.isActive && (smtp?.host || mailbox?.config?.oauth?.provider)),
    smtp: smtp ? { host: smtp.host, port: smtp.port, secure: smtp.secure, user: smtp.user, hasPass: !!smtp.pass } : null,
    imap: imap ? { host: imap.host, port: imap.port, secure: imap.secure, user: imap.user, hasPass: !!imap.pass } : null,
    fromName: mailbox?.senderConfig?.fromName ?? "",
    fromEmail: mailbox?.senderConfig?.fromEmail ?? "",
    replyTo: mailbox?.senderConfig?.replyTo ?? "",
    firmName: tenant?.displayName ?? tenant?.legalName ?? "",
    firmEmail: tenant?.email ?? "",
  };
}

function oauthOf(mailbox: any): { provider: string; email: string | null } | null {
  const o = mailbox?.config?.oauth;
  return o?.provider ? { provider: o.provider, email: o.email ?? null } : null;
}

export default async function EmailSettingsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const sp = (await searchParams) ?? {};
  const connectedProvider = typeof sp.connected === "string" ? sp.connected : null;
  const oauthError = typeof sp.oauth_error === "string" ? sp.oauth_error : null;
  const isOwner = !!session.roles?.includes("owner");

  const { resolved, mailbox, userMailbox, tenant } = await withTenant(session.tenantId, async (tx) => {
    const resolved = await getTenantIntegration(tx, session.tenantId, "resend");
    const mailbox = await getTenantIntegration(tx, session.tenantId, "mailbox");
    const userMailbox = await getUserMailbox(tx, session.tenantId, session.userId);
    const [t] = await tx
      .select({ displayName: tenants.displayName, legalName: tenants.legalName, email: tenants.email })
      .from(tenants)
      .where(eq(tenants.id, session.tenantId))
      .limit(1);
    return { resolved, mailbox, userMailbox, tenant: t };
  });

  const oauthAvailable = { google: isOAuthConfigured("google"), microsoft: isOAuthConfigured("microsoft") };

  const platformConfigured = !!(process.env.RESEND_API_KEY && !process.env.RESEND_API_KEY.includes("xxx"));
  const ownKey = resolved?.config?.apiKey ?? "";
  const usingCustom = !!(resolved?.senderConfig?.fromName || resolved?.senderConfig?.fromEmail || resolved?.senderConfig?.replyTo);

  return (
    <div className="space-y-4 max-w-3xl">
      <Link href="/dashboard/settings" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to settings
      </Link>
      <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
        <Mail className="size-5" /> Email setup
      </h1>

      {connectedProvider && (
        <div className="border rounded-lg p-3 bg-emerald-50 border-emerald-300 text-sm flex items-center gap-2">
          <Check className="size-4 text-emerald-600" />
          Mailbox connected via {connectedProvider === "google" ? "Google" : "Microsoft 365"}.
        </div>
      )}
      {oauthError && (
        <div className="border rounded-lg p-3 bg-rose-50 border-rose-300 text-sm flex items-center gap-2">
          <AlertCircle className="size-4 text-rose-600" />
          Couldn’t connect: {oauthError}
        </div>
      )}

      {/* My mailbox — every RM can connect their own inbox */}
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-1 flex items-center gap-1.5">
        <User2 className="size-3.5" /> My mailbox
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        Connect your personal inbox so emails you send to clients go out as <em>you</em>, and their replies come straight
        back to you. Used ahead of the firm mailbox for anything you send.
      </p>
      <MailboxForm
        scope="user"
        oauth={oauthOf(userMailbox)}
        oauthAvailable={oauthAvailable}
        initial={mailboxInitial(userMailbox, tenant)}
      />

      {/* Platform sending status (firm-level) */}
      <div className={`border rounded-lg p-4 ${platformConfigured ? "bg-emerald-50 border-emerald-300" : "bg-amber-50 border-amber-300"}`}>
        <div className="flex items-start gap-2">
          {platformConfigured ? (
            <Check className="size-5 text-emerald-600 mt-0.5" />
          ) : (
            <AlertCircle className="size-5 text-amber-600 mt-0.5" />
          )}
          <div className="text-sm">
            <div className="font-medium">{platformConfigured ? "Email delivery active" : "Email delivery not yet configured"}</div>
            <p className="text-muted-foreground mt-0.5">
              {platformConfigured
                ? usingCustom
                  ? "Client emails go out under your firm's identity (set below) when no personal mailbox applies."
                  : "Set your firm sender identity below so client emails come from your firm, not the shared address."
                : "Email sends are queued in stub mode until the platform email key is configured."}
            </p>
          </div>
        </div>
      </div>

      {isOwner ? (
        <>
          {/* Option A — sender identity on the platform's email service */}
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-1 flex items-center gap-1.5">
            <Building2 className="size-3.5" /> Firm · Option A — Use the platform email service
          </div>
          <EmailSenderForm
            initial={{
              fromName: resolved?.senderConfig?.fromName ?? "",
              fromEmail: resolved?.senderConfig?.fromEmail ?? "",
              replyTo: resolved?.senderConfig?.replyTo ?? "",
              ownKeyHint: ownKey ? `••••${ownKey.slice(-4)}` : null,
              platformFrom: process.env.EMAIL_FROM_TRANSACTIONAL ?? null,
              firmName: tenant?.displayName ?? tenant?.legalName ?? "",
              firmEmail: tenant?.email ?? "",
            }}
          />

          {/* Option B — connect the firm's own mailbox over SMTP/IMAP/OAuth */}
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-2 flex items-center gap-1.5">
            <Building2 className="size-3.5" /> Firm · Option B — Connect the firm mailbox
          </div>
          <MailboxForm
            scope="tenant"
            oauth={oauthOf(mailbox)}
            oauthAvailable={oauthAvailable}
            initial={mailboxInitial(mailbox, tenant)}
          />
        </>
      ) : (
        <div className="border rounded-lg bg-card p-4 text-xs text-muted-foreground">
          The firm-wide sender identity and shared mailbox are managed by your firm owner. Anything you send falls back to
          the firm mailbox when you haven’t connected your own above.
        </div>
      )}

      <div className="border rounded-lg bg-card p-4 text-xs text-muted-foreground">
        Transactional and marketing emails stay on separate sending streams for deliverability. A marketing
        unsubscribe footer is auto-injected. Every send still passes the consent + compliance gate regardless of which
        mailbox it leaves from.
      </div>
    </div>
  );
}
