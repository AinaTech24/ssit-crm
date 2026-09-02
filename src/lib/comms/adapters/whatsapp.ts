/**
 * WhatsApp provider.
 *
 * The platform sends WhatsApp through **Vartify** (https://vartify.in) — the
 * WhatsApp Business Platform the firm holds its own Meta account with. The comms
 * pipeline imports `whatsappAdapter` from here so the send path never depends on
 * a concrete adapter module.
 *
 * Credentials are per-tenant (saved in Settings → Integrations under the
 * `vartify` provider) with an env fallback (VARTIFY_API_TOKEN / VARTIFY_BASE_URL).
 */

import { vartifyWhatsappAdapter } from "./vartify";

export type { SendWhatsappArgs } from "./whatsapp-types";

/** The active WhatsApp provider id — imported by the pipeline so the per-tenant
 *  integration row it loads always matches the adapter that will send. */
export const whatsappProviderId = "vartify" as const;

export const whatsappAdapter = vartifyWhatsappAdapter;
