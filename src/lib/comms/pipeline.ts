/**
 * Unified send pipeline. Called by workflow actions, campaign dispatchers,
 * and manual UI send actions. Routes through:
 *   0. Idempotency — short-circuit a retried workflow step (no double-send)
 *   1. Template + version resolution
 *   2. Variable / token rendering
 *   3. Consent check
 *   4. (WhatsApp only) session window check
 *   5. Compliance gate
 *   5b. Rate limit — per-tenant × channel token bucket (auth/OTP exempt)
 *   5c. Monthly plan quota — per-tenant billing-period message cap (auth/OTP exempt)
 *   6. Insert communications row with full audit snapshot (status='queued')
 *   7. Channel adapter dispatch (Resend gets a stable idempotency key)
 *   8. Stamp external id + status
 *
 * Every step is observable — the resulting communications row carries the
 * consent + compliance snapshot at send time, immutable forever.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import type { Tx } from "@/db/client";
import {
  communications,
  consents,
  emailSuppressions,
  templateVersions,
  templates,
  dltTemplates,
  type Consent,
  type Template,
  type TemplateVersion,
} from "@/db/schema";
import { runComplianceChecks, missingMandatoryLines, type ComplianceResult } from "./compliance";
import { resolveTokens, renderTemplateText, type VariableDef } from "./tokens";
import { whatsappAdapter, whatsappProviderId } from "./adapters/whatsapp";
import { emailAdapter } from "./adapters/resend";
import { smsAdapter } from "./adapters/msg91";
import { getTenantIntegration } from "./integrations";
import { resolveEmailSender } from "./sender";
import { consumeRateLimit } from "./rate-limit";
import { checkMonthlyQuota } from "./usage";


export type DispatchChannel = "whatsapp" | "email" | "sms";

export interface DispatchInput {
  tenantId: string;
  channel: DispatchChannel;
  /** Required for template sends. Omitted for a free-form WhatsApp reply. */
  templateKey?: string;
  /** Free-form WhatsApp text (no template). Only valid inside the 24h session
   *  window; still runs consent + session + the compliance gate (no bypass). */
  freeformText?: string;
  recipient: string;
  variables: Record<string, unknown>;
  category: "transactional" | "utility" | "marketing" | "authentication";
  investorId?: string;
  leadId?: string;
  workflowRunId?: string;
  workflowRunStepId?: string;
  /** Stable dedupe key for provider-level idempotency. Unlike workflowRunStepId
   *  (regenerated on every step retry), this stays constant across retries of the
   *  same logical send (e.g. `wf:<runId>:<nodeId>`), so a retried workflow step
   *  re-sends the SAME key and the channel provider (Resend / Vartify / MSG91)
   *  dedupes it instead of delivering twice. */
  idempotencyKey?: string;
  campaignId?: string;
  /** A/B variant this send belongs to ('a' | 'b') — campaign sends only. */
  variant?: "a" | "b";
  meta?: Record<string, unknown>;
  /** Allow caller to override the locale */
  locale?: string;
  /** Bypass consent check — only allowed for AUTHENTICATION/OTP category */
  bypassConsent?: boolean;
  /** Sending RM — when set, email prefers that user's personal mailbox. */
  actorUserId?: string;
  /**
   * Let the send fall back to the firm mailbox when the actor has none.
   *
   * Interactive sends must NOT set this: a person pressing Send is told to
   * connect their mailbox rather than having their name replaced by the firm's.
   * Automations MUST set it — a rule firing at 2am with no one watching should
   * still deliver, and failing the whole run because one RM never connected a
   * mailbox is a worse outcome than sending as the firm.
   */
  allowFirmFallback?: boolean;
}

export interface DispatchResult {
  communicationId: string;
  status: "sent" | "queued" | "skipped";
  externalId?: string;
  skipped?: { reason: string; findings?: ComplianceResult["findings"] };
}

export async function dispatch(tx: Tx, input: DispatchInput): Promise<DispatchResult> {
  const communicationId = uuid();

  // -----------------------------------------------------------
  // 0. Idempotency — a retried workflow step must not double-send.
  // If a prior attempt for this (tenant, workflowRunStepId) already produced an
  // in-flight or successful communication, return it instead of sending again.
  // -----------------------------------------------------------
  if (input.workflowRunStepId) {
    const [existing] = await tx
      .select()
      .from(communications)
      .where(
        and(
          eq(communications.tenantId, input.tenantId),
          eq(communications.workflowRunStepId, input.workflowRunStepId)
        )
      )
      .limit(1);
    if (existing && ["queued", "sent", "delivered", "read", "replied", "scheduled"].includes(existing.status)) {
      return {
        communicationId: existing.id,
        status: existing.status === "queued" ? "queued" : "sent",
        externalId: existing.externalId ?? undefined,
      };
    }
  }

  // -----------------------------------------------------------
  // 1 + 2. Resolve template + render  (free-form path skips the template)
  // -----------------------------------------------------------
  const tenantRow = await loadTenant(tx, input.tenantId);
  // A LEAD send must load the lead too. dispatch() accepted input.leadId but only
  // ever loaded an investor, so on every lead send the subject was null and each
  // {{lead.*}} merge field rendered blank — "Dear ," with the name missing.
  const subject = input.investorId
    ? await loadInvestor(tx, input.investorId)
    : input.leadId
      ? await loadLead(tx, input.leadId)
      : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let version: any;
  let rendered: { text: string; subject?: string; tokens: Record<string, string> };
  // The template's own category is authoritative for the compliance ruleset
  // (templates.category: "category drives compliance ruleset"). Captured here so
  // a transactional/utility template (welcome, onboarding, confirmations) is
  // never hard-blocked by marketing-only rules, even if the calling rule passed
  // category: "marketing".
  let templateCategory: DispatchInput["category"] | undefined;

  if (input.freeformText != null && input.channel === "whatsapp") {
    // Free-form in-session reply — no template. The synthesized version carries
    // the plain text for the adapter (buildVartifySendBody sends body.text when no
    // template name is present). Consent + session + compliance still run below.
    version = { id: null, body: { text: input.freeformText }, variables: [] };
    rendered = { text: input.freeformText, tokens: {} };
  } else {
    if (!input.templateKey) {
      throw new Error("dispatch: templateKey is required for a template send");
    }
    const [tmpl] = await tx
      .select()
      .from(templates)
      .where(
        and(
          eq(templates.tenantId, input.tenantId),
          eq(templates.key, input.templateKey),
          eq(templates.channel, input.channel),
          eq(templates.locale, input.locale ?? "en-IN")
        )
      );
    if (!tmpl) {
      throw new Error(`Template '${input.templateKey}' (${input.channel}) not found`);
    }
    templateCategory = tmpl.category as DispatchInput["category"];
    if (tmpl.status !== "approved") {
      // Email transactional/utility templates have no external approval body
      // (unlike WhatsApp→Meta or SMS→DLT), and the 11-rule compliance gate runs
      // on every send regardless — so let the firm's own non-marketing email go
      // out even as a draft. Marketing email + all WhatsApp/SMS still require an
      // approved template.
      const needsApproval = input.channel !== "email" || (templateCategory ?? input.category) === "marketing";
      if (needsApproval) {
        return await skip(tx, communicationId, input, "template_not_approved");
      }
    }
    if (!tmpl.currentVersionId) {
      throw new Error(`Template '${input.templateKey}' has no current version`);
    }
    const [v] = await tx
      .select()
      .from(templateVersions)
      .where(eq(templateVersions.id, tmpl.currentVersionId));
    if (!v) {
      throw new Error("Template version missing");
    }
    version = v;
    try {
      const tokens = resolveTokens(version.variables as VariableDef[], {
        tenant: tenantRow,
        subject,
        context: input.meta,
        overrides: input.variables as Record<string, any>,
      });
      // Firm-branding tokens the designer email renderer reads to draw the logo +
      // auto-footer (ARN / address / firm name). These aren't template variables,
      // so they must be injected from the tenant record here.
      const t = tenantRow as any;
      const addr = t?.address;
      // Email clients (Gmail/Outlook) can't load a relative logo path — make it
      // absolute against the app's public URL.
      const appBase = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
      const rawLogo = String(t?.logoUrl ?? "");
      const absLogo = rawLogo && !/^https?:\/\//i.test(rawLogo)
        ? `${appBase}${rawLogo.startsWith("/") ? "" : "/"}${rawLogo}`
        : rawLogo;
      Object.assign(tokens, {
        tenant_logo_url: absLogo,
        logo_url: absLogo,
        tenant_name: t?.legalName ?? "",
        tenant_display_name: t?.displayName ?? "",
        tenant_arn: t?.arn ?? "",
        euin: t?.principalEuin ?? "",
        firm_website: t?.website ?? "",
        brand_color: t?.primaryColor ?? "",
        firm_address: addr
          ? [addr.line1, addr.line2, addr.city, addr.state, addr.pincode].filter(Boolean).join(", ")
          : "",
      });

      // Apply caller-supplied variable values (the compose-modal "Fill in the
      // details" form) for EVERY provided key — including merge fields that live
      // only in the body (e.g. {{transaction.amount}} inside a data_table) and so
      // are NOT in the declared `variables` array. resolveTokens above only loops
      // declared variables, so without this an undeclared field the RM typed would
      // be silently dropped and render blank. The RM typed these → highest
      // priority (they also pre-empt the auto-fill below).
      if (input.variables && typeof input.variables === "object") {
        for (const [k, val] of Object.entries(input.variables as Record<string, unknown>)) {
          if (val != null && String(val).trim() !== "") (tokens as any)[k] = String(val);
        }
      }

      // Auto-fill transaction.* from the investor's MOST RECENT transaction so
      // transaction templates (SIP Confirmed, redemption, etc.) carry real
      // scheme / amount / folio / date on a manual ad-hoc send — where no
      // workflow supplied a transaction context. A caller-provided transaction
      // (input.meta.transaction, e.g. from the transaction.successful workflow)
      // and any already-resolved value WIN; this only fills the blanks. Wrapped
      // so a query hiccup never blocks the send.
      try {
        const bodyStr = JSON.stringify((version as any).body ?? {});
        const wantsTxn = bodyStr.includes("transaction.");
        // A template that references a rejection reason should pull from the
        // sip_rejections table, not a generic transaction.
        const preferRejection = bodyStr.includes("rejection_reason") || bodyStr.includes("transaction.reason");
        const callerTxn = (input.meta as any)?.transaction;
        if (wantsTxn && input.investorId && !callerTxn) {
          const auto = await loadTransactionTokens(tx, input.tenantId, input.investorId, preferRejection);
          for (const [k, val] of Object.entries(auto)) {
            if (val && !(tokens as any)[k]) (tokens as any)[k] = val;
          }
        }
      } catch (e) {
        console.warn("[comms] transaction auto-fill skipped:", (e as Error)?.message);
      }

      rendered = renderBody(input.channel, version, tokens);
    } catch (err) {
      return await skip(
        tx,
        communicationId,
        input,
        "render_error",
        `Variable resolution failed: ${(err as Error).message}`
      );
    }
  }

  // -----------------------------------------------------------
  // 3. Consent check
  // -----------------------------------------------------------
  // Free-form WhatsApp replies are customer-initiated (the 24h window only opens
  // when the client messaged us — enforced in step 4), so the open session IS the
  // consent. The compliance gate (step 5) still runs fully. Templates still
  // require explicit consent.
  let consentSnapshot: Consent | null = null;
  if (input.investorId && !input.bypassConsent && !input.freeformText && input.category !== "authentication") {
    const scope = input.category === "marketing" ? "marketing" : "transactional";
    const consentRow = await getConsent(tx, input.tenantId, input.investorId, input.channel, scope);
    // Consent gate relaxed per firm preference: messages send by DEFAULT (no
    // explicit opt-in required for any category). The ONLY block is an explicit
    // opt-out (revoked) — we must never message a client who said "stop", both to
    // respect their choice and to keep the WhatsApp number from being banned by
    // Meta for messaging opted-out users. The full compliance gate (step 5) still
    // runs on every send.
    if (consentRow && consentRow.status === "revoked") {
      return await skip(tx, communicationId, input, "skipped_consent", "client has opted out");
    }
    consentSnapshot = consentRow;
  }

  // -----------------------------------------------------------
  // 3a. Marketing frequency cap (anti-fatigue / WhatsApp-ban protection).
  // Skip a marketing send to a subject who has already received the tenant's
  // configured number of marketing (campaign) messages within the trailing
  // window. Campaign sends are the marketing channel — we proxy "marketing
  // volume" by counting prior campaign-stamped sends to this subject. NULL/0
  // cap disables the gate. Auth/OTP + non-marketing sends are exempt.
  // -----------------------------------------------------------
  if (input.category === "marketing" && input.investorId && input.campaignId) {
    const cap = Number((tenantRow as any)?.marketingFreqCap ?? 0);
    const windowDays = Number((tenantRow as any)?.marketingFreqWindowDays ?? 7) || 7;
    if (cap > 0) {
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(communications)
        .where(
          and(
            eq(communications.tenantId, input.tenantId),
            eq(communications.investorId, input.investorId),
            eq(communications.direction, "outbound"),
            sql`${communications.campaignId} IS NOT NULL`,
            inArray(communications.status, ["sent", "delivered", "read", "replied"]),
            sql`${communications.createdAt} >= now() - ${`${windowDays} days`}::interval`
          )
        );
      if (Number(n ?? 0) >= cap) {
        return await skip(
          tx,
          communicationId,
          input,
          "skipped_frequency_cap",
          `marketing frequency cap reached (${n}/${cap} in ${windowDays}d)`
        );
      }
    }
  }

  // -----------------------------------------------------------
  // 3b. Email suppression — never send to a hard-bounced / unsubscribed address.
  // -----------------------------------------------------------
  if (input.channel === "email") {
    const [supp] = await tx
      .select({ reason: emailSuppressions.reason })
      .from(emailSuppressions)
      .where(and(eq(emailSuppressions.tenantId, input.tenantId), sql`lower(${emailSuppressions.email}) = ${input.recipient.toLowerCase()}`))
      .limit(1);
    if (supp) {
      return await skip(tx, communicationId, input, "skipped_no_contact", `address suppressed (${supp.reason})`);
    }
  }

  // -----------------------------------------------------------
  // 4. WhatsApp session window
  // -----------------------------------------------------------
  let sessionActive = false;
  if (input.channel === "whatsapp" && (input.investorId || input.leadId)) {
    sessionActive = await hasActiveWhatsappSession(tx, input.tenantId, {
      investorId: input.investorId,
      leadId: input.leadId,
    });
  }
  // Free-form (non-template) replies are only permitted INSIDE the 24h window.
  if (input.freeformText != null && !sessionActive) {
    return await skip(
      tx,
      communicationId,
      input,
      "skipped_session",
      "WhatsApp 24h window is closed — send an approved template to reopen the conversation."
    );
  }

  // -----------------------------------------------------------
  // 5. Compliance gate
  // -----------------------------------------------------------
  let dltContent: string | undefined = undefined;
  if (input.channel === "sms") {
    const dltId = extractDltId(version);
    if (dltId) {
      const [dltRow] = await tx
        .select()
        .from(dltTemplates)
        .where(
          and(
            eq(dltTemplates.tenantId, input.tenantId),
            eq(dltTemplates.dltTemplateId, dltId),
            eq(dltTemplates.isActive, true)
          )
        );
      if (dltRow) {
        dltContent = dltRow.content;
      }
    }
  }

  // Email sends ALWAYS carry a non-removable footer (ComplianceFooter in
  // email_renderer / the designer renderer) with the firm name, ARN and the
  // AMFI risk disclaimer. The gate scans `rendered.text` (the template BODY),
  // which doesn't include that footer — so a body without those lines was being
  // falsely blocked even though the recipient would receive them. For email,
  // evaluate against body + the mandatory footer lines the renderer guarantees.
  // This reflects the real sent content; it is NOT a bypass (WhatsApp free-form
  // and SMS have no auto-footer, so they stay fully gated on the body).
  // Effective compliance class — the template's declared category wins over the
  // caller's hint (a welcome/onboarding template stays transactional even if a
  // rule passed "marketing", so it's never a hard block).
  const complianceCategory = templateCategory ?? input.category;

  let complianceText = rendered.text;
  if (input.channel === "email") {
    const footerLines = missingMandatoryLines({
      category: complianceCategory,
      text: rendered.text,
      tenant: { legalName: tenantRow?.legalName, arn: tenantRow?.arn },
    });
    if (footerLines.length) complianceText = `${rendered.text}\n\n${footerLines.join("\n")}`;
  }

  const compliance = runComplianceChecks({
    channel: input.channel,
    category: complianceCategory,
    tenant: {
      legalName: tenantRow?.legalName,
      arn: tenantRow?.arn ?? undefined,
      principalEuin: tenantRow?.principalEuin ?? undefined,
      riaRegistered: tenantRow?.riaRegistered ?? false,
    },
    text: complianceText,
    subject: rendered.subject,
    dltTemplateId: input.channel === "sms" ? extractDltId(version) : undefined,
    dltTemplateContent: dltContent,
    whatsappSessionActive: sessionActive,
    hasMarketingConsent: complianceCategory === "marketing" ? !!consentSnapshot : true,
    amcApprovalRef: (version.body as any)?.amcApprovalRef,
  });

  // WhatsApp TEMPLATE sends are pre-vetted by Meta before they can be sent at all,
  // so the firm's content rules (AMFI disclaimer / ARN / scheme-specific) would
  // just re-block an already-approved template. Record the findings for audit, but
  // don't block. Email / SMS / free-form WhatsApp are still fully gated.
  const isWhatsappTemplate = input.channel === "whatsapp" && !input.freeformText;
  if (compliance.blocked && !isWhatsappTemplate) {
    return await skip(tx, communicationId, input, "skipped_compliance", JSON.stringify(compliance.findings), compliance);
  }

  // -----------------------------------------------------------
  // 5b. Rate limit — cap pathological per-tenant bursts (runaway loops,
  // misconfigured fan-out). Authentication/OTP is exempt inside the limiter.
  // -----------------------------------------------------------
  const rl = consumeRateLimit(input.tenantId, input.channel, input.category);
  if (!rl.allowed) {
    return await skip(
      tx,
      communicationId,
      input,
      "skipped_rate_limit",
      `rate limit exceeded for ${input.channel} (${rl.limitPerMin}/min per tenant)`
    );
  }

  // -----------------------------------------------------------
  // 5c. Monthly plan quota — bound a tenant's total billable channel spend
  // over the billing period (the rate limiter only caps per-minute bursts).
  // Unlimited / unconfigured plans short-circuit; auth/OTP is exempt.
  // -----------------------------------------------------------
  const quota = await checkMonthlyQuota(tx, input.tenantId, input.category);
  if (!quota.allowed) {
    return await skip(
      tx,
      communicationId,
      input,
      "skipped_quota",
      `monthly message allowance reached (${quota.used}/${quota.cap}) — upgrade the plan to send more`
    );
  }

  // -----------------------------------------------------------
  // 6. Pre-insert communications row (status='queued') for audit
  // -----------------------------------------------------------
  await tx.insert(communications).values({
    id: communicationId,
    tenantId: input.tenantId,
    investorId: input.investorId,
    leadId: input.leadId,
    channel: input.channel,
    direction: "outbound",
    templateVersionId: version.id,
    templateKey: input.templateKey,
    status: "queued",
    payload: {
      rendered,
      variables: rendered.tokens,
      meta: input.meta,
    } as any,
    workflowRunId: input.workflowRunId,
    workflowRunStepId: input.workflowRunStepId,
    campaignId: input.campaignId,
    variant: input.variant,
    consentSnapshot: consentSnapshot as any,
    complianceSnapshot: compliance.findings as any,
    complianceScore: String(compliance.score) as any,
    queuedAt: new Date(),
  });

  // -----------------------------------------------------------
  // 7. Channel dispatch (adapter)
  // -----------------------------------------------------------
  try {
    let adapterResult: { externalId: string; status: "sent" | "queued" };
    if (input.channel === "whatsapp") {
      // Provider chosen centrally (see adapters/whatsapp.ts); credentials are
      // per-tenant (saved once in Settings → Integrations). Vartify only needs
      // an API token; the endpoint defaults to the platform URL.
      const integration = await getTenantIntegration(tx, input.tenantId, whatsappProviderId);
      // Name shown as the sender in the provider's inbox, so a reply lands on a
      // person rather than "automation". Best-effort: an unattributed send
      // (workflow / campaign) simply has no actor.
      let sentByName: string | undefined;
      if (input.actorUserId) {
        const r = await tx.execute(
          sql`SELECT name FROM users WHERE id = ${input.actorUserId}::uuid LIMIT 1`
        );
        sentByName = ((r.rows[0] as any)?.name as string | undefined) ?? undefined;
      }
      adapterResult = await whatsappAdapter.send({
        sentByName,
        tenantId: input.tenantId,
        templateVersion: version,
        tokens: rendered.tokens,
        renderedText: rendered.text,
        recipient: input.recipient,
        // The tenant's saved token. Without this the adapter fell through to
        // process.env.VARTIFY_API_TOKEN — unset on a per-tenant-credential
        // deployment — and every send failed with "WhatsApp isn't connected",
        // even though the integration row existed, showed CONNECTED and could
        // fetch templates (both of those read config.apiKey directly).
        apiKey: integration?.config?.apiKey,
        webhookUrl: integration?.config?.webhookUrl,
        defaultLanguage: integration?.config?.defaultLanguage,
        // Stable across step retries → adapter can dedupe a re-fired send.
        idempotencyKey: input.idempotencyKey ?? input.workflowRunStepId ?? communicationId,
      });
    } else if (input.channel === "email") {
      // One resolver decides the sender: the acting RM's own mailbox → the firm
      // mailbox (SMTP / OAuth) → Resend with the firm's sender identity. OAuth
      // mailboxes get a freshly-minted access token inside resolveEmailSender.
      const sender = await resolveEmailSender(tx, input.tenantId, input.actorUserId, {
        allowFirmFallback: input.allowFirmFallback,
      });
      adapterResult = await emailAdapter.send({
        tenantId: input.tenantId,
        templateVersion: version,
        tokens: rendered.tokens,
        rendered,
        recipient: input.recipient,
        category: input.category as any,
        cc: (input.meta?.cc as string[]) ?? [],
        bcc: (input.meta?.bcc as string[]) ?? [],
        smtp: sender.smtp,
        // From: explicit sender email, else the mailbox login address.
        fromOverride: sender.fromEmail ?? (sender.smtp ? sender.smtp.user : undefined),
        fromNameOverride: sender.fromName,
        // Client replies route to the MFD's own inbox.
        replyTo: sender.replyTo,
        // Stable across step retries → Resend dedupes a re-fired send.
        idempotencyKey: input.idempotencyKey ?? input.workflowRunStepId ?? communicationId,
        // Campaign emails get link-level click tracking keyed by this comm row.
        trackingId: input.campaignId ? communicationId : undefined,
      });
    } else {
      const integration = await getTenantIntegration(tx, input.tenantId, "msg91");
      adapterResult = await smsAdapter.send({
        tenantId: input.tenantId,
        templateVersion: version,
        tokens: rendered.tokens,
        rendered,
        recipient: input.recipient,
        senderId: integration?.senderConfig?.senderId,
        idempotencyKey: input.idempotencyKey ?? input.workflowRunStepId ?? communicationId,
      });
    }
    await tx
      .update(communications)
      .set({
        externalId: adapterResult.externalId,
        status: adapterResult.status,
        sentAt: new Date(),
      })
      .where(eq(communications.id, communicationId));

    return {
      communicationId,
      status: adapterResult.status,
      externalId: adapterResult.externalId,
    };
  } catch (err) {
    await tx
      .update(communications)
      .set({
        status: "failed",
        statusReason: (err as Error).message,
        failedAt: new Date(),
      })
      .where(eq(communications.id, communicationId));
    throw err;
  }
}

async function skip(
  tx: Tx,
  id: string,
  input: DispatchInput,
  reason:
    | "skipped_consent"
    | "skipped_compliance"
    | "skipped_session"
    | "skipped_rate_limit"
    | "skipped_quota"
    | "skipped_frequency_cap"
    | "skipped_no_contact"
    | "template_not_approved"
    | "render_error",
  detail?: string,
  compliance?: ComplianceResult
): Promise<DispatchResult> {
  await tx.insert(communications).values({
    id,
    tenantId: input.tenantId,
    investorId: input.investorId,
    leadId: input.leadId,
    channel: input.channel,
    direction: "outbound",
    templateKey: input.templateKey,
    status: reason.startsWith("skipped_") ? (reason as any) : "failed",
    statusReason: detail ?? reason,
    complianceSnapshot: compliance?.findings as any,
    workflowRunId: input.workflowRunId,
    workflowRunStepId: input.workflowRunStepId,
    campaignId: input.campaignId,
    variant: input.variant,
  });
  return { communicationId: id, status: "skipped", skipped: { reason, findings: compliance?.findings } };
}

function renderBody(
  channel: DispatchChannel,
  version: TemplateVersion,
  tokens: Record<string, string>
) {
  const body = version.body as any;
  if (channel === "whatsapp") {
    const headerText = body.header?.text ?? "";
    const footerText = body.footer?.text ?? "";
    const bodyText = body.body?.text ?? "";
    const text = [headerText, bodyText, footerText].filter(Boolean).map((t) => renderTemplateText(t, tokens)).join("\n\n");
    return { text, tokens };
  }
  if (channel === "email") {
    // New designer-mode body — extract text via the new renderer's helper so
    // the plain-text fallback covers raw HTML mode + new block types.
    if (body?.mode === "designer" || body?.mode === "html") {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { renderEmailText } = require("@/lib/email-designer/render") as typeof import("@/lib/email-designer/render");
      const text = renderEmailText(body, { variables: unflattenForText(tokens) });
      return {
        subject: renderTemplateText(body.subject ?? "", tokens),
        text: renderTemplateText(text, tokens),
        tokens,
      };
    }
    return {
      subject: renderTemplateText(body.subject ?? "", tokens),
      text: renderTemplateText(body.textFallback ?? extractTextFromBlocks(body), tokens),
      tokens,
    };
  }
  if (channel === "sms") {
    return { text: renderTemplateText(body.text ?? "", tokens), tokens };
  }
  return { text: "", tokens };
}

function extractTextFromBlocks(body: any): string {
  if (!body?.blocks) return "";
  return body.blocks
    .map((b: any) => {
      if (b.type === "text") return b.content ?? "";
      if (b.type === "header") return b.title ?? "";
      if (b.type === "button") return b.label ?? "";
      return "";
    })
    .join("\n\n");
}

function unflattenForText(tokens: Record<string, string>): Record<string, unknown> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(tokens ?? {})) {
    if (!k.includes("_")) {
      out[k] = v;
      continue;
    }
    const idx = k.indexOf("_");
    const ns = k.slice(0, idx);
    const rest = k.slice(idx + 1);
    out[ns] ??= {};
    out[ns][rest] = v;
    out[k] = v;
  }
  return out;
}

function extractDltId(version: TemplateVersion): string | undefined {
  const body = version.body as any;
  return body?.dltTemplateId;
}

// ---------------------------------------------------------------------------
// Small helpers — local imports kept off the hot path
// ---------------------------------------------------------------------------

export async function loadTenant(tx: Tx, tenantId: string) {
  const { tenants } = await import("@/db/schema");
  const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
  return t;
}
async function loadInvestor(tx: Tx, id: string) {
  const { investors, users } = await import("@/db/schema");
  const [i] = await tx.select().from(investors).where(eq(investors.id, id));
  if (!i) return null;
  // Enrich with the computed merge tokens templates use but that aren't columns:
  // investor.first_name (first word of name) and the RM's own contact details —
  // rm_name / rm_email / rm_mobile — which live on the users row, not here.
  const enriched: any = { ...i };
  enriched.first_name = String((i as any).name ?? "").trim().split(/\s+/)[0] ?? "";
  if ((i as any).rmId) {
    const [rm] = await tx
      .select({ name: users.name, email: users.email, phone: users.phone })
      .from(users)
      .where(eq(users.id, (i as any).rmId));
    enriched.rm_name = rm?.name ?? "";
    enriched.rm_email = rm?.email ?? "";
    enriched.rm_mobile = rm?.phone ?? "";
  } else {
    enriched.rm_name = "";
    enriched.rm_email = "";
    enriched.rm_mobile = "";
  }
  return enriched;
}
/**
 * Lead counterpart to loadInvestor. Enriched with the merge tokens templates
 * offer but that are not columns, matching loadSubject() in the workflow runner
 * so a manual send and an automated one resolve identically:
 *   lead.rm_name     owning RM's NAME (the row carries only owner_id, a uuid)
 *   lead.rm_email    owning RM's own email address
 *   lead.rm_mobile   owning RM's own mobile number
 *   lead.event_name  readable alias for source_campaign (the Event source)
 *   lead.first_name  first word, for "Hi Anita" greetings
 */
async function loadLead(tx: Tx, id: string) {
  const { leads, users } = await import("@/db/schema");
  const [l] = await tx.select().from(leads).where(eq(leads.id, id));
  if (!l) return null;
  const enriched: any = { ...l };
  enriched.first_name = String((l as any).name ?? "").trim().split(/\s+/)[0] ?? "";
  enriched.event_name = (l as any).sourceCampaign ?? "";
  if ((l as any).ownerId) {
    const [rm] = await tx
      .select({ name: users.name, email: users.email, phone: users.phone })
      .from(users)
      .where(eq(users.id, (l as any).ownerId));
    enriched.rm_name = rm?.name ?? "";
    enriched.rm_email = rm?.email ?? "";
    enriched.rm_mobile = rm?.phone ?? "";
  } else {
    enriched.rm_name = "";
    enriched.rm_email = "";
    enriched.rm_mobile = "";
  }
  return enriched;
}

// Format a numeric amount the Indian way (no ₹ — templates add it). Blank if null.
function fmtAmount(a: unknown): string {
  return a != null && String(a).trim() !== "" ? Number(a).toLocaleString("en-IN") : "";
}
// Format a `date`-column value ("YYYY-MM-DD") to "08 Jun 2026". Blank if null.
function fmtDate(d: unknown): string {
  if (!d) return "";
  const dd = new Date(`${String(d)}T00:00:00`);
  return isNaN(dd.getTime())
    ? String(d)
    : dd.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Pre-formatted `transaction.*` merge tokens auto-loaded from the investor's
 * REAL data, so transaction templates (SIP rejection, SIP confirmed, redemption,
 * statement…) send with actual scheme / amount / folio / date / reason on a
 * manual send — no manual typing. Returns ready-to-substitute strings keyed by
 * dotted token (they drop straight into the renderer).
 *
 * Source priority:
 *   1. When the template needs a rejection reason → the latest `sip_rejections`
 *      row (its own table — scheme/amount/folio/reason/date).
 *   2. Else the most recent executed `transactions` row.
 *   3. Else the latest `sips` registration (natural source for "SIP Confirmed").
 * Empty object when the client has no such record (rows render blank — the
 * honest result; nothing to invent).
 */
async function loadTransactionTokens(
  tx: Tx,
  tenantId: string,
  investorId: string,
  preferRejection: boolean
): Promise<Record<string, string>> {
  const { transactions, sips, sipRejections } = await import("@/db/schema");

  const pack = (v: {
    schemeName?: string | null;
    amount?: unknown;
    folioNumber?: string | null;
    date?: unknown;
    reason?: string | null;
    amcName?: string | null;
  }): Record<string, string> => {
    const reason = v.reason ?? "";
    return {
      "transaction.scheme_name": v.schemeName ?? "",
      "transaction.amount": fmtAmount(v.amount),
      "transaction.folio_number": v.folioNumber ?? "",
      "transaction.transaction_date": fmtDate(v.date),
      "transaction.rejection_reason": reason,
      "transaction.reason": reason,
      "transaction.amc_name": v.amcName ?? "",
    };
  };

  // 1. SIP rejection — its own table, carries the rejection reason.
  if (preferRejection) {
    const [r] = await tx
      .select({
        schemeName: sipRejections.schemeName,
        amount: sipRejections.rejectionAmount,
        folioNumber: sipRejections.folioNumber,
        date: sipRejections.rejectionDate,
        reason: sipRejections.rejectionReason,
        amcName: sipRejections.amcName,
      })
      .from(sipRejections)
      .where(and(eq(sipRejections.tenantId, tenantId), eq(sipRejections.investorId, investorId)))
      .orderBy(desc(sipRejections.rejectionDate))
      .limit(1);
    if (r) return pack(r);
  }

  // 2. Most recent executed transaction.
  const [txn] = await tx
    .select({
      schemeName: transactions.schemeName,
      amount: transactions.amount,
      folioNumber: transactions.folioNumber,
      date: transactions.orderDate,
      reason: transactions.reasonDescription,
      amcName: transactions.amcName,
    })
    .from(transactions)
    .where(and(eq(transactions.tenantId, tenantId), eq(transactions.investorId, investorId)))
    .orderBy(desc(transactions.orderDate))
    .limit(1);
  if (txn) return pack(txn);

  // 3. Latest SIP registration.
  const [sip] = await tx
    .select({
      schemeName: sips.schemeName,
      amount: sips.amount,
      folioNumber: sips.folioNumber,
      date: sips.startDate,
      amcName: sips.amcName,
    })
    .from(sips)
    .where(and(eq(sips.tenantId, tenantId), eq(sips.investorId, investorId)))
    .orderBy(desc(sips.startDate))
    .limit(1);
  if (sip) return pack(sip);

  return {};
}

export async function getConsent(
  tx: Tx,
  tenantId: string,
  investorId: string,
  channel: string,
  scope: "transactional" | "marketing"
) {
  // A blanket `all`-scope consent covers both transactional + marketing. Prefer
  // the exact scope when present, else fall back to an `all` consent.
  const rows = await tx
    .select()
    .from(consents)
    .where(
      and(
        eq(consents.tenantId, tenantId),
        eq(consents.investorId, investorId),
        eq(consents.channel, channel as any),
        inArray(consents.scope, [scope, "all"] as any)
      )
    );
  return rows.find((r) => r.scope === scope) ?? rows.find((r) => r.scope === "all") ?? null;
}
export async function hasActiveWhatsappSession(
  tx: Tx,
  tenantId: string,
  subject: { investorId?: string | null; leadId?: string | null }
): Promise<boolean> {
  const subjectCond = subject.investorId
    ? eq(communications.investorId, subject.investorId)
    : subject.leadId
      ? eq(communications.leadId, subject.leadId)
      : null;
  if (!subjectCond) return false;
  const [row] = await tx
    .select()
    .from(communications)
    .where(
      and(
        eq(communications.tenantId, tenantId),
        subjectCond,
        eq(communications.channel, "whatsapp"),
        eq(communications.direction, "inbound")
      )
    )
    .orderBy(desc(communications.createdAt))
    .limit(1);
  if (!row?.createdAt) return false;
  const elapsed = Date.now() - new Date(row.createdAt).getTime();
  return elapsed < 24 * 60 * 60 * 1000;
}
