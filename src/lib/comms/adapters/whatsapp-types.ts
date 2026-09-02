/**
 * Shared WhatsApp adapter contract. The comms pipeline builds a `SendWhatsappArgs`
 * and the active provider adapter (Vartify) turns it into a send. Kept
 * provider-neutral so the pipeline never imports a concrete adapter.
 */
import type { TemplateVersion } from "@/db/schema";

export interface SendWhatsappArgs {
  tenantId: string;
  templateVersion: TemplateVersion;
  tokens: Record<string, string>;
  /** Fully-rendered body text (tokens already resolved by the pipeline). Used for
   *  free-form sends so the adapter never has to re-derive block-based content. */
  renderedText?: string;
  recipient: string; // E.164 number — "+91XXXXXXXXXX"
  apiKey?: string;
  /** Per-tenant send endpoint / base-URL override (defaults to env / platform URL). */
  webhookUrl?: string;
  /** Per-tenant default WhatsApp language code, e.g. "en_US". */
  defaultLanguage?: string;
  /** Stable across step retries; sent as a best-effort dedup header. */
  idempotencyKey?: string;
  /** Human name shown as the sender in the provider's inbox (e.g. the CRM user
   *  who clicked Send). Providers that don't model this ignore it. */
  sentByName?: string;
}
