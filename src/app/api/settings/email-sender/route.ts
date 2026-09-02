/**
 * Per-MFD email sender identity — so client emails go out as the firm, not the
 * shared platform address.
 *
 *   GET  → current sender mapping (from name / from email / reply-to) + masked
 *          own-key hint + the platform default address.
 *   POST → save { fromName, fromEmail?, replyTo?, apiKey? } onto the tenant's
 *          encrypted "resend" integration. The dispatch pipeline already reads
 *          senderConfig.{fromName,fromEmail,replyTo} + config.apiKey on every send.
 *
 * Deliverability note: a custom `fromEmail` (advisor@firm.com) requires that
 * domain be verified in Resend (SPF/DKIM). If left blank we send from the
 * platform's verified domain with the firm's NAME + the MFD's reply-to, which
 * needs no DNS setup and works immediately.
 *
 * Owner-only (firm-level credential).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { getTenantIntegration, upsertTenantIntegration, disableTenantIntegration } from "@/lib/comms/integrations";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

function requireOwner(roles: string[] | undefined) {
  if (!roles?.includes("owner")) {
    return NextResponse.json(
      { error: "forbidden: only the firm owner can change the email sender" },
      { status: 403 }
    );
  }
  return null;
}

export async function GET() {
  try {
    const session = await requireSession();
    // Email-sender config is an owner-only setting — match the POST gate so the
    // (masked) key hint + sender identity aren't readable by every session.
    const forbidden = requireOwner(session.roles);
    if (forbidden) return forbidden;
    const resolved = await withTenant(session.tenantId, async (tx) =>
      getTenantIntegration(tx, session.tenantId, "resend")
    );
    const key = resolved?.config?.apiKey ?? "";
    return NextResponse.json({
      fromName: resolved?.senderConfig?.fromName ?? "",
      fromEmail: resolved?.senderConfig?.fromEmail ?? "",
      replyTo: resolved?.senderConfig?.replyTo ?? "",
      ownKeyHint: key ? `••••${key.slice(-4)}` : null,
      platformFrom: process.env.EMAIL_FROM_TRANSACTIONAL ?? null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const SaveSchema = z.object({
  fromName: z.string().trim().min(1, "Sender name is required").max(120),
  fromEmail: z.string().trim().email("Enter a valid email").max(200).optional().or(z.literal("")),
  replyTo: z.string().trim().email("Enter a valid email").max(200).optional().or(z.literal("")),
  /** Optional: the MFD's OWN Resend API key (full custom-domain self-serve). */
  apiKey: z.string().trim().max(500).optional().or(z.literal("")),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const forbidden = requireOwner(session.roles);
    if (forbidden) return forbidden;

    const parsed = SaveSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid input", details: parsed.error.flatten() }, { status: 400 });
    }
    const { fromName, fromEmail, replyTo, apiKey } = parsed.data;

    await withTenant(session.tenantId, async (tx) => {
      // Preserve an existing own-key when the form leaves the key blank.
      const existing = await getTenantIntegration(tx, session.tenantId, "resend");
      const mergedKey = apiKey && apiKey.length ? apiKey : existing?.config?.apiKey ?? "";
      await upsertTenantIntegration(
        tx,
        session.tenantId,
        "resend",
        { apiKey: mergedKey },
        {
          fromName,
          fromEmail: fromEmail || undefined,
          replyTo: replyTo || undefined,
        }
      );
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE() {
  try {
    const session = await requireSession();
    const forbidden = requireOwner(session.roles);
    if (forbidden) return forbidden;
    // Reset to the platform default sender (soft-disable the integration).
    await withTenant(session.tenantId, async (tx) => {
      await disableTenantIntegration(tx, session.tenantId, "resend");
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
