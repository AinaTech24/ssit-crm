import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { tenantIntegrations } from "@/db/schema/tenant_integrations";
import { decrypt, encrypt } from "@/lib/crypto";

export type IntegrationProvider = "resend" | "msg91" | "vartify" | "mailbox";

export interface TenantIntegrationResolved {
  id: string;
  tenantId: string;
  /** NULL = firm-wide row; set = a specific user's personal mailbox. */
  userId?: string | null;
  provider: IntegrationProvider;
  config: {
    apiKey: string;
    /** Vartify: optional override of the platform send endpoint. */
    webhookUrl?: string;
    /** Vartify: default WhatsApp language code, e.g. "en_US". */
    defaultLanguage?: string;
    [key: string]: any;
  };
  senderConfig: {
    fromEmail?: string;
    fromName?: string;
    /** Where client replies land — the MFD's own inbox. */
    replyTo?: string;
    senderId?: string;
    whatsappPhoneE164?: string;
  } | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function rowToResolved(row: any): TenantIntegrationResolved | null {
  try {
    const config = JSON.parse(decrypt(row.encryptedConfig));
    return { ...row, config } as TenantIntegrationResolved;
  } catch (err) {
    console.error(
      `[comms-integrations] Failed to decrypt integration settings for tenant ${row.tenantId}, provider ${row.provider}:`,
      err
    );
    return null;
  }
}

/**
 * Resolve the FIRM-WIDE integration row (user_id IS NULL). Per-user mailboxes are
 * fetched via getUserMailbox so the firm default never accidentally returns a
 * personal row now that both can co-exist.
 */
export async function getTenantIntegration(
  tx: Tx,
  tenantId: string,
  provider: IntegrationProvider
): Promise<TenantIntegrationResolved | null> {
  const [row] = await tx
    .select()
    .from(tenantIntegrations)
    .where(
      and(
        eq(tenantIntegrations.tenantId, tenantId),
        eq(tenantIntegrations.provider, provider),
        isNull(tenantIntegrations.userId),
        eq(tenantIntegrations.isActive, true)
      )
    )
    .limit(1);
  if (!row) return null;
  return rowToResolved(row);
}

/** Resolve a specific user's personal mailbox (provider = "mailbox"). */
/**
 * The firm's SINGLE active personal mailbox, or null when there are none or
 * more than one.
 *
 * Last-resort sender for automations, which run with no acting user and would
 * otherwise demand a firm-wide mailbox most firms never connect. Only ever one:
 * with a single mailbox there is no question whose identity the firm sends
 * under; with several, picking one would put an arbitrary RM's name on the
 * firm's mail.
 */
export async function getSoleUserMailbox(
  tx: Tx,
  tenantId: string
): Promise<TenantIntegrationResolved | null> {
  const rows = await tx
    .select()
    .from(tenantIntegrations)
    .where(
      and(
        eq(tenantIntegrations.tenantId, tenantId),
        eq(tenantIntegrations.provider, "mailbox"),
        eq(tenantIntegrations.isActive, true)
      )
    )
    .limit(3);
  const personal = rows.filter((r) => r.userId != null);
  if (personal.length !== 1) return null;
  return rowToResolved(personal[0]);
}

export async function getUserMailbox(
  tx: Tx,
  tenantId: string,
  userId: string
): Promise<TenantIntegrationResolved | null> {
  const [row] = await tx
    .select()
    .from(tenantIntegrations)
    .where(
      and(
        eq(tenantIntegrations.tenantId, tenantId),
        eq(tenantIntegrations.provider, "mailbox"),
        eq(tenantIntegrations.userId, userId),
        eq(tenantIntegrations.isActive, true)
      )
    )
    .limit(1);
  if (!row) return null;
  return rowToResolved(row);
}

/**
 * Create or update an integration row. `opts.userId` targets a personal mailbox;
 * omitted/null targets the firm-wide row. The `config` is encrypted at rest.
 *
 * A manual select→update/insert (rather than ON CONFLICT) because the uniqueness
 * is now enforced by two PARTIAL indexes that ON CONFLICT can't address cleanly.
 */
export async function upsertTenantIntegration(
  tx: Tx,
  tenantId: string,
  provider: IntegrationProvider,
  config: Record<string, any>,
  senderConfig?: TenantIntegrationResolved["senderConfig"],
  opts?: { userId?: string | null }
): Promise<void> {
  const userId = opts?.userId ?? null;
  const encryptedConfig = encrypt(JSON.stringify(config));

  const [existing] = await tx
    .select({ id: tenantIntegrations.id })
    .from(tenantIntegrations)
    .where(
      and(
        eq(tenantIntegrations.tenantId, tenantId),
        eq(tenantIntegrations.provider, provider),
        userId ? eq(tenantIntegrations.userId, userId) : isNull(tenantIntegrations.userId)
      )
    )
    .limit(1);

  if (existing) {
    await tx
      .update(tenantIntegrations)
      .set({
        encryptedConfig,
        senderConfig: senderConfig ?? null,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(tenantIntegrations.id, existing.id));
    return;
  }

  await tx.insert(tenantIntegrations).values({
    tenantId,
    userId,
    provider,
    encryptedConfig,
    senderConfig: senderConfig ?? null,
    isActive: true,
  } as any);
}

/** Soft-disconnect: mark the integration inactive (keeps the row for audit). */
export async function disableTenantIntegration(
  tx: Tx,
  tenantId: string,
  provider: IntegrationProvider,
  opts?: { userId?: string | null }
): Promise<void> {
  const userId = opts?.userId ?? null;
  await tx
    .update(tenantIntegrations)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      and(
        eq(tenantIntegrations.tenantId, tenantId),
        eq(tenantIntegrations.provider, provider),
        userId ? eq(tenantIntegrations.userId, userId) : isNull(tenantIntegrations.userId)
      )
    );
}

/** Non-secret status for the Settings UI: connected? + a masked key hint. */
export async function getTenantIntegrationStatus(
  tx: Tx,
  tenantId: string,
  provider: IntegrationProvider
): Promise<{ connected: boolean; keyHint?: string; webhookUrl?: string; defaultLanguage?: string }> {
  const resolved = await getTenantIntegration(tx, tenantId, provider);
  if (!resolved) return { connected: false };
  const key = resolved.config.apiKey ?? "";
  const keyHint = key ? `••••${key.slice(-4)}` : undefined;
  return {
    connected: true,
    keyHint,
    webhookUrl: resolved.config.webhookUrl,
    defaultLanguage: resolved.config.defaultLanguage,
  };
}
