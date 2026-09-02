/**
 * POST /api/public/risk-profile/otp/send — email a 6-digit verification code
 * to the client filling the public risk-profile form (/r/<token>).
 *
 * No-auth route; the share token in the body is the credential (accepts the
 * URL plaintext token or the resolved token id). Destination email resolution:
 *   - if the token's subject (lead / investor) has an email on file, the code
 *     ALWAYS goes there (any body email is ignored) — the client can't divert
 *     verification to an address the RM never captured;
 *   - if no email is on file, a valid body `email` is required and used.
 *
 * Responses (contract consumed by PublicRiskForm):
 *   200 { ok: true, maskedEmail, resendInSeconds: 60 }
 *   429 { error: "Please wait a moment before requesting another code.", retryInSeconds }
 *   4xx { error }
 *
 * The code is upserted (one active code per token) inside withTenant, then the
 * email is sent AFTER the transaction commits. The code is never logged or
 * returned.
 */

import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { investors, leads, publicEmailOtps, shareTokens, tenants } from "@/db/schema";
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
  token: z.string().min(8).max(200),
  email: z.string().trim().max(160).optional(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  try {
    // Coarse abuse cap per IP — the fine-grained 60s per-token cooldown is
    // enforced below with the contract's retryInSeconds shape.
    const limited = enforce(req, "public.risk-profile-otp", { limit: 15, windowSec: 60 * 60 });
    if (limited) return limited;

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    const { token, email: bodyEmail } = parsed.data;

    // Step 1: token lookup needs cross-tenant context (no session). Tiny block,
    // mirrors the submit route's validation exactly. Accept either the URL
    // plaintext (looked up by hash) or the token id the page already resolved.
    const tk = await withSystem(async (tx) => {
      const [t] = UUID_RE.test(token)
        ? await tx.select().from(shareTokens).where(eq(shareTokens.id, token))
        : await tx
            .select()
            .from(shareTokens)
            .where(eq(shareTokens.tokenHash, crypto.createHash("sha256").update(token).digest("hex")));
      if (!t) throw new Error("Invalid token");
      if (t.revokedAt) throw new Error("This link was revoked");
      if (t.usedAt) throw new Error("This link has already been used");
      if (new Date(t.expiresAt as any) < new Date()) throw new Error("This link has expired");
      if (t.kind !== "risk_profile") throw new Error("Not a risk-profile token");
      return t;
    });

    // Step 2: everything else inside the token's tenant scope (RLS-guarded).
    const now = new Date();
    const outcome = await withTenant(tk.tenantId!, async (tx) => {
      // Destination email — subject's on-file address wins; otherwise the
      // client-supplied one.
      let onFile = "";
      if (tk.subjectType === "investor") {
        const [inv] = await tx
          .select({ email: investors.email })
          .from(investors)
          .where(eq(investors.id, tk.subjectId));
        onFile = (inv?.email ?? "").trim();
      } else if (tk.subjectType === "lead") {
        const [ld] = await tx
          .select({ email: leads.email })
          .from(leads)
          .where(eq(leads.id, tk.subjectId));
        onFile = (ld?.email ?? "").trim();
      }

      let dest: string;
      if (isValidEmail(onFile)) {
        dest = onFile;
      } else {
        const supplied = (bodyEmail ?? "").trim();
        if (!supplied) {
          return {
            kind: "error" as const,
            status: 400,
            error: "No email on file — enter your email address to receive the code.",
          };
        }
        if (!isValidEmail(supplied)) {
          return { kind: "error" as const, status: 400, error: "Enter a valid email address." };
        }
        dest = supplied;
      }

      // Resend cooldown — one unverified code per token per 60s.
      const [existing] = await tx
        .select()
        .from(publicEmailOtps)
        .where(eq(publicEmailOtps.tokenId, tk.id));
      if (existing && !existing.verifiedAt) {
        const ageSec = (now.getTime() - new Date(existing.createdAt as any).getTime()) / 1000;
        if (ageSec < OTP_RESEND_COOLDOWN_SEC) {
          return {
            kind: "throttled" as const,
            retryInSeconds: Math.max(1, Math.ceil(OTP_RESEND_COOLDOWN_SEC - ageSec)),
          };
        }
      }

      // Generate + upsert (one active code per token; resets attempts/verified).
      const code = generateOtpCode();
      await tx
        .insert(publicEmailOtps)
        .values({
          tenantId: tk.tenantId!,
          tokenId: tk.id,
          email: dest,
          codeHash: hashOtpCode(code),
          expiresAt: new Date(now.getTime() + OTP_TTL_MS),
          attempts: 0,
          verifiedAt: null,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: publicEmailOtps.tokenId,
          set: {
            email: dest,
            codeHash: hashOtpCode(code),
            expiresAt: new Date(now.getTime() + OTP_TTL_MS),
            attempts: 0,
            verifiedAt: null,
            createdAt: now,
          },
        });

      // Sender + firm identity for the email (sent after commit, below).
      const tenant =
        (await tx.select().from(tenants).where(eq(tenants.id, tk.tenantId!)).limit(1))[0] ?? null;
      let sender;
      try {
        sender = await resolveEmailSender(tx, tk.tenantId!, tk.createdBy ?? undefined);
      } catch {
        sender = { source: "resend" } as any;
      }
      return { kind: "send" as const, code, dest, tenant: tenant as any, sender };
    });

    if (outcome.kind === "throttled") {
      return NextResponse.json(
        {
          error: "Please wait a moment before requesting another code.",
          retryInSeconds: outcome.retryInSeconds,
        },
        { status: 429 }
      );
    }
    if (outcome.kind === "error") {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }

    // Step 3: send AFTER the DB transaction committed — a failed send never
    // rolls back the stored code (the client can retry after the cooldown).
    const { code, dest, tenant, sender } = outcome;
    const firmName = tenant?.displayName ?? tenant?.legalName ?? "Your advisor";
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a;">
      ${emailLogoHeaderHtml(tenant?.logoUrl, firmName)}
      <p style="margin:0 0 8px;font-size:14px;">Your verification code:</p>
      <p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:8px;font-family:Consolas,Menlo,monospace;">${esc(code)}</p>
      <p style="margin:0 0 4px;font-size:13px;color:#334155;">Valid for 10 minutes — requested from your risk-profile form.</p>
      <p style="margin:0;font-size:13px;color:#334155;">If this wasn't you, ignore this email.</p>
      <p style="font-size:11px;color:#64748b;margin-top:20px;border-top:1px solid #e2e8f0;padding-top:10px;">${esc(firmName)}</p>
    </div>`;

    try {
      await emailAdapter.send({
        tenantId: tk.tenantId!,
        tokens: {},
        rendered: {
          subject: `${firmName} — your verification code`,
          text: `Your verification code is ${code}. Valid for 10 minutes — requested from your risk-profile form. If this wasn't you, ignore this email.`,
          tokens: {},
        },
        recipient: dest,
        category: "transactional",
        inlineHtml: html,
        idempotencyKey: `rpotp:${tk.id}:${now.getTime()}`,
        smtp: (sender as any).smtp,
        apiKey: (sender as any).apiKey,
        fromOverride: (sender as any).fromEmail || undefined,
        fromNameOverride: (sender as any).fromName || firmName,
        replyTo: (sender as any).replyTo || undefined,
      } as any);
    } catch (e: any) {
      const m = String(e?.message ?? "");
      console.error(`[risk-profile/otp/send] send failed for token ${tk.id}:`, m);
      return NextResponse.json(
        { error: "Couldn't send the code right now — please try again in a minute." },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      maskedEmail: maskEmail(dest),
      resendInSeconds: OTP_RESEND_COOLDOWN_SEC,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "internal" }, { status: 400 });
  }
}
