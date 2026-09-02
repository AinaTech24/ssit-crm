/**
 * IMAP inbox-sync worker.
 *
 * For every tenant that connected a mailbox (Settings → Email → Connect your
 * mailbox) with IMAP credentials, polls the INBOX for new messages and ingests
 * them into the unified `communications` log as inbound email — matched to an
 * investor or lead by the sender's address when possible.
 *
 * State: a per-tenant high-water UID is stored in the (encrypted) integration
 * config (`imap.lastUid`) so each cycle only fetches genuinely-new mail. IMAP
 * network I/O happens OUTSIDE the DB transaction so a slow mailbox never pins a
 * Postgres connection.
 */

import { and, eq, desc, inArray } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { withSystem, withTenant } from "@/db/client";
import { decrypt, encrypt } from "@/lib/crypto";
import { imapFetchSince, type InboundEmail, type ImapConfig } from "@/lib/comms/imap";
import { describeMailError } from "@/lib/comms/connection-error";
import { tenantIntegrations } from "@/db/schema/tenant_integrations";
import { communications, investors, leads } from "@/db/schema";
import { maybeRouteEmailToTicket } from "@/lib/comms/email-to-ticket";
import { refreshAccessToken, getProviderDef, type OAuthProvider } from "@/lib/comms/oauth";
import { sql } from "drizzle-orm";
import { captureError } from "@/lib/observability/capture";

async function ingest(
  tenantId: string,
  msgs: InboundEmail[],
  ownerUserId: string | null
): Promise<{ ingested: number; maxUid: number }> {
  let ingested = 0;
  let maxUid = 0;
  await withTenant(tenantId, async (tx) => {
    for (const m of msgs) {
      if (m.uid > maxUid) maxUid = m.uid;
      const ext = m.messageId ?? `imap-${tenantId}-${m.uid}`;

      // Skip if we've already logged this message (idempotent re-runs).
      const [dup] = await tx
        .select({ id: communications.id })
        .from(communications)
        .where(and(eq(communications.tenantId, tenantId), eq(communications.channel, "email"), eq(communications.externalId, ext)))
        .limit(1);
      if (dup) continue;

      // Best-effort match the sender to an existing investor, else a lead.
      const fromEmail = m.from?.toLowerCase().trim() ?? null;
      let investorId: string | null = null;
      let leadId: string | null = null;
      if (fromEmail) {
        const [inv] = await tx
          .select({ id: investors.id })
          .from(investors)
          .where(and(eq(investors.tenantId, tenantId), sql`lower(${investors.email}) = ${fromEmail}`))
          .limit(1);
        if (inv) investorId = inv.id;
        else {
          const [ld] = await tx
            .select({ id: leads.id })
            .from(leads)
            .where(and(eq(leads.tenantId, tenantId), sql`lower(${leads.email}) = ${fromEmail}`))
            .limit(1);
          if (ld) leadId = ld.id;
        }
      }

      // ── Threading + reply detection ───────────────────────────────────
      // (a) Header match: link to the outbound whose Message-ID this reply
      //     references (works when we sent via SMTP, where messageId is real).
      const refIds = [m.inReplyTo, ...(m.references?.split(/\s+/) ?? [])]
        .map((r) => r?.trim())
        .filter(Boolean) as string[];
      let threadId: string | null = null;
      let replyToOutboundId: string | null = null;
      if (refIds.length) {
        const [parent] = await tx
          .select({ id: communications.id, threadId: communications.threadId })
          .from(communications)
          .where(and(eq(communications.tenantId, tenantId), eq(communications.channel, "email"), eq(communications.direction, "outbound"), inArray(communications.messageId, refIds)))
          .limit(1);
        if (parent) {
          threadId = parent.threadId ?? null;
          replyToOutboundId = parent.id;
        }
      }
      // (b) Record fallback: thread onto the record's most recent email; if that
      //     latest message was an outbound, it's the one this reply answers.
      if (!threadId && (investorId || leadId)) {
        const [recent] = await tx
          .select({ id: communications.id, threadId: communications.threadId, direction: communications.direction })
          .from(communications)
          .where(and(eq(communications.tenantId, tenantId), eq(communications.channel, "email"), investorId ? eq(communications.investorId, investorId) : eq(communications.leadId, leadId!)))
          .orderBy(desc(communications.createdAt))
          .limit(1);
        if (recent?.threadId) threadId = recent.threadId;
        if (!replyToOutboundId && recent?.direction === "outbound") replyToOutboundId = recent.id;
      }
      if (!threadId) threadId = uuid();

      await tx.insert(communications).values({
        tenantId,
        // Attribute mail received on an RM's personal mailbox to that RM.
        userId: ownerUserId,
        channel: "email",
        direction: "inbound",
        investorId,
        leadId,
        externalId: ext,
        status: "delivered",
        threadId,
        messageId: m.messageId ?? null,
        inReplyTo: m.inReplyTo ?? null,
        emailReferences: m.references ?? null,
        inboundContent: {
          from: m.from ?? null,
          fromName: m.fromName ?? null,
          subject: m.subject ?? null,
          text: m.text ?? null,
          html: m.html ?? null,
          messageId: m.messageId ?? null,
          receivedAt: m.date ? m.date.toISOString() : null,
        },
      } as any);
      ingested++;

      // Mark the answered outbound 'replied' (don't regress a terminal state).
      if (replyToOutboundId) {
        await tx
          .update(communications)
          .set({ status: "replied", repliedAt: new Date() })
          .where(and(eq(communications.id, replyToOutboundId), inArray(communications.status, ["sent", "delivered", "read"])));
      }

      // Email → Service Request auto-routing (parity with WhatsApp intake).
      await maybeRouteEmailToTicket(tx, {
        tenantId,
        investorId,
        subject: m.subject ?? null,
        text: m.text ?? null,
        messageId: ext,
      });
    }
  });
  return { ingested, maxUid };
}

export function startImapPollerWorker() {
  const interval = Number(process.env.IMAP_POLLER_INTERVAL_MS ?? 120_000);
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      // Every mailbox row — firm-wide (user_id NULL) AND each RM's personal one.
      const rows = await withSystem(async (tx) =>
        tx
          .select({
            id: tenantIntegrations.id,
            tenantId: tenantIntegrations.tenantId,
            userId: tenantIntegrations.userId,
            encryptedConfig: tenantIntegrations.encryptedConfig,
          })
          .from(tenantIntegrations)
          .where(and(eq(tenantIntegrations.provider, "mailbox"), eq(tenantIntegrations.isActive, true)))
          .limit(500)
      );

      for (const row of rows) {
        let config: any;
        try {
          config = JSON.parse(decrypt(row.encryptedConfig));
        } catch {
          continue; // can't decrypt (key rotated?) — skip, not fatal
        }

        const oauth = config?.oauth as { provider?: OAuthProvider; refreshToken?: string; email?: string } | undefined;
        const imap = config?.imap ?? {};
        const lastUid = Number(imap.lastUid ?? 0);

        // Build the IMAP connection — password mailbox or OAuth (XOAUTH2).
        let cfg: ImapConfig | null = null;
        let rotatedRefresh: string | undefined;
        if (oauth?.provider && oauth.refreshToken) {
          try {
            const t = await refreshAccessToken(oauth.provider, oauth.refreshToken);
            rotatedRefresh = t.refreshToken;
            const def = getProviderDef(oauth.provider);
            cfg = {
              host: imap.host || def.imap.host,
              port: Number(imap.port ?? def.imap.port),
              secure: imap.secure ?? def.imap.secure,
              user: oauth.email || imap.user || "",
              pass: "",
              accessToken: t.accessToken,
            };
          } catch (e) {
            captureError("[imap] OAuth refresh failed — mailbox disconnected", e, { tenantId: row.tenantId, userId: row.userId ?? "firm" });
            continue;
          }
        } else if (imap.host && imap.user && imap.pass) {
          cfg = { host: imap.host, port: Number(imap.port), secure: !!imap.secure, user: imap.user, pass: imap.pass };
        }
        if (!cfg) continue; // no IMAP configured on this mailbox

        let msgs: InboundEmail[];
        try {
          msgs = await imapFetchSince(cfg, lastUid);
        } catch (e) {
          // Log the actionable reason (imapflow's bare "Command failed" is almost
          // always a rejected login — provider needs an app-specific password +
          // IMAP enabled), not the cryptic raw message.
          console.error(`[imap] ${row.tenantId}/${row.userId ?? "firm"} fetch failed: ${describeMailError(e, "imap")} (raw: ${(e as Error).message})`);
          continue;
        }

        const { ingested, maxUid } = msgs.length
          ? await ingest(row.tenantId, msgs, row.userId ?? null)
          : { ingested: 0, maxUid: 0 };

        // Persist new high-water UID + any rotated OAuth refresh token, scoped to
        // THIS row's id (a tenant can now have several mailbox rows).
        const advanced = maxUid > lastUid;
        if (advanced || rotatedRefresh) {
          if (advanced) config.imap = { ...imap, lastUid: maxUid };
          if (rotatedRefresh && oauth) config.oauth = { ...oauth, refreshToken: rotatedRefresh };
          const enc = encrypt(JSON.stringify(config));
          await withTenant(row.tenantId, async (tx) => {
            await tx
              .update(tenantIntegrations)
              .set({ encryptedConfig: enc, updatedAt: new Date() })
              .where(eq(tenantIntegrations.id, row.id));
          });
        }
        if (ingested) console.log(`[imap] ${row.tenantId}/${row.userId ?? "firm"}: ingested ${ingested}, uid→${maxUid}`);
      }
    } finally {
      running = false;
    }
  };

  const handle = setInterval(tick, interval);
  console.log(`[imap] inbox poller started (interval=${interval}ms)`);
  return () => clearInterval(handle);
}
