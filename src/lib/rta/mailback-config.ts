/**
 * Per-tenant RTA mailback (email-forward import) configuration.
 *
 * Two pieces of state per firm:
 *   1. The ZIP passwords — separate CAMS + KFintech — stored ENCRYPTED in
 *      `tenant_integrations` (provider "rta_mailback"), same crypto the comms
 *      adapters / FP / Zoho use.
 *   2. The unique inbound forwarding address — a row in `rta_forward_addresses`
 *      (the email analogue of `whatsapp_numbers`) the poller resolves to a tenant.
 *
 * The MFD sets a one-time auto-forward rule from their mailbox to this address;
 * src/workers/rta-inbox-poller.ts ingests the attachment through the existing
 * rta.import pipeline.
 */

import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { withSystem, type Tx } from "@/db/client";
import { tenantIntegrations } from "@/db/schema/tenant_integrations";
import { rtaForwardAddresses } from "@/db/schema/rta_forward_addresses";
import { decrypt, encrypt } from "@/lib/crypto";
import { getInboundDomain } from "./inbox-config";

const PROVIDER = "rta_mailback" as const;

/** One saved ZIP password, labelled so the firm can tell subscriptions apart. */
export type PasswordEntry = { label: string; password: string };

export type MailbackPasswords = {
  /** @deprecated legacy single-password shape — still READ for old tenants,
   *  never written after the first save under the new (array) shape below. */
  camsPassword?: string;
  /** @deprecated see camsPassword. */
  kfintechPassword?: string;
  /**
   * Every ZIP password this firm has told us about for CAMS, tried in order
   * until one opens the archive.
   *
   * A firm can hold MORE THAN ONE ARN — a second distribution code from a
   * merger, a sub-distributor arrangement, a legacy code kept active — and
   * each ARN's mailback subscription is registered with the registrar
   * separately, often with its OWN password. Treating "password didn't match"
   * as "not this firm's file" would silently discard that firm's own data
   * from its second ARN. The fix is to hold every password the firm owns and
   * try each one; a file is only "not ours" when NONE of them open it.
   */
  camsPasswords?: PasswordEntry[];
  /** Every ZIP password this firm has told us about for KFintech. See camsPasswords. */
  kfintechPasswords?: PasswordEntry[];
};

const MAX_PASSWORD_ENTRIES = 8;

/**
 * Every candidate password for a source, de-duplicated, newest-labelled-first
 * then the legacy single value (if any and not already covered). Empty when
 * nothing is saved — callers treat that as "try with no password".
 */
export function passwordCandidates(pw: MailbackPasswords, source: string): PasswordEntry[] {
  // Only CAMS and KFintech mailback carries a saved ZIP password today — any
  // other RtaSource value (BSE Star, NSE NMF II, MFU) has
  // nothing to look up. Widened to `string` so callers passing the broader
  // RtaSource union (mailback classification only ever produces cams/kfintech,
  // but its TYPE is the full registry) don't need a narrowing cast.
  if (source !== "cams" && source !== "kfintech") return [];
  const list = source === "cams" ? pw.camsPasswords : pw.kfintechPasswords;
  const legacy = source === "cams" ? pw.camsPassword : pw.kfintechPassword;
  const out: PasswordEntry[] = [];
  const seen = new Set<string>();
  for (const e of list ?? []) {
    if (e?.password && !seen.has(e.password)) {
      out.push(e);
      seen.add(e.password);
    }
  }
  if (legacy && !seen.has(legacy)) out.push({ label: "Primary", password: legacy });
  return out;
}

/**
 * Every saved entry for a source, in stored order, WITHOUT de-duplicating by
 * password — so two ARNs/mailboxes that happen to share the same ZIP password
 * each keep their own labelled row. This is what the settings UI shows and what
 * add/remove operate on (index-aligned with the display).
 *
 * Contrast with {@link passwordCandidates}, which DOES collapse duplicate
 * passwords — correct only for the import pipeline, where trying the identical
 * password twice is pointless.
 */
export function listPasswordEntries(pw: MailbackPasswords, source: string): PasswordEntry[] {
  if (source !== "cams" && source !== "kfintech") return [];
  const list = source === "cams" ? pw.camsPasswords : pw.kfintechPasswords;
  const legacy = source === "cams" ? pw.camsPassword : pw.kfintechPassword;
  const out: PasswordEntry[] = [];
  for (const e of list ?? []) {
    if (e?.password) out.push({ label: e.label || `Password ${out.length + 1}`, password: e.password });
  }
  // Include an un-migrated legacy single password only if it isn't already listed.
  if (legacy && !out.some((e) => e.password === legacy)) out.push({ label: "Primary", password: legacy });
  return out;
}

// The inbound mailbox/domain config now lives in SSIT Admin (platform_settings,
// env fallback) — see src/lib/rta/inbox-config.ts (getInboundDomain /
// loadRtaInboxConfig / isInboxConfigured).

// ── Passwords (tenant_integrations, encrypted) ──────────────────────────────

async function readPwRow(tx: Tx, tenantId: string): Promise<{ rowId: string; cfg: MailbackPasswords } | null> {
  const [row] = await tx
    .select()
    .from(tenantIntegrations)
    .where(
      and(
        eq(tenantIntegrations.tenantId, tenantId),
        eq(tenantIntegrations.provider, PROVIDER),
        isNull(tenantIntegrations.userId)
      )
    )
    .limit(1);
  if (!row) return null;
  try {
    return { rowId: row.id, cfg: JSON.parse(decrypt(row.encryptedConfig)) as MailbackPasswords };
  } catch (err) {
    console.error(`[rta-mailback] failed to decrypt config for tenant ${tenantId}:`, (err as Error).message);
    return { rowId: row.id, cfg: {} };
  }
}

/** Ready-to-use passwords for a tenant (empty object if none configured). */
export async function getMailbackPasswords(tx: Tx, tenantId: string): Promise<MailbackPasswords> {
  const read = await readPwRow(tx, tenantId);
  return read?.cfg ?? {};
}

/** A label is optional on input — `cleanEntryList` fills a default when blank. */
export type PasswordEntryInput = { label?: string; password: string };

/** Input to {@link saveMailbackPasswords} — either shape is accepted per source. */
export type MailbackPasswordsInput = {
  /** Legacy simple form: replaces the source's whole list with this one entry. */
  camsPassword?: string;
  kfintechPassword?: string;
  /** Explicit list form (what the settings UI uses): replaces the whole list. */
  camsPasswords?: PasswordEntryInput[];
  kfintechPasswords?: PasswordEntryInput[];
};

function cleanEntryList(arr: PasswordEntryInput[] | undefined): PasswordEntry[] {
  const out: PasswordEntry[] = [];
  for (const e of arr ?? []) {
    const password = (e?.password ?? "").trim();
    if (!password) continue;
    const label = (e?.label ?? "").trim().slice(0, 60) || `Password ${out.length + 1}`;
    out.push({ label, password });
    if (out.length >= MAX_PASSWORD_ENTRIES) break;
  }
  return out;
}

/**
 * Save (replace) the mailback passwords for whichever source(s) are present in
 * `input`. A source not mentioned at all is left untouched — the two RTAs are
 * configured independently.
 *
 * Every save normalises into the labelled-list shape (`camsPasswords` /
 * `kfintechPasswords`), even when called with the legacy single-string form —
 * so the config self-migrates on first touch. The legacy singular fields are
 * only ever READ afterwards, for tenants who haven't saved since this shipped.
 */
export async function saveMailbackPasswords(tx: Tx, tenantId: string, input: MailbackPasswordsInput): Promise<void> {
  const existing = await readPwRow(tx, tenantId);
  const merged: MailbackPasswords = { ...(existing?.cfg ?? {}) };

  if (input.camsPasswords !== undefined) {
    merged.camsPasswords = cleanEntryList(input.camsPasswords);
    delete merged.camsPassword;
  } else if (input.camsPassword !== undefined) {
    merged.camsPasswords = input.camsPassword.trim() ? [{ label: "Primary", password: input.camsPassword.trim() }] : [];
    delete merged.camsPassword;
  }

  if (input.kfintechPasswords !== undefined) {
    merged.kfintechPasswords = cleanEntryList(input.kfintechPasswords);
    delete merged.kfintechPassword;
  } else if (input.kfintechPassword !== undefined) {
    merged.kfintechPasswords = input.kfintechPassword.trim()
      ? [{ label: "Primary", password: input.kfintechPassword.trim() }]
      : [];
    delete merged.kfintechPassword;
  }

  const encryptedConfig = encrypt(JSON.stringify(merged));
  if (existing) {
    await tx
      .update(tenantIntegrations)
      .set({ encryptedConfig, isActive: true, updatedAt: new Date() })
      .where(eq(tenantIntegrations.id, existing.rowId));
    return;
  }
  await tx.insert(tenantIntegrations).values({
    tenantId,
    userId: null,
    provider: PROVIDER,
    encryptedConfig,
    isActive: true,
  } as any);
}

/**
 * Append one password to a registrar's list.
 *
 * The browser never holds a previously-saved entry's plaintext (only its
 * label), so it can't "resend the list unchanged" — the merge has to happen
 * here, server-side, reusing {@link saveMailbackPasswords} for the actual
 * normalise-and-encrypt step. A duplicate password (same secret, perhaps a
 * different label) is skipped rather than stored twice.
 */
export async function appendMailbackPassword(
  tx: Tx,
  tenantId: string,
  source: "cams" | "kfintech",
  entry: PasswordEntryInput
): Promise<PasswordEntry[]> {
  const cfg = await getMailbackPasswords(tx, tenantId);
  // Operate on the FULL stored list (not password-deduped) so a second ARN's
  // entry is kept even when it reuses an already-saved password under a new label.
  const current = listPasswordEntries(cfg, source);
  const password = (entry.password ?? "").trim();
  if (!password) return current;
  const label = (entry.label ?? "").trim().slice(0, 60) || `Password ${current.length + 1}`;
  // Only skip an EXACT duplicate (same label AND password) — i.e. a double-click
  // or re-submit. Same password under a different label is a legitimate second ARN.
  if (current.some((e) => e.password === password && e.label === label)) return current;
  const next = [...current, { label, password }].slice(0, MAX_PASSWORD_ENTRIES);
  await saveMailbackPasswords(tx, tenantId, source === "cams" ? { camsPasswords: next } : { kfintechPasswords: next });
  return next;
}

/**
 * Remove one password by its 0-based position in the list `passwordCandidates`
 * returns — the same order the settings UI displays, so "remove entry #2"
 * means exactly what the user clicked.
 */
export async function removeMailbackPasswordAt(
  tx: Tx,
  tenantId: string,
  source: "cams" | "kfintech",
  index: number
): Promise<PasswordEntry[]> {
  const cfg = await getMailbackPasswords(tx, tenantId);
  // Index-aligned with what the settings UI shows (the full list, not deduped).
  const current = listPasswordEntries(cfg, source);
  if (index < 0 || index >= current.length) return current;
  const next = current.filter((_, i) => i !== index);
  await saveMailbackPasswords(tx, tenantId, source === "cams" ? { camsPasswords: next } : { kfintechPasswords: next });
  return next;
}

// ── Forwarding address (rta_forward_addresses) ──────────────────────────────

function mintAddress(domain: string): { address: string; token: string } {
  const token = randomBytes(6).toString("hex"); // 12 hex chars — unguessable
  return { address: `rta-${token}@${domain}`, token };
}

/** The firm's active forwarding address, creating one on first use. */
export async function ensureForwardAddress(
  tx: Tx,
  tenantId: string
): Promise<{ address: string; token: string }> {
  const domain = await getInboundDomain();
  const [row] = await tx
    .select({ address: rtaForwardAddresses.address, token: rtaForwardAddresses.token })
    .from(rtaForwardAddresses)
    .where(and(eq(rtaForwardAddresses.tenantId, tenantId), eq(rtaForwardAddresses.isActive, true)))
    .limit(1);
  if (row) {
    // If the configured inbound domain changed, re-issue the address on the SAME
    // token so an already-set-up forward keeps its local-part where possible.
    const want = `rta-${row.token}@${domain}`;
    if (row.address.toLowerCase() !== want.toLowerCase()) {
      await tx
        .update(rtaForwardAddresses)
        .set({ address: want, updatedAt: new Date() })
        .where(and(eq(rtaForwardAddresses.tenantId, tenantId), eq(rtaForwardAddresses.token, row.token)));
      return { address: want, token: row.token };
    }
    return row;
  }
  const minted = mintAddress(domain);
  await tx.insert(rtaForwardAddresses).values({
    tenantId,
    address: minted.address,
    token: minted.token,
    isActive: true,
  } as any);
  return minted;
}

/** Rotate to a fresh address (e.g. the old one leaked / spam). Deactivates old. */
export async function regenerateForwardAddress(
  tx: Tx,
  tenantId: string
): Promise<{ address: string; token: string }> {
  const domain = await getInboundDomain();
  await tx
    .update(rtaForwardAddresses)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(rtaForwardAddresses.tenantId, tenantId), eq(rtaForwardAddresses.isActive, true)));
  const minted = mintAddress(domain);
  await tx.insert(rtaForwardAddresses).values({
    tenantId,
    address: minted.address,
    token: minted.token,
    isActive: true,
  } as any);
  return minted;
}

export type ForwardAddressRow = {
  id: string;
  tenantId: string;
  address: string;
  verifiedAt: Date | null;
  forwardingConfirmCode: string | null;
  forwardingConfirmUrl: string | null;
};

/**
 * Resolve an inbound recipient address → the owning tenant's active row.
 * Called from the poller in SYSTEM context (cross-tenant), so it selects across
 * all tenants — the caller is responsible for running inside withSystem().
 */
export async function resolveTenantByAddresses(
  tx: Tx,
  candidates: string[]
): Promise<ForwardAddressRow | null> {
  const lowered = [...new Set(candidates.map((c) => c.toLowerCase().trim()).filter(Boolean))];
  if (!lowered.length) return null;
  // IN (…) via sql.join — the array-binding idiom used elsewhere in the codebase
  // (src/lib/rta/process.ts), which avoids Postgres `= ANY($1)` array-type ambiguity.
  const rows = await tx
    .select({
      id: rtaForwardAddresses.id,
      tenantId: rtaForwardAddresses.tenantId,
      address: rtaForwardAddresses.address,
      verifiedAt: rtaForwardAddresses.verifiedAt,
      forwardingConfirmCode: rtaForwardAddresses.forwardingConfirmCode,
      forwardingConfirmUrl: rtaForwardAddresses.forwardingConfirmUrl,
    })
    .from(rtaForwardAddresses)
    .where(
      and(
        eq(rtaForwardAddresses.isActive, true),
        sql`lower(${rtaForwardAddresses.address}) IN (${sql.join(
          lowered.map((a) => sql`${a}`),
          sql`, `
        )})`
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * SECONDARY routing path — resolve a tenant from the mailbox that FORWARDED the
 * mail, for firms using the shared rta@<domain> address instead of their alias.
 *
 * Deliberately conservative, because a From header is spoofable in a way an
 * unguessable alias is not:
 *   • only consulted when the alias lookup already missed (see the poller);
 *   • an address registered by MORE THAN ONE firm resolves to NOTHING rather
 *     than a guess — misrouting a book into the wrong tenant is far worse than
 *     quarantining a message for a human to look at.
 *
 * System context (cross-tenant) — the caller must be inside withSystem().
 */
export async function resolveTenantBySenders(
  tx: Tx,
  candidates: string[]
): Promise<{ row: ForwardAddressRow | null; ambiguous: boolean }> {
  const lowered = [...new Set(candidates.map((c) => c.toLowerCase().trim()).filter(Boolean))];
  if (!lowered.length) return { row: null, ambiguous: false };

  // Match case-INSENSITIVELY on both sides.
  //
  // `setSourceAddresses` lowercases on write, so normal data is already
  // normalised — but a row seeded another way (migration, restore, direct
  // admin edit) can hold mixed case, and jsonb_exists_any is exact-match, so
  // such a row would silently never route. Email local-parts are technically
  // case-sensitive per RFC 5321 but universally treated otherwise in practice,
  // and registrar/forwarder headers vary in casing — so comparing lowered
  // values on both sides is both safer and more correct here.
  //
  // This gives up the GIN index (migration 0193) for a scan, which is fine:
  // rta_forward_addresses holds one row per FIRM, not per file.
  const rows = await tx
    .select({
      id: rtaForwardAddresses.id,
      tenantId: rtaForwardAddresses.tenantId,
      address: rtaForwardAddresses.address,
      verifiedAt: rtaForwardAddresses.verifiedAt,
      forwardingConfirmCode: rtaForwardAddresses.forwardingConfirmCode,
      forwardingConfirmUrl: rtaForwardAddresses.forwardingConfirmUrl,
    })
    .from(rtaForwardAddresses)
    .where(
      and(
        eq(rtaForwardAddresses.isActive, true),
        sql`EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(${rtaForwardAddresses.sourceAddresses}) AS s(addr)
          WHERE lower(s.addr) IN (${sql.join(
            lowered.map((a) => sql`${a}`),
            sql`, `
          )})
        )`
      )
    )
    .limit(2); // 2 is enough to detect ambiguity

  if (rows.length > 1) return { row: null, ambiguous: true };
  return { row: rows[0] ?? null, ambiguous: false };
}

/** Read the mailboxes a firm has registered as forwarding sources. */
export async function getSourceAddresses(tx: Tx, tenantId: string): Promise<string[]> {
  const rows = await tx
    .select({ sourceAddresses: rtaForwardAddresses.sourceAddresses })
    .from(rtaForwardAddresses)
    .where(and(eq(rtaForwardAddresses.tenantId, tenantId), eq(rtaForwardAddresses.isActive, true)))
    .limit(1);
  return rows[0]?.sourceAddresses ?? [];
}


/**
 * Attach any ALREADY-ARRIVED forwarding confirmation to a firm that has just
 * registered the mailbox it came from.
 *
 * Gmail's setup order is the opposite of ours: the operator types the forward
 * address into Gmail (which fires the confirmation immediately) and only then
 * comes back to register that mailbox here. So the confirmation reliably lands
 * BEFORE we know whose it is — it gets logged with no tenant, and the code/link
 * the firm needs is visible only to a platform admin digging through Inbound
 * Mail. Observed in production: VSN's confirmation arrived 11:41, the mailbox
 * was registered 12:10, and the firm's own card showed nothing.
 *
 * Rather than force firms into an unnatural order, we heal it: on registering a
 * mailbox, look back for an unattributed confirmation from that address, claim
 * it for this firm, and surface its code/link on their card.
 *
 * Scoped deliberately narrowly — only rows with NO tenant (never steal another
 * firm's), only `confirmation` outcomes, only the recent window (a stale link is
 * useless and re-sending is trivial), newest first.
 */
async function attachPendingConfirmations(
  tx: Tx,
  tenantId: string,
  addresses: string[]
): Promise<number> {
  if (!addresses.length) return 0;
  try {
    // Cross-tenant read: unattributed rows have tenant_id NULL, so an RLS-scoped
    // read inside withTenant() can never see them (the same trap that silently
    // disabled the duplicate-mailbox guard).
    const rows = await withSystem(async (systx) => {
      const r = await systx.execute(sql`
        SELECT id, body_snippet, subject
        FROM rta_inbound_messages
        WHERE tenant_id IS NULL
          AND outcome = 'confirmation'
          AND created_at > now() - interval '14 days'
        ORDER BY created_at DESC
        LIMIT 50`);
      return r.rows as Array<{ id: string; body_snippet: string | null; subject: string | null }>;
    });

    let attached = 0;
    for (const row of rows) {
      const blob = `${row.subject ?? ""}\n${row.body_snippet ?? ""}`.toLowerCase();
      // The requesting mailbox is named in Gmail's subject AND body; a plain
      // substring test is enough and avoids re-deriving the parse here.
      const match = addresses.find((a) => blob.includes(a.toLowerCase()));
      if (!match) continue;

      // Re-extract the code/link from the stored snippet, same rules the poller
      // uses: strip URLs before hunting for a numeric code (a support-article id
      // in a trailing link is not a confirmation code), and prefer Gmail's
      // /mail/vf- CONFIRM link over the /mail/uf- CANCEL link that sits beside it.
      const body = row.body_snippet ?? "";
      const deUrled = body.replace(/https?:\/\/\S+/gi, " ");
      const code =
        deUrled.match(/(?:confirmation\s+code|code)\D{0,20}(\d{6,10})/i)?.[1] ??
        deUrled.match(/\b(\d{6,10})\b/)?.[1] ??
        null;
      const url =
        body.match(/https?:\/\/\S*\/mail\/vf-\S+/i)?.[0]?.replace(/[)\].,;'">]+$/, "") ?? null;
      if (!code && !url) continue;

      const [addr] = await tx
        .select({ id: rtaForwardAddresses.id })
        .from(rtaForwardAddresses)
        .where(and(eq(rtaForwardAddresses.tenantId, tenantId), eq(rtaForwardAddresses.isActive, true)))
        .limit(1);
      if (!addr) break;

      await recordForwardingConfirmation(tx, addr.id, code, url);
      // Claim the log row so it stops showing as unattributed, and so a second
      // registration can't pick up the same confirmation again.
      await withSystem(async (systx) => {
        await systx.execute(sql`
          UPDATE rta_inbound_messages
          SET tenant_id = ${tenantId}::uuid,
              reason = ${`Matched to this firm when ${match} was registered.`}
          WHERE id = ${row.id}::uuid AND tenant_id IS NULL`);
      });
      attached++;
      break; // newest matching confirmation is the live one
    }
    return attached;
  } catch {
    // Never let this block the registration itself — the firm can always
    // re-send the confirmation from Gmail if we failed to recover the old one.
    return 0;
  }
}
/**
 * Replace the firm's registered forwarding mailboxes.
 *
 * Rejects an address already claimed by ANOTHER firm — catching the collision at
 * registration gives a clear error, instead of silently producing mail that can
 * never route (resolveTenantBySenders would see it as ambiguous forever).
 */
/**
 * Mailboxes that must NEVER be accepted as a firm's identity.
 *
 * Under the shared rta@ address the sending mailbox is the only thing that says
 * whose mail this is. These addresses appear as the sender/recipient on EVERY
 * firm's mailback — they belong to the registrars, to no-reply infrastructure,
 * or to this platform itself. Registering one would make that firm match every
 * other firm's forwarded mail, silently importing another firm's client book.
 *
 * The duplicate-mailbox guard below cannot catch this: the address is claimed
 * only once, so it looks perfectly legitimate.
 */
function isNeverASource(addr: string): boolean {
  const [local = "", domain = ""] = addr.toLowerCase().split("@");
  if (/^(donotreply|do-not-reply|noreply|no-reply|no_reply|mailer-daemon|postmaster|distributorcare|admin|support)$/.test(local)) {
    return true;
  }
  // Registrar domains, and this platform's own inbound domain.
  if (/(^|\.)(camsonline\.com|camsonline\.co\.in|kfintech\.com|kfintech\.co\.in|karvy\.com|crm\.ssit\.com)$/.test(domain)) {
    return true;
  }
  return false;
}

export async function setSourceAddresses(
  tx: Tx,
  tenantId: string,
  addresses: string[]
): Promise<{ saved: string[]; rejected: string[]; blocked: string[]; confirmationsAttached: number }> {
  const all = [
    ...new Set(
      addresses
        .map((a) => a.toLowerCase().trim())
        .filter((a) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(a))
    ),
  ].slice(0, 10);

  // Drop registrar / no-reply addresses BEFORE the duplicate check — they are
  // invalid regardless of who else has (or hasn't) claimed them.
  const blocked = all.filter(isNeverASource);
  const clean = all.filter((a) => !blocked.includes(a));

  const rejected: string[] = [];
  if (clean.length) {
    // MUST run cross-tenant. This function is called inside withTenant(), where
    // RLS scopes every read to the caller's own tenant — so a "is this mailbox
    // already claimed by a DIFFERENT tenant?" query run in that context can
    // never see the row it is looking for, and the guard silently passed every
    // time. That matters most under the shared rta@ address, where the sending
    // mailbox is the ONLY thing identifying a firm: two firms registering the
    // same mailbox makes their mail permanently ambiguous.
    //
    // withSystem() is the established cross-tenant escape hatch (same one the
    // poller uses to route inbound mail at all). It reads ONLY the tenant_id +
    // source_addresses it needs to answer "already taken?" — no client data.
    const claimed = new Set<string>();
    try {
      await withSystem(async (systx) => {
        // Case-insensitive, matching resolveTenantBySenders — otherwise a
        // mailbox stored as "Ops@x.com" would pass this guard yet still collide
        // at routing time, which is the worst of both worlds.
        const taken = await systx.execute(sql`
          SELECT source_addresses
          FROM rta_forward_addresses
          WHERE is_active
            AND tenant_id <> ${tenantId}::uuid
            AND EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(source_addresses) AS s(addr)
              WHERE lower(s.addr) IN (${sql.join(
                clean.map((a) => sql`${a}`),
                sql`, `
              )})
            )`);
        for (const row of taken.rows as any[]) {
          for (const a of row.source_addresses ?? []) claimed.add(String(a).toLowerCase());
        }
      });
    } catch (err) {
      // withSystem needs ALLOW_SYSTEM_TX=1. If it is unavailable we must NOT
      // silently accept a possibly-colliding mailbox — resolveTenantBySenders
      // would then refuse to route BOTH firms' mail with no explanation. Fail
      // the save loudly instead; a clear error beats silent breakage later.
      throw new Error(
        `Could not verify this mailbox isn't already registered by another firm: ${
          (err as Error)?.message ?? "cross-tenant check unavailable"
        }`
      );
    }
    for (const a of clean) if (claimed.has(a)) rejected.push(a);
  }

  const saved = clean.filter((a) => !rejected.includes(a));
  await tx
    .update(rtaForwardAddresses)
    .set({ sourceAddresses: saved, updatedAt: new Date() })
    .where(and(eq(rtaForwardAddresses.tenantId, tenantId), eq(rtaForwardAddresses.isActive, true)));

  // Gmail fires its confirmation the moment the address is typed there, which is
  // almost always BEFORE the firm comes here to register the mailbox — so the
  // confirmation usually lands unattributed. Claim it now that we know whose it
  // is, so the code/link appears on this firm's own card instead of only in the
  // platform admin log.
  const confirmationsAttached = await attachPendingConfirmations(tx, tenantId, saved);
  return { saved, rejected, blocked, confirmationsAttached };
}

/** Stamp a successful receipt — proves the forwarding rule is live end-to-end. */
export async function stampReceived(tx: Tx, id: string): Promise<void> {
  await tx
    .update(rtaForwardAddresses)
    .set({ lastReceivedAt: new Date(), verifiedAt: sql`COALESCE(${rtaForwardAddresses.verifiedAt}, now())`, updatedAt: new Date() })
    .where(eq(rtaForwardAddresses.id, id));
}

/** Persist an auto-captured Gmail/Outlook forwarding confirmation code/link. */
export async function recordForwardingConfirmation(
  tx: Tx,
  id: string,
  code: string | null,
  url: string | null
): Promise<void> {
  await tx
    .update(rtaForwardAddresses)
    .set({
      forwardingConfirmCode: code,
      forwardingConfirmUrl: url,
      forwardingConfirmAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(rtaForwardAddresses.id, id));
}
