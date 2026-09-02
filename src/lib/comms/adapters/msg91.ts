/**
 * MSG91 SMS adapter (India). Requires DLT (Distributed Ledger Technology)
 * template registration with TRAI — the template version's body must include
 * a `dltTemplateId`, enforced by compliance.
 */

import axios from "axios";
import type { TemplateVersion } from "@/db/schema";

export interface SendSmsArgs {
  tenantId: string;
  templateVersion: TemplateVersion;
  tokens: Record<string, string>;
  rendered: { text: string; tokens: Record<string, string> };
  recipient: string;
  apiKey?: string;
  senderId?: string;
  /** Stable across step retries; sent as a best-effort dedup header. */
  idempotencyKey?: string;
}

export const smsAdapter = {
  async send(args: SendSmsArgs): Promise<{ externalId: string; status: "sent" | "queued" }> {
    const authKey = args.apiKey ?? process.env.MSG91_AUTH_KEY;
    if (!authKey) throw new Error("MSG91_AUTH_KEY not set");
    const senderId = args.senderId ?? process.env.MSG91_SENDER_ID ?? "MFDPLT";
    const body = args.templateVersion.body as any;
    const dltTemplateId = body?.dltTemplateId;
    if (!dltTemplateId) {
      throw new Error("SMS template missing dltTemplateId");
    }

    const recipient = normalizeMobile(args.recipient);

    // MSG91 v5 Flow API expects template_id + variables
    const payload = {
      template_id: dltTemplateId,
      short_url: "0",
      recipients: [
        {
          mobiles: recipient,
          ...args.tokens, // variable values keyed by var1, var2, etc.
        },
      ],
      sender: senderId,
    };

    let res;
    try {
      res = await axios.post("https://control.msg91.com/api/v5/flow/", payload, {
        headers: {
          "Content-Type": "application/json",
          authkey: authKey,
          ...(args.idempotencyKey ? { "X-Idempotency-Key": args.idempotencyKey } : {}),
        },
        timeout: 15_000,
      });
    } catch (err: any) {
      // Classify so the caller can stop retrying permanent failures. A 4xx
      // (bad DLT template / auth) will never succeed on retry; a 5xx / timeout
      // / network error is transient and worth retrying.
      const status = err?.response?.status;
      const detail = err?.response?.data?.message ?? err?.message ?? "send failed";
      const permanent = typeof status === "number" && status >= 400 && status < 500;
      throw Object.assign(new Error(`MSG91 send failed (${status ?? "network"}): ${detail}`), {
        permanent,
        providerStatus: status,
      });
    }

    // MSG91 v5 returns { type: "success" | "error", message, request_id }.
    // A 200 with type:"error" (e.g. invalid template) is a real rejection —
    // surface it instead of fabricating a fake "sent" externalId that masks it.
    if (res.data?.type === "error") {
      throw Object.assign(new Error(`MSG91 rejected: ${res.data?.message ?? "unknown error"}`), {
        permanent: true,
      });
    }
    const requestId = res.data?.request_id;
    if (!requestId) {
      throw Object.assign(new Error("MSG91 returned no request_id — treating as a failed send"), {
        permanent: false,
      });
    }

    return { externalId: String(requestId), status: "sent" };
  },
};

function normalizeMobile(num: string): string {
  let n = num.replace(/[^\d+]/g, "");
  if (n.startsWith("+")) n = n.slice(1);
  if (n.length === 10) n = `91${n}`;
  return n;
}
