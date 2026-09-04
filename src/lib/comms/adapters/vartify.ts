/**
 * Vartify WhatsApp Business Platform adapter — https://vartify.in/api/v1
 *
 * Replaces the previous WhatsApp adapter. Two things differ materially from
 * the provider it replaces, and both shape this file:
 *
 *  1. Vartify is CONTACT-BASED, not phone-based. `POST /messages/send` takes a
 *     numeric `contact_id`, not a number — so every send first upserts the
 *     recipient via `POST /contacts` to resolve that id. Vartify documents that
 *     endpoint as an idempotent upsert keyed on the phone number ("safe to call
 *     on every CRM save"), so this costs one extra request but never creates
 *     duplicates and needs no local id cache to stay correct.
 *
 *  2. Template variables are POSITIONAL. Vartify wants `template_vars: [...]`
 *     matching {{1}}, {{2}} in order — where the old provider took a named map.
 *     We derive the order from `templateVersion.variables`, which is already an
 *     ordered array.
 *
 * Phone format: Vartify requires E.164 WITH the leading `+`
 * (^\+[1-9]\d{6,14}$). The previous provider wanted it stripped — do not carry
 * that habit over.
 */

import axios from "axios";
import { createHmac, timingSafeEqual } from "crypto";
import type { SendWhatsappArgs } from "./whatsapp-types";

const DEFAULT_BASE_URL = "https://vartify.in/api/v1";

export interface VartifyConfig {
  apiKey: string;
  baseUrl: string;
  defaultLanguage: string;
}

/** Normalise a configured base URL to the versioned API root. */
export function toApiBase(raw?: string | null): string {
  const v = (raw ?? "").trim();
  if (!v) return DEFAULT_BASE_URL;
  const trimmed = v.replace(/\/+$/, "");
  // Tolerate someone pasting the bare host or the console URL.
  if (/\/api\/v\d+$/.test(trimmed)) return trimmed;
  return `${trimmed}/api/v1`;
}

function resolveConfig(args: {
  apiKey?: string;
  webhookUrl?: string | null;
  defaultLanguage?: string;
}): VartifyConfig {
  const apiKey = args.apiKey ?? process.env.VARTIFY_API_TOKEN ?? process.env.VARTIFY_API_KEY;
  if (!apiKey) {
    throw new Error(
      "WhatsApp isn't connected — save your Vartify API token in Settings → Integrations."
    );
  }
  return {
    apiKey,
    baseUrl: toApiBase(args.webhookUrl ?? process.env.VARTIFY_BASE_URL),
    defaultLanguage: args.defaultLanguage ?? process.env.VARTIFY_DEFAULT_LANGUAGE ?? "en",
  };
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };
}

/**
 * Vartify requires E.164 WITH a leading '+'. Bare 10-digit input is assumed
 * Indian (the product's market); anything already carrying a country code is
 * passed through with a '+' ensured.
 */
export function toE164(raw: string): string {
  let n = (raw ?? "").replace(/[^\d+]/g, "");
  if (n.startsWith("+")) return n;
  n = n.replace(/^0+/, "");
  if (n.length === 10) return `+91${n}`;
  return `+${n}`;
}

/** Replace {{token}} placeholders in a raw string using the pipeline's tokens. */
function substituteTokens(value: unknown, tokens: Record<string, string>): unknown {
  if (typeof value !== "string") return value;
  return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => tokens[key] ?? "");
}

/** Surface a Vartify error body as a single readable line. */
function describeError(err: any): string {
  const res = err?.response;
  const data = res?.data;
  if (data?.errors && typeof data.errors === "object") {
    // 422 validation — the `errors` object is the actionable part.
    const parts = Object.entries(data.errors).map(
      ([field, msgs]) => `${field}: ${Array.isArray(msgs) ? msgs.join(", ") : String(msgs)}`
    );
    return `${data.message ?? "Validation failed"} (${parts.join("; ")})`;
  }
  const detail = data?.error ?? data?.message ?? data ?? err?.message;
  const status = res?.status ? `HTTP ${res.status}: ` : "";
  return `${status}${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
}

// ─────────────────────────── contacts ───────────────────────────

export interface VartifyContactInput {
  phone: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  /** CRM record id, stored in Vartify custom_fields for later matching. */
  crmRecordId?: string | null;
  source?: string;
}

/**
 * Upsert a contact and return its Vartify id.
 *
 * `POST /contacts` is an upsert keyed on phone_e164 — repeat calls update the
 * existing record rather than duplicating, so this is safe to call on every
 * send without checking for existence first.
 *
 * `opt_in_whatsapp: true` is set deliberately: the CRM has already run its own
 * consent gate (see comms/pipeline.ts step 3) before any send reaches an
 * adapter, so a contact arriving here is one this firm is permitted to message.
 * Without it Vartify would exclude them from WhatsApp campaigns.
 */
export async function upsertVartifyContact(
  cfg: Pick<VartifyConfig, "apiKey" | "baseUrl">,
  input: VartifyContactInput
): Promise<number> {
  const body: Record<string, unknown> = {
    phone_e164: toE164(input.phone),
    opt_in_whatsapp: true,
    source: input.source ?? "ssit_crm",
  };
  if (input.firstName) body.first_name = String(input.firstName).slice(0, 100);
  if (input.lastName) body.last_name = String(input.lastName).slice(0, 100);
  if (input.email) body.email = String(input.email).slice(0, 255);
  if (input.crmRecordId) body.custom_fields = { crm_record_id: String(input.crmRecordId) };

  const res = await axios.post(`${cfg.baseUrl}/contacts`, body, {
    timeout: 15_000,
    headers: { ...authHeaders(cfg.apiKey), "Content-Type": "application/json" },
  });
  const id = (res.data?.data ?? res.data)?.id;
  if (id == null) throw new Error("Vartify did not return a contact id");
  return Number(id);
}

// ─────────────────────────── send ───────────────────────────

export type VartifySendBody = Record<string, unknown>;

/**
 * Pure mapper: SendWhatsappArgs → the `POST /messages/send` body, minus the
 * contact_id (resolved separately). Split out so it can be unit-tested without
 * a network round-trip.
 *
 * Template vs free-form: WhatsApp only allows free-form text within 24h of the
 * customer's last inbound message; outside that window a send MUST use an
 * approved template. We prefer a template whenever the stored template version
 * names one, exactly as the previous adapter did.
 */
export function buildVartifySendBody(
  args: SendWhatsappArgs,
  defaultLanguage = "en"
): VartifySendBody {
  const body = (args.templateVersion.body ?? {}) as Record<string, any>;

  const templateName =
    body.vartifyTemplateName ??
    body.metaTemplateName ??
    args.templateVersion.externalRef;

  if (!templateName) {
    // Free-form: only valid inside the 24-hour customer-care window.
    const raw = body.text ?? body.body?.text ?? body.message ?? "";
    const message = String(args.renderedText?.trim() || substituteTokens(raw, args.tokens) || "");
    if (!message) {
      throw new Error(
        "Vartify send: no template name (set templateVersion.body.vartifyTemplateName or externalRef) and no plain-text body"
      );
    }
    return { channel: "whatsapp", body: message };
  }

  // Positional template variables, in the stored variable order → {{1}}, {{2}}…
  const vars = (args.templateVersion.variables as Array<{ key: string }>) ?? [];
  const template_vars = vars.map((v) => args.tokens[v.key] ?? "");

  // Header media: never re-send Meta's signed CDN URLs — they expire and cause
  // 131053 errors. Only a permanent URL is forwarded.
  const EXPIRING_MEDIA = /scontent\.whatsapp\.net|lookaside\.fbsbx\.com/i;
  const storedSample =
    typeof body.headerSampleUrl === "string" && !EXPIRING_MEDIA.test(body.headerSampleUrl)
      ? body.headerSampleUrl
      : undefined;
  const headerMediaRaw = body.headerMediaUrl ?? body.vartifyHeaderMediaUrl ?? storedSample;
  const header_media_url = headerMediaRaw
    ? String(substituteTokens(headerMediaRaw, args.tokens))
    : undefined;

  return {
    channel: "whatsapp",
    template_name: String(templateName),
    template_vars,
    template_language: body.languageCode ?? body.vartifyLanguage ?? defaultLanguage,
    ...(header_media_url ? { header_media_url } : {}),
  };
}

export const vartifyWhatsappAdapter = {
  async send(args: SendWhatsappArgs): Promise<{ externalId: string; status: "sent" | "queued" }> {
    const cfg = resolveConfig(args);

    let contactId: number;
    try {
      contactId = await upsertVartifyContact(cfg, {
        phone: args.recipient,
        // The pipeline resolves these tokens for the template; reuse them so the
        // Vartify inbox shows a name rather than a bare number.
        firstName: args.tokens?.["investor.firstName"] ?? args.tokens?.["lead.firstName"] ?? null,
        lastName: args.tokens?.["investor.lastName"] ?? args.tokens?.["lead.lastName"] ?? null,
        email: args.tokens?.["investor.email"] ?? args.tokens?.["lead.email"] ?? null,
        crmRecordId: args.tokens?.["investor.id"] ?? args.tokens?.["lead.id"] ?? null,
      });
    } catch (err: any) {
      throw new Error(`Vartify contact sync failed: ${describeError(err)}`);
    }

    const payload = { contact_id: contactId, ...buildVartifySendBody(args, cfg.defaultLanguage) };
    // Shown in the Vartify inbox as the sender — defaults to "automation".
    if (args.sentByName) (payload as Record<string, unknown>).sent_by = args.sentByName;

    try {
      const res = await axios.post(`${cfg.baseUrl}/messages/send`, payload, {
        timeout: 20_000,
        headers: {
          ...authHeaders(cfg.apiKey),
          "Content-Type": "application/json",
          ...(args.idempotencyKey ? { "X-Idempotency-Key": args.idempotencyKey } : {}),
        },
      });
      const data = (res.data ?? {}) as Record<string, any>;
      const externalId =
        data.provider_message_id ?? data.message_id ?? data.id ?? `vartify-${args.idempotencyKey ?? Date.now()}`;
      // Vartify reports "sent" once it has handed the message to WhatsApp;
      // delivered/read arrive later via webhook.
      const status: "sent" | "queued" = data.status === "queued" ? "queued" : "sent";
      return { externalId: String(externalId), status };
    } catch (err: any) {
      throw new Error(`Vartify send failed: ${describeError(err)}`);
    }
  },

  /** GET /whatsapp/templates — approved (sendable) templates by default. */
  async listTemplates(opts?: { apiKey?: string; baseUrl?: string | null }): Promise<Array<any>> {
    return (await fetchVartifyTemplatesDetailed(opts)).templates;
  },

  /**
   * POST /whatsapp/templates — submit a template to Meta for approval.
   * Name must match ^[a-z0-9_]+$; category must be MARKETING / UTILITY /
   * AUTHENTICATION. Approval is Meta's call and is not instant.
   */
  async submitTemplate(opts: {
    apiKey?: string;
    baseUrl?: string | null;
    templateName: string;
    category: string;
    language: string;
    messageBody: string;
    variableExamples: Array<{ key: string; example: string }>;
    headerText?: string;
    footerText?: string;
    headerMediaUrl?: string;
    buttons?: any[];
  }): Promise<{ ok: boolean; metaTemplateId?: string; status?: string; error?: string; raw: unknown }> {
    const apiKey = opts.apiKey ?? process.env.VARTIFY_API_TOKEN ?? process.env.VARTIFY_API_KEY;
    if (!apiKey) return { ok: false, error: "WhatsApp isn't connected (no API token).", raw: null };
    const base = toApiBase(opts.baseUrl ?? process.env.VARTIFY_BASE_URL);

    const name = opts.templateName.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
    const category = String(opts.category ?? "UTILITY").toUpperCase();

    try {
      const res = await axios.post(
        `${base}/whatsapp/templates`,
        {
          name,
          language: opts.language,
          category,
          body: opts.messageBody,
          ...(opts.headerText ? { header_text: opts.headerText } : {}),
          ...(opts.footerText ? { footer_text: opts.footerText } : {}),
          ...(opts.headerMediaUrl ? { header_media_url: opts.headerMediaUrl } : {}),
          ...(opts.buttons?.length ? { buttons: opts.buttons } : {}),
          ...(opts.variableExamples?.length
            ? { variable_examples: opts.variableExamples.map((v) => v.example) }
            : {}),
        },
        {
          timeout: 25_000,
          headers: { ...authHeaders(apiKey), "Content-Type": "application/json" },
        }
      );
      const d = (res.data?.data ?? res.data ?? {}) as Record<string, any>;
      return {
        ok: true,
        // Vartify keys templates by NAME; there is no separate numeric id in the
        // documented response, so the name is the durable reference we store.
        metaTemplateId: String(d.name ?? name),
        status: d.status ?? "PENDING",
        raw: res.data,
      };
    } catch (err: any) {
      return { ok: false, error: describeError(err), raw: err?.response?.data ?? null };
    }
  },

  /**
   * Vartify exposes no per-template status endpoint — statuses come from the
   * list. We fetch every template (?status=all) and match by name.
   */
  async templateStatus(
    templateName: string,
    opts?: { apiKey?: string; baseUrl?: string | null }
  ): Promise<{ ok: boolean; status?: string; isFinal?: boolean; rejectionReason?: string; error?: string }> {
    const r = await fetchVartifyTemplatesDetailed({ ...opts, status: "all" });
    if (!r.ok) return { ok: false, error: r.error };
    const match = r.templates.find(
      (t: any) => String(t?.name ?? "").toLowerCase() === templateName.toLowerCase()
    );
    if (!match) return { ok: false, error: `Template "${templateName}" not found in Vartify.` };
    const status = String(match.status ?? "").toUpperCase();
    return {
      ok: true,
      status,
      isFinal: status === "APPROVED" || status === "REJECTED",
      rejectionReason: match.rejection_reason ?? match.rejectionReason,
    };
  },

  /**
   * Verify an inbound webhook signature.
   *
   * Header: `X-Webhook-Signature: t=<unix_ts>,v1=<hmac_sha256>`
   * Signed value is `<t>.<raw request body>`, HMAC-SHA256 with the endpoint
   * secret returned when the webhook was registered. Compared in constant time.
   *
   * Returns false when no secret is configured — the caller decides whether an
   * unverified delivery is acceptable, so an unset secret can never silently
   * read as "verified".
   */
  verifyWebhookSignature(rawBody: string, signatureHeader?: string | null, secret?: string | null): boolean {
    const key = secret ?? process.env.VARTIFY_WEBHOOK_SECRET;
    if (!key || !signatureHeader) return false;

    const parts = Object.fromEntries(
      signatureHeader
        .split(",")
        .map((p) => p.trim().split("="))
        .filter((kv): kv is [string, string] => kv.length === 2)
    );
    const t = parts.t;
    const v1 = parts.v1;
    if (!t || !v1) return false;

    const expected = createHmac("sha256", key).update(`${t}.${rawBody}`).digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(v1, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  },
};

// ─────────────────────────── diagnostics ───────────────────────────

/**
 * GET /whatsapp/templates — diagnostic variant that SURFACES failures (status,
 * message, the URL hit) instead of swallowing them to []. The "Fetch from
 * WhatsApp" flow uses this so a wrong token shows a real error rather than a
 * misleading "no templates found".
 */
export async function fetchVartifyTemplatesDetailed(opts?: {
  apiKey?: string;
  baseUrl?: string | null;
  status?: "all" | "approved";
}): Promise<{ ok: boolean; templates: any[]; error?: string; httpStatus?: number; url: string }> {
  const apiKey = opts?.apiKey ?? process.env.VARTIFY_API_TOKEN ?? process.env.VARTIFY_API_KEY;
  const base = toApiBase(opts?.baseUrl ?? process.env.VARTIFY_BASE_URL);
  const url = `${base}/whatsapp/templates${opts?.status === "all" ? "?status=all" : ""}`;
  if (!apiKey) return { ok: false, templates: [], error: "No Vartify API token configured.", url };

  try {
    const res = await axios.get(url, { timeout: 20_000, headers: authHeaders(apiKey) });
    const list = (res.data?.data ?? res.data ?? []) as any[];
    return { ok: true, templates: Array.isArray(list) ? list : [], httpStatus: res.status, url };
  } catch (err: any) {
    return {
      ok: false,
      templates: [],
      error: describeError(err),
      httpStatus: err?.response?.status,
      url,
    };
  }
}

export interface VartifyAccount {
  workspaceName?: string;
  email?: string;
  plan?: string;
}

/**
 * GET /me — the documented connection test. Returns the account the token
 * belongs to, so the firm can confirm which Vartify workspace their key is for.
 */
export async function vartifyCheckConnection(
  apiKey: string,
  baseUrl?: string | null
): Promise<{ ok: boolean; account?: VartifyAccount; error?: string; httpStatus?: number }> {
  const base = toApiBase(baseUrl ?? process.env.VARTIFY_BASE_URL);
  try {
    const res = await axios.get(`${base}/me`, { timeout: 15_000, headers: authHeaders(apiKey) });
    const d = (res.data?.data ?? res.data ?? {}) as Record<string, any>;
    return {
      ok: true,
      httpStatus: res.status,
      account: {
        workspaceName:
          d.workspace_name ?? d.workspace?.name ?? d.name ?? d.company ?? undefined,
        email: d.email ?? undefined,
        plan: d.plan ?? d.subscription?.plan ?? undefined,
      },
    };
  } catch (err: any) {
    return { ok: false, error: describeError(err), httpStatus: err?.response?.status };
  }
}
