/**
 * resolveEmailSender — the single place that decides HOW an outbound email
 * leaves the building, for both the template pipeline (`dispatch`) and free
 * Compose (`composeAndSendEmail`).
 *
 * WHO a message is from follows WHO acted, not what happens to be connected:
 *
 *   userId given  → that user's own mailbox, and nothing else. If they have not
 *                   connected one this THROWS. It does NOT quietly fall back to
 *                   the firm mailbox: an RM's proposal arriving from the firm
 *                   admin's address puts the wrong person's name on their work
 *                   and sends the client's reply to the wrong inbox. Pass
 *                   allowFirmFallback for the few sends that are genuinely the
 *                   firm speaking (digests to staff, public OTPs).
 *   no userId     → the firm-wide mailbox (automations, invites, system mail).
 *
 * There is NO platform-sender option. Email leaves only through a mailbox the firm owns,
 * so every message genuinely originates from their own server with an authentic
 * From address. If neither mailbox is connected this THROWS rather than falling
 * back to a platform sender — a silent fallback is how a firm ends up sending
 * client mail from an address they do not control, and how "RESEND_API_KEY not
 * set" surfaced to a user as "your mailbox isn't connected".
 *
 * OAuth mailboxes carry only a refresh token at rest; we mint a short-lived
 * access token here per send and pass it to the adapter for XOAUTH2.
 */

import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { tenantIntegrations } from "@/db/schema/tenant_integrations";
import { encrypt } from "@/lib/crypto";
import type { SmtpConfig } from "./adapters/resend";
import {
  getSoleUserMailbox,
  getTenantIntegration,
  getUserMailbox,
  type TenantIntegrationResolved,
} from "./integrations";
import { getProviderDef, refreshAccessToken, type OAuthProvider } from "./oauth";

export interface EmailSender {
  /** Always present — SMTP is the only transport. */
  smtp?: SmtpConfig;
  fromEmail?: string;
  fromName?: string;
  replyTo?: string;
  source: "user-mailbox" | "tenant-mailbox";
}

/** Turn a resolved mailbox integration into an SMTP send descriptor, minting an
 *  OAuth access token when the mailbox is OAuth-connected. Returns null if the
 *  row isn't a usable mailbox (no SMTP host and no OAuth). */
async function mailboxToSmtp(
  tx: Tx,
  m: TenantIntegrationResolved | null
): Promise<Omit<EmailSender, "source"> | null> {
  if (!m?.isActive) return null;
  const cfg: any = m.config ?? {};
  const oauth = cfg.oauth as { provider?: OAuthProvider; refreshToken?: string; email?: string } | undefined;

  // ── OAuth mailbox (Gmail / M365) ──────────────────────────────────────────
  if (oauth?.provider && oauth.refreshToken) {
    let accessToken: string;
    let rotatedRefresh: string | undefined;
    try {
      const t = await refreshAccessToken(oauth.provider, oauth.refreshToken);
      accessToken = t.accessToken;
      rotatedRefresh = t.refreshToken;
    } catch (e) {
      console.error(`[sender] OAuth token refresh failed for ${m.tenantId}/${m.userId ?? "firm"}:`, (e as Error).message);
      return null; // fall through to the next sender
    }
    // Persist a rotated refresh token (Microsoft rotates) — best-effort.
    if (rotatedRefresh && rotatedRefresh !== oauth.refreshToken) {
      try {
        const next = { ...cfg, oauth: { ...oauth, refreshToken: rotatedRefresh } };
        await tx
          .update(tenantIntegrations)
          .set({ encryptedConfig: encrypt(JSON.stringify(next)), updatedAt: new Date() })
          .where(eq(tenantIntegrations.id, m.id));
      } catch {
        /* non-fatal */
      }
    }
    const def = getProviderDef(oauth.provider);
    const host = cfg.smtp?.host || def.smtp.host;
    const port = Number(cfg.smtp?.port ?? def.smtp.port);
    const secure = cfg.smtp?.secure ?? def.smtp.secure;
    const user = oauth.email || cfg.smtp?.user || m.senderConfig?.fromEmail || "";
    return {
      smtp: { host, port, secure, user, pass: "", accessToken },
      fromEmail: m.senderConfig?.fromEmail || oauth.email || user,
      fromName: m.senderConfig?.fromName,
      replyTo: m.senderConfig?.replyTo || oauth.email || user,
    };
  }

  // ── Password SMTP mailbox ─────────────────────────────────────────────────
  const smtp = cfg.smtp as SmtpConfig | undefined;
  if (smtp?.host) {
    return {
      smtp: { host: smtp.host, port: Number(smtp.port), secure: !!smtp.secure, user: smtp.user, pass: smtp.pass },
      fromEmail: m.senderConfig?.fromEmail || smtp.user,
      fromName: m.senderConfig?.fromName,
      replyTo: m.senderConfig?.replyTo || smtp.user,
    };
  }
  return null;
}

export interface ResolveSenderOptions {
  /**
   * Allow a known actor to fall back to the firm mailbox. Only for sends that
   * are the FIRM speaking rather than the person — staff digests, public OTPs.
   * Never for client-facing mail a user initiated.
   */
  allowFirmFallback?: boolean;
  /**
   * Refuse the "sole connected mailbox" fallback. Set for firm-identity mail
   * (team invites): borrowing whichever colleague happens to be connected would
   * send an invite from an RM's address.
   */
  firmMailboxOnly?: boolean;
}

export async function resolveEmailSender(
  tx: Tx,
  tenantId: string,
  userId?: string | null,
  opts: ResolveSenderOptions = {}
): Promise<EmailSender> {
  // 1. The acting user's own mailbox — their action, their identity.
  if (userId) {
    const um = await getUserMailbox(tx, tenantId, userId);
    const s = await mailboxToSmtp(tx, um);
    if (s) return { ...s, source: "user-mailbox" };
    if (!opts.allowFirmFallback) {
      throw Object.assign(
        new Error(
          "Your mailbox isn't connected, so this email can't be sent as you. Connect it under Settings → Integrations → Mailbox. (Mail you send is sent from your own address, not the firm's, so replies come back to you.)"
        ),
        { status: 422 }
      );
    }
  }
  // 2. The firm-wide mailbox.
  const tm = await getTenantIntegration(tx, tenantId, "mailbox");
  const s = await mailboxToSmtp(tx, tm);
  if (s) return { ...s, source: "tenant-mailbox" };

  // 3. Fall back to the firm's ONE connected personal mailbox.
  //
  // Automations (workflow rules, recipes) send with no actor and default to the
  // firm-wide mailbox. Most firms never connect one — every RM connects their
  // own — so "Welcome email to new lead" failed on every run with "No mailbox
  // is connected" even though a working, verified mailbox existed.
  //
  // Deliberately only when there is EXACTLY ONE. With one there is no question
  // whose identity the firm sends under; with several, picking one would put an
  // arbitrary RM's name on the firm's mail, so we still refuse.
  const only = opts.firmMailboxOnly ? null : await getSoleUserMailbox(tx, tenantId);
  if (only) {
    const s = await mailboxToSmtp(tx, only);
    if (s) return { ...s, source: "tenant-mailbox" };
  }

  // 4. Nothing connected — refuse, with an error the reader can act on. Status
  // 422 so API routes surface it as a user error rather than a masked 500.
  throw Object.assign(
    new Error(
      "No mailbox is connected, so this firm cannot send email. Connect one under Settings → Integrations → Mailbox — either your own, or a firm-wide mailbox set up by your admin."
    ),
    { status: 422 }
  );
}

