import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { tenants } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { renderEmailHtml } from "@/lib/email-designer/render";
import { MERGE_FIELDS } from "@/lib/email-designer/merge-fields";
import { emailAdapter } from "@/lib/comms/adapters/resend";
import { resolveEmailSender } from "@/lib/comms/sender";
import type { EmailDesignerBody } from "@/lib/email-designer/types";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

/**
 * POST /api/email-designer/test-send  { body, to? }
 *
 * Renders the in-progress designer body with sample merge values and emails it
 * to the requester (or `to`) so they can see the real inbox look before saving.
 * Sample-data send — never touches a real client or the consent pipeline.
 */
function sampleEnvelope(): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of MERGE_FIELDS) {
    const [root, ...rest] = f.token.split(".");
    out[root] ??= {};
    let cur: any = out[root];
    for (let i = 0; i < rest.length - 1; i++) {
      cur[rest[i]] ??= {};
      cur = cur[rest[i]];
    }
    cur[rest[rest.length - 1]] = f.example;
  }
  return out;
}

function resolveSubject(subject: string): string {
  let out = subject || "(no subject)";
  for (const f of MERGE_FIELDS) {
    out = out.replaceAll(`{{${f.token}}}`, String(f.example ?? ""));
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "template.edit", session.permissions);
    const { body, to } = await req.json().catch(() => ({ body: null }));
    if (!body) return NextResponse.json({ error: "missing body" }, { status: 400 });

    const recipient = String(to ?? session.email ?? "").trim();
    if (!recipient || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) {
      return NextResponse.json({ error: "No valid email address to send the test to." }, { status: 400 });
    }

    // Resolve BOTH the tenant record and the tenant's email sender (their own
    // mailbox / OAuth / Resend key) in one tenant-scoped tx — the same resolver
    // the real send pipeline uses. Sending via the shared platform Resend key
    // fails in production (RESEND_API_KEY is intentionally unset; every firm
    // sends from its own connected mailbox).
    const { tenant, sender } = await withTenant(session.tenantId, async (tx) => {
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, session.tenantId));
      const sender = await resolveEmailSender(tx, session.tenantId, session.userId);
      return { tenant: t, sender };
    });

    // No firm mailbox connected AND no platform Resend key → give a clear,
    // actionable message instead of a generic "internal" error.
    if (!sender.smtp) {
      return NextResponse.json(
        { error: "No email account is connected for your firm. Connect your mailbox in Settings → Email, then try the test send again." },
        { status: 400 }
      );
    }

    const html = renderEmailHtml(body as EmailDesignerBody, {
      variables: sampleEnvelope(),
      tenant: {
        legalName: tenant?.legalName,
        displayName: tenant?.displayName,
        arn: tenant?.arn,
        principalEuin: (tenant as any)?.principalEuin,
        address: (tenant as any)?.addressLine1 ?? (tenant as any)?.officeAddress ?? null,
        websiteUrl: (tenant as any)?.websiteUrl ?? null,
        brandColor: ((tenant as any)?.brandingConfig as any)?.brandColor ?? null,
        logoUrl: tenant?.logoUrl ?? ((tenant as any)?.brandingConfig as any)?.logoUrl ?? null,
      },
      unsubscribeUrl: "#test",
    });

    const subject = `[TEST] ${resolveSubject((body as EmailDesignerBody).subject ?? "")}`;

    await emailAdapter.send({
      tenantId: session.tenantId,
      inlineHtml: html,
      tokens: {},
      rendered: { subject, text: "This is a test render of your email template.", tokens: {} },
      recipient,
      category: "transactional",
      // Send from the firm's own mailbox / Resend key (falls back to platform
      // Resend only if a key is set) — mirrors the real send pipeline.
      smtp: sender.smtp,
      fromOverride: sender.fromEmail ?? (sender.smtp ? sender.smtp.user : undefined),
      fromNameOverride: sender.fromName,
      replyTo: sender.replyTo,
    });

    return NextResponse.json({ ok: true, sentTo: recipient });
  } catch (err: any) {
    return handleApiError(err);
  }
}
