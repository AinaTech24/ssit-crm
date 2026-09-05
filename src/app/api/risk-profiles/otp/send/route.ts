import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/risk-profiles/otp/send  { investorId, email? }
 *
 * Session-gated (RM) counterpart of the public risk-profile OTP: emails a
 * 6-digit code to the CLIENT to authenticate them before the RM fills in the
 * in-app risk questionnaire. Reuses the public_email_otps table keyed by the
 * investor id (one active code per client). The client's on-file email always
 * wins; if none is stored the RM may supply one (returned needEmail=true).
 *
 * The code is never logged or returned — only sha256(code+secret) is stored.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { investors, publicEmailOtps, tenants } from "@/db/schema";
import { emailAdapter } from "@/lib/comms/adapters/resend";
import { resolveEmailSender } from "@/lib/comms/sender";
import { emailLogoHeaderHtml } from "@/lib/comms/email-logo";
import {
  generateOtpCode,
  hashOtpCode,
  isValidEmail,
  maskEmail,
  OTP_RESEND_COOLDOWN_SEC,
  OTP_TTL_MS,
} from "@/lib/public-otp";
import { enforce } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const esc = (s: string) =>
  (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const Body = z.object({
  investorId: z.string().uuid(),
  email: z.string().trim().max(160).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "risk_profile.manage", session.permissions);
    const limited = enforce(req, "risk-profile-otp-send", { limit: 30, windowSec: 60 * 60 });
    if (limited) return limited;

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const { investorId, email: bodyEmail } = parsed.data;
    const now = new Date();

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [inv] = await tx
        .select({ id: investors.id, email: investors.email })
        .from(investors)
        .where(eq(investors.id, investorId))
        .limit(1);
      if (!inv) return { kind: "error" as const, status: 404, error: "Client not found." };

      const onFile = (inv.email ?? "").trim();
      let dest: string;
      if (isValidEmail(onFile)) {
        dest = onFile;
      } else {
        const supplied = (bodyEmail ?? "").trim();
        if (!supplied) {
          return { kind: "needEmail" as const, error: "No email on file — enter the client's email to send the code." };
        }
        if (!isValidEmail(supplied)) return { kind: "error" as const, status: 400, error: "Enter a valid email address." };
        dest = supplied;
      }

      // One unverified code per client per 60s.
      const [existing] = await tx.select().from(publicEmailOtps).where(eq(publicEmailOtps.tokenId, investorId));
      if (existing && !existing.verifiedAt) {
        const ageSec = (now.getTime() - new Date(existing.createdAt as any).getTime()) / 1000;
        if (ageSec < OTP_RESEND_COOLDOWN_SEC) {
          return { kind: "throttled" as const, retryInSeconds: Math.max(1, Math.ceil(OTP_RESEND_COOLDOWN_SEC - ageSec)) };
        }
      }

      const code = generateOtpCode();
      const otpRow = {
        tenantId: session.tenantId,
        tokenId: investorId,
        email: dest,
        codeHash: hashOtpCode(code),
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        attempts: 0,
        verifiedAt: null as Date | null,
        createdAt: now,
      };
      await tx.insert(publicEmailOtps).values(otpRow).onConflictDoUpdate({
        target: publicEmailOtps.tokenId,
        set: { email: dest, codeHash: otpRow.codeHash, expiresAt: otpRow.expiresAt, attempts: 0, verifiedAt: null, createdAt: now },
      });

      const tenant = (await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0] ?? null;
      let sender: any;
      sender = await resolveEmailSender(tx, session.tenantId, session.userId);
      return { kind: "send" as const, code, dest, tenant, sender };
    });

    if (outcome.kind === "throttled") {
      return NextResponse.json({ error: "Please wait before requesting another code.", retryInSeconds: outcome.retryInSeconds }, { status: 429 });
    }
    if (outcome.kind === "needEmail") {
      return NextResponse.json({ error: outcome.error, needEmail: true }, { status: 400 });
    }
    if (outcome.kind === "error") {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }

    // Send AFTER commit — a failed send never rolls back the stored code.
    const { code, dest, tenant, sender } = outcome;
    const firmName = (tenant as any)?.displayName ?? (tenant as any)?.legalName ?? "Your advisor";
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a;">
      ${emailLogoHeaderHtml((tenant as any)?.logoUrl, firmName)}
      <p style="margin:0 0 8px;font-size:14px;">Your verification code:</p>
      <p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:8px;font-family:Consolas,Menlo,monospace;">${esc(code)}</p>
      <p style="margin:0 0 4px;font-size:13px;color:#334155;">Valid for 10 minutes — to confirm your risk profile with your advisor.</p>
      <p style="margin:0;font-size:13px;color:#334155;">If this wasn't you, ignore this email.</p>
      <p style="font-size:11px;color:#64748b;margin-top:20px;border-top:1px solid #e2e8f0;padding-top:10px;">${esc(firmName)}</p>
    </div>`;

    try {
      await emailAdapter.send({
        tenantId: session.tenantId,
        tokens: {},
        rendered: { subject: `${firmName} — your verification code`, text: `Your verification code is ${code}. Valid for 10 minutes. If this wasn't you, ignore this email.`, tokens: {} },
        recipient: dest,
        category: "transactional",
        inlineHtml: html,
        idempotencyKey: `rpotp-rm:${investorId}:${now.getTime()}`,
        smtp: (sender as any).smtp,
        fromOverride: (sender as any).fromEmail || undefined,
        fromNameOverride: (sender as any).fromName || firmName,
        replyTo: (sender as any).replyTo || undefined,
      } as any);
    } catch (e: any) {
      console.error(`[risk-profiles/otp/send] send failed for investor ${investorId}:`, String(e?.message ?? ""));
      return NextResponse.json({ error: "Couldn't send the code right now — please try again in a minute." }, { status: 502 });
    }

    return NextResponse.json({ ok: true, maskedEmail: maskEmail(dest), resendInSeconds: OTP_RESEND_COOLDOWN_SEC });
  } catch (err) {
    return handleApiError(err);
  }
}
