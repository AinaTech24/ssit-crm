/**
 * Resend webhook handler. Receives delivery/open/click/bounce events
 * via Svix-signed payloads.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { emailAdapter } from "@/lib/comms/adapters/resend";
import { applyMonotonicStatus } from "@/lib/comms/webhook-status";
import { communications, emailSuppressions } from "@/db/schema";
import { captureError } from "@/lib/observability/capture";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => (headers[k] = v));

  if (!emailAdapter.verifyWebhookSignature(rawBody, headers)) {
    captureError("webhook.signature_failed", null, { source: "resend" });
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const type: string = payload.type ?? "";
  const data = payload.data ?? {};
  const emailId: string = data.email_id ?? data.id ?? "";

  if (!emailId) return NextResponse.json({ ok: true });

  const statusMap: Record<string, string> = {
    "email.sent": "sent",
    "email.delivered": "delivered",
    "email.opened": "read",
    "email.clicked": "read",
    "email.bounced": "bounced",
    "email.complained": "bounced",
    "email.delivery_delayed": "queued",
    "email.failed": "failed",
  };

  const newStatus = statusMap[type] ?? null;
  if (!newStatus) return NextResponse.json({ ok: true });

  // Monotonic apply — an out-of-order "delivered" after "read" won't regress,
  // and a late "sent" can't resurrect a terminal "bounced"/"failed".
  await withSystem(async (tx) => {
    await applyMonotonicStatus(tx, { externalId: emailId, channel: "email", newStatus });

    // Hard bounce / spam complaint → suppress the address so the pipeline
    // stops sending to it (deliverability + consent). Resolve the tenant from
    // the originating communication; take the recipient from the event payload.
    if (type === "email.bounced" || type === "email.complained") {
      const to = Array.isArray(data.to) ? data.to[0] : data.to;
      if (to) {
        const [comm] = await tx
          .select({ tenantId: communications.tenantId })
          .from(communications)
          .where(and(eq(communications.externalId, emailId), eq(communications.channel, "email")))
          .limit(1);
        if (comm?.tenantId) {
          await tx
            .insert(emailSuppressions)
            .values({
              tenantId: comm.tenantId,
              email: String(to),
              reason: type === "email.complained" ? "complained" : "bounced",
              source: "webhook",
            } as any)
            .onConflictDoNothing();
        }
      }
    }
  });

  return NextResponse.json({ ok: true });
}
