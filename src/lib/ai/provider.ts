/**
 * AI provider abstraction — lets the platform run on Anthropic Claude OR Google
 * Gemini, switchable live from SSIT Admin (no redeploy). Every AI helper in
 * src/lib/ai/assistant.ts calls `aiMessagesClient().messages.create(...)` with
 * an Anthropic-shaped request; this module dispatches to the configured provider
 * and always returns the Anthropic-shaped `{ content: [{ type:'text', text }] }`
 * so call sites stay identical.
 *
 * Config precedence: platform_settings('ai') in the DB (key encrypted at rest)
 * → environment variables → none. Resolved config is cached for 30s.
 *
 * Models are addressed by TIER, not concrete name:
 *   "fast"      → quick/cheap classify+draft (Haiku / Gemini Flash)
 *   "reasoning" → higher-quality compose      (Opus  / Gemini Pro)
 * The concrete model per tier is configurable per provider in SSIT Admin.
 */

import Anthropic from "@anthropic-ai/sdk";
import { pool } from "@/db/client";
import { encrypt, decrypt } from "@/lib/crypto";

export type AiProvider = "anthropic" | "google" | "openai";
export type AiTier = "fast" | "reasoning";

/** Catalog that drives the admin UI + default model names per provider. */
export const AI_PROVIDERS: Array<{
  value: AiProvider;
  label: string;
  fast: string;
  reasoning: string;
  keyHint: string;
  docsUrl: string;
}> = [
  {
    value: "google",
    label: "Google Gemini",
    fast: "gemini-2.5-flash",
    reasoning: "gemini-2.5-pro",
    keyHint: "Google AI Studio API key",
    docsUrl: "https://aistudio.google.com/app/apikey",
  },
  {
    value: "anthropic",
    label: "Anthropic Claude",
    fast: "claude-haiku-4-5-20251001",
    reasoning: "claude-opus-4-7",
    keyHint: "Anthropic API key (starts with sk-ant-…)",
    docsUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    value: "openai",
    label: "OpenAI ChatGPT",
    fast: "gpt-4o-mini",
    reasoning: "gpt-4o",
    keyHint: "OpenAI API key (starts with sk-…)",
    docsUrl: "https://platform.openai.com/api-keys",
  },
];

const DEFAULTS: Record<AiProvider, { fast: string; reasoning: string }> = {
  google: { fast: "gemini-2.5-flash", reasoning: "gemini-2.5-pro" },
  anthropic: { fast: "claude-haiku-4-5-20251001", reasoning: "claude-opus-4-7" },
  openai: { fast: "gpt-4o-mini", reasoning: "gpt-4o" },
};

function isProvider(v: unknown): v is AiProvider {
  return v === "anthropic" || v === "google" || v === "openai";
}

/** Shape persisted in platform_settings.value for key='ai'. Key is encrypted. */
type StoredAiConfig = {
  provider: AiProvider;
  apiKeyEnc?: string | null;
  fastModel?: string | null;
  reasoningModel?: string | null;
};

export type ResolvedAiConfig = {
  provider: AiProvider;
  apiKey: string | null;
  fastModel: string;
  reasoningModel: string;
  source: "db" | "env" | "none";
};

// ── Config load (cached) ─────────────────────────────────────────────────────
let _cache: { cfg: ResolvedAiConfig; at: number } | null = null;
const TTL_MS = 30_000;

export function invalidateAiConfigCache() {
  _cache = null;
}

async function readStored(): Promise<StoredAiConfig | null> {
  try {
    const r = await pool.query("SELECT value FROM platform_settings WHERE key = 'ai' LIMIT 1");
    const v = r.rows?.[0]?.value;
    if (v && typeof v === "object" && isProvider((v as any).provider)) return v as StoredAiConfig;
  } catch {
    // Table may not exist yet (pre-migration) — fall back to env.
  }
  return null;
}

function resolveFromEnv(): ResolvedAiConfig {
  const gem = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
  const ant = process.env.ANTHROPIC_API_KEY || null;
  const oai = process.env.OPENAI_API_KEY || null;
  const pref = isProvider(process.env.AI_PROVIDER) ? (process.env.AI_PROVIDER as AiProvider) : null;

  const google = (): ResolvedAiConfig => ({
    provider: "google",
    apiKey: gem,
    fastModel: process.env.GEMINI_MODEL_FAST || DEFAULTS.google.fast,
    reasoningModel: process.env.GEMINI_MODEL_REASONING || DEFAULTS.google.reasoning,
    source: gem ? "env" : "none",
  });
  const anthropic = (): ResolvedAiConfig => ({
    provider: "anthropic",
    apiKey: ant,
    fastModel: process.env.ANTHROPIC_MODEL_FAST || DEFAULTS.anthropic.fast,
    reasoningModel: process.env.ANTHROPIC_MODEL_REASONING || DEFAULTS.anthropic.reasoning,
    source: ant ? "env" : "none",
  });
  const openai = (): ResolvedAiConfig => ({
    provider: "openai",
    apiKey: oai,
    fastModel: process.env.OPENAI_MODEL_FAST || DEFAULTS.openai.fast,
    reasoningModel: process.env.OPENAI_MODEL_REASONING || DEFAULTS.openai.reasoning,
    source: oai ? "env" : "none",
  });

  if (pref === "google") return google();
  if (pref === "anthropic") return anthropic();
  if (pref === "openai") return openai();
  if (gem && !ant && !oai) return google();
  if (ant) return anthropic();
  if (oai) return openai();
  if (gem) return google();
  // Nothing configured — default the provider label to google (the new default).
  return { provider: "google", apiKey: null, fastModel: DEFAULTS.google.fast, reasoningModel: DEFAULTS.google.reasoning, source: "none" };
}

export async function loadAiConfig(force = false): Promise<ResolvedAiConfig> {
  if (!force && _cache && Date.now() - _cache.at < TTL_MS) return _cache.cfg;

  const stored = await readStored();
  let cfg: ResolvedAiConfig;
  if (stored && stored.apiKeyEnc) {
    let apiKey: string | null = null;
    try {
      apiKey = decrypt(stored.apiKeyEnc);
    } catch {
      apiKey = null; // bad/old ciphertext (e.g. ENCRYPTION_KEY rotated)
    }
    cfg = {
      provider: stored.provider,
      apiKey,
      fastModel: stored.fastModel || DEFAULTS[stored.provider].fast,
      reasoningModel: stored.reasoningModel || DEFAULTS[stored.provider].reasoning,
      source: apiKey ? "db" : "none",
    };
  } else {
    cfg = resolveFromEnv();
  }
  _cache = { cfg, at: Date.now() };
  return cfg;
}

export async function isAiConfigured(): Promise<boolean> {
  return !!(await loadAiConfig()).apiKey;
}

// ── Anthropic-compatible client that dispatches to the active provider ────────
type AiContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: string; data: string } };

type AiMessage = { role: "user" | "assistant"; content: string | AiContentBlock[] };

type CreateParams = {
  model: string; // tier sentinel "fast" | "reasoning" (any other value → fast)
  max_tokens: number;
  system?: string;
  messages: AiMessage[];
  /**
   * When "json", ask the provider to emit a single well-formed JSON value (no
   * prose, no code fences). On Gemini this sets responseMimeType:application/json
   * which prevents the truncated/fenced output that broke our JSON.parse callers.
   */
  responseFormat?: "json";
};

type AiResponse = { content: Array<{ type: "text"; text: string }> };

/**
 * Returns an object whose `.messages.create()` matches the Anthropic SDK's
 * surface (the subset we use). Synchronous to keep call sites unchanged — the
 * async config load + dispatch happens inside `create()`.
 */
export function aiMessagesClient() {
  return {
    messages: {
      create: async (params: CreateParams): Promise<AiResponse> => {
        const cfg = await loadAiConfig();
        if (!cfg.apiKey) {
          throw new Error("AI is not configured. Set the provider and API key in SSIT Admin → AI & Models.");
        }
        const tier: AiTier = params.model === "reasoning" ? "reasoning" : "fast";
        const modelName = tier === "reasoning" ? cfg.reasoningModel : cfg.fastModel;

        if (cfg.provider === "anthropic") {
          const a = new Anthropic({ apiKey: cfg.apiKey });
          const res = await a.messages.create({
            model: modelName,
            max_tokens: params.max_tokens,
            system: params.system,
            messages: params.messages as any,
          });
          return res as unknown as AiResponse;
        }
        if (cfg.provider === "openai") {
          try {
            return await openaiCreate(cfg.apiKey, modelName, params);
          } catch (e: any) {
            if (tier === "reasoning" && e?.retryable && cfg.fastModel && cfg.fastModel !== modelName) {
              return openaiCreate(cfg.apiKey, cfg.fastModel, params, { retries: 1 });
            }
            throw e;
          }
        }
        // Google Gemini. geminiCreate already retries transient 429/5xx with
        // backoff. If the heavier "reasoning" model stays overloaded, degrade
        // once to the fast model so the assistant answers instead of failing.
        try {
          return await geminiCreate(cfg.apiKey, modelName, params);
        } catch (e: any) {
          if (
            tier === "reasoning" &&
            e?.retryable &&
            cfg.fastModel &&
            cfg.fastModel !== modelName
          ) {
            return geminiCreate(cfg.apiKey, cfg.fastModel, params, { retries: 1 });
          }
          throw e;
        }
      },
    },
  };
}

// ── Google Gemini (Generative Language API) via raw fetch — no SDK dependency ─
function toGeminiParts(content: string | AiContentBlock[]): any[] {
  if (typeof content === "string") return [{ text: content }];
  return content.map((b) => {
    if (b.type === "text") return { text: b.text };
    if (b.type === "image" || b.type === "document") {
      return { inline_data: { mime_type: b.source.media_type || "application/pdf", data: b.source.data } };
    }
    return { text: "" };
  });
}

// HTTP statuses worth retrying — transient overload / rate-limit / gateway.
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Map a provider HTTP failure to a short, user-safe message (never echoes the
 * key or the raw upstream JSON). Marks transient overload/rate-limit errors as
 * `retryable` so callers can retry or fall back to a lighter model.
 */
function aiHttpError(status: number, raw: string): Error & { status?: number; retryable?: boolean } {
  const overloaded =
    status === 503 || /UNAVAILABLE|high demand|overloaded|try again later/i.test(raw);
  let msg: string;
  if (overloaded) {
    msg = "The AI service is busy right now (high demand). Please try again in a few moments.";
  } else if (status === 429) {
    msg = "The AI service is rate-limited right now. Please wait a moment and try again.";
  } else if (status === 401 || status === 403) {
    msg = "The AI API key was rejected. Check the key in SSIT Admin → AI & Models.";
  } else if (status === 400) {
    msg = `The AI request was rejected (400). ${raw.slice(0, 160)}`.trim();
  } else {
    msg = `The AI service returned an error (${status}). Please try again.`;
  }
  const err = new Error(msg) as Error & { status?: number; retryable?: boolean };
  err.status = status;
  err.retryable = RETRYABLE_STATUS.has(status);
  return err;
}

async function geminiCreate(
  apiKey: string,
  model: string,
  params: CreateParams,
  opts: { retries?: number } = {}
): Promise<AiResponse> {
  const contents = params.messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: toGeminiParts(m.content),
  }));
  const body: any = {
    contents,
    generationConfig: {
      maxOutputTokens: params.max_tokens,
      // Force a single well-formed JSON value for structured callers. This is
      // what stops Gemini 2.5 from spending the token budget on "thinking" and
      // emitting truncated/fenced JSON (the cause of the "Unterminated string"
      // / parse errors on the AI Brief + Smart-search).
      ...(params.responseFormat === "json" ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (params.system) body.system_instruction = { parts: [{ text: params.system }] };

  // Fixed Google host — not user-controlled, so no SSRF surface.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const maxAttempts = (opts.retries ?? 2) + 1; // 1 attempt + N retries

  let lastErr: any;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        const err = aiHttpError(res.status, t);
        if (err.retryable && attempt < maxAttempts - 1) {
          lastErr = err;
          // Exponential backoff + jitter: ~0.6s, 1.2s, 2.4s …, capped at 8s.
          await sleep(Math.min(8000, 600 * 2 ** attempt) + Math.floor(Math.random() * 400));
          continue;
        }
        throw err;
      }
      const data: any = await res.json();
      const blocked = data?.promptFeedback?.blockReason;
      if (blocked) throw new Error(`The AI declined to answer this request (${blocked}).`);
      const cand = data?.candidates?.[0];
      const parts = cand?.content?.parts ?? [];
      const text = parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("");
      // Gemini 2.5 can return finishReason MAX_TOKENS with the whole budget spent
      // on hidden "thinking" tokens and no visible text. Surface that as a clean,
      // retryable error instead of letting callers JSON.parse("") and throw a
      // cryptic SyntaxError.
      if (!text.trim()) {
        const reason = cand?.finishReason;
        const err = new Error(
          reason === "MAX_TOKENS"
            ? "The AI response was cut off. Please try again."
            : "The AI returned an empty response. Please try again."
        ) as Error & { retryable?: boolean };
        err.retryable = true;
        throw err;
      }
      return { content: [{ type: "text", text }] };
    } catch (e: any) {
      // Network/timeout (AbortError, connection reset) — and a cut-off/empty
      // generation (e.retryable, set above) — are worth one more attempt.
      const transient =
        e?.retryable === true ||
        e?.name === "AbortError" ||
        e?.code === "UND_ERR_CONNECT_TIMEOUT" ||
        /fetch failed|network|ECONNRESET|ETIMEDOUT/i.test(e?.message ?? "");
      if (transient && attempt < maxAttempts - 1) {
        lastErr = e;
        await sleep(Math.min(8000, 600 * 2 ** attempt) + Math.floor(Math.random() * 400));
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error("The AI service is unavailable. Please try again.");
}

// ── OpenAI (ChatGPT) via the Chat Completions API — no SDK dependency ─────────
async function openaiCreate(
  apiKey: string,
  model: string,
  params: CreateParams,
  opts: { retries?: number } = {}
): Promise<AiResponse> {
  const messages: Array<{ role: string; content: string }> = [];
  if (params.system) messages.push({ role: "system", content: params.system });
  for (const m of params.messages) {
    messages.push({ role: m.role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) });
  }
  const body: any = { model, messages, max_tokens: params.max_tokens };
  // JSON mode for structured callers (the prompts already say "JSON").
  if (params.responseFormat === "json") body.response_format = { type: "json_object" };

  const url = "https://api.openai.com/v1/chat/completions";
  const maxAttempts = (opts.retries ?? 2) + 1;
  let lastErr: any;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        const err = aiHttpError(res.status, t);
        if (err.retryable && attempt < maxAttempts - 1) {
          lastErr = err;
          await sleep(Math.min(8000, 600 * 2 ** attempt) + Math.floor(Math.random() * 400));
          continue;
        }
        throw err;
      }
      const data: any = await res.json();
      const text = data?.choices?.[0]?.message?.content ?? "";
      if (!String(text).trim()) {
        const err = new Error("The AI returned an empty response. Please try again.") as Error & { retryable?: boolean };
        err.retryable = true;
        throw err;
      }
      return { content: [{ type: "text", text: String(text) }] };
    } catch (e: any) {
      const transient =
        e?.retryable === true ||
        e?.name === "AbortError" ||
        e?.code === "UND_ERR_CONNECT_TIMEOUT" ||
        /fetch failed|network|ECONNRESET|ETIMEDOUT/i.test(e?.message ?? "");
      if (transient && attempt < maxAttempts - 1) {
        lastErr = e;
        await sleep(Math.min(8000, 600 * 2 ** attempt) + Math.floor(Math.random() * 400));
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error("The AI service is unavailable. Please try again.");
}

// ── Admin helpers (status for display + save + live test) ─────────────────────
export type AiAdminStatus = {
  provider: AiProvider;
  fastModel: string;
  reasoningModel: string;
  keyConfigured: boolean;
  keyLast4: string | null;
  source: "db" | "env" | "none";
};

/** Never returns the raw key — only a masked last-4 + booleans for the UI. */
export async function getAiStatusForAdmin(): Promise<AiAdminStatus> {
  const stored = await readStored();
  if (stored && stored.apiKeyEnc) {
    let last4: string | null = null;
    try {
      last4 = decrypt(stored.apiKeyEnc).slice(-4);
    } catch {
      last4 = null;
    }
    return {
      provider: stored.provider,
      fastModel: stored.fastModel || DEFAULTS[stored.provider].fast,
      reasoningModel: stored.reasoningModel || DEFAULTS[stored.provider].reasoning,
      keyConfigured: !!last4,
      keyLast4: last4,
      source: "db",
    };
  }
  const env = resolveFromEnv();
  return {
    provider: env.provider,
    fastModel: env.fastModel,
    reasoningModel: env.reasoningModel,
    keyConfigured: !!env.apiKey,
    keyLast4: env.apiKey ? env.apiKey.slice(-4) : null,
    source: env.apiKey ? "env" : "none",
  };
}

/** Persist provider/models/key. Blank apiKey keeps the previously-saved key. */
export async function saveAiConfig(
  input: { provider: AiProvider; apiKey?: string | null; fastModel?: string | null; reasoningModel?: string | null },
  adminUserId: string
): Promise<void> {
  if (!isProvider(input.provider)) throw new Error("invalid provider");
  const prev = await readStored();
  let apiKeyEnc = prev && prev.provider === input.provider ? prev.apiKeyEnc ?? null : null;
  const fresh = input.apiKey?.trim();
  if (fresh) apiKeyEnc = encrypt(fresh);

  const value: StoredAiConfig = {
    provider: input.provider,
    apiKeyEnc,
    fastModel: input.fastModel?.trim() || DEFAULTS[input.provider].fast,
    reasoningModel: input.reasoningModel?.trim() || DEFAULTS[input.provider].reasoning,
  };
  await pool.query(
    `INSERT INTO platform_settings (key, value, updated_at, updated_by)
     VALUES ('ai', $1::jsonb, now(), $2::uuid)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(value), adminUserId]
  );
  invalidateAiConfigCache();
}

/** Live "Test connection" — pings the provider with the given (or saved) key. */
export async function testAiConnection(input: {
  provider: AiProvider;
  apiKey?: string | null;
  model?: string | null;
}): Promise<{ ok: boolean; error?: string; reply?: string }> {
  let apiKey = input.apiKey?.trim() || null;
  if (!apiKey) {
    const s = await readStored();
    if (s?.apiKeyEnc) {
      try {
        apiKey = decrypt(s.apiKeyEnc);
      } catch {
        apiKey = null;
      }
    }
  }
  if (!apiKey) return { ok: false, error: "No API key to test — enter one above first." };
  const model = input.model?.trim() || DEFAULTS[input.provider].fast;
  const probe: CreateParams = { model: "fast", max_tokens: 16, messages: [{ role: "user", content: "Reply with the single word: OK" }] };
  try {
    if (input.provider === "anthropic") {
      const a = new Anthropic({ apiKey });
      const r = await a.messages.create({ model, max_tokens: 16, messages: probe.messages as any });
      const t = (r.content.find((b: any) => b.type === "text") as any)?.text ?? "";
      return { ok: true, reply: String(t).slice(0, 40) };
    }
    if (input.provider === "openai") {
      const r = await openaiCreate(apiKey, model, probe);
      return { ok: true, reply: (r.content[0]?.text ?? "").slice(0, 40) };
    }
    const r = await geminiCreate(apiKey, model, probe);
    return { ok: true, reply: (r.content[0]?.text ?? "").slice(0, 40) };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "connection failed" };
  }
}
