import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/risk-profiles/otp/verify  { investorId, code }
 *
 * Verifies the 6-digit code the client received (see ./send). On success the
 * public_email_otps row for this investor is marked verified — the risk-profile
 * submit route then requires that verified row before it will save the profile
 * (and stamps verification_method = client_otp). Wrong codes count toward a
 * 5-strike limit; the code itself is never compared in plaintext.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { publicEmailOtps } from "@/db/schema";
import { otpHashMatches, maskEmail, OTP_MAX_ATTEMPTS } from "@/lib/public-otp";
import { enforce } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  investorId: z.string().uuid(),
  code: z.string().trim().regex(/^\d{4,8}$/, "Enter the numeric code"),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "risk_profile.manage", session.permissions);
    const limited = enforce(req, "risk-profile-otp-verify", { limit: 40, windowSec: 60 * 60 });
    if (limited) return limited;

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Enter the 6-digit code." }, { status: 400 });
    const { investorId, code } = parsed.data;

    const res = await withTenant(session.tenantId, async (tx) => {
      const [row] = await tx.select().from(publicEmailOtps).where(eq(publicEmailOtps.tokenId, investorId));
      if (!row) return { ok: false as const, status: 400, error: "Request a code first." };
      if (row.verifiedAt) return { ok: true as const, email: row.email };
      if (new Date(row.expiresAt as any) < new Date()) return { ok: false as const, status: 400, error: "Code expired — request a new one." };
      if (row.attempts >= OTP_MAX_ATTEMPTS) return { ok: false as const, status: 429, error: "Too many attempts — request a new code." };
      if (!otpHashMatches(code, row.codeHash)) {
        await tx.update(publicEmailOtps).set({ attempts: row.attempts + 1 }).where(eq(publicEmailOtps.tokenId, investorId));
        return { ok: false as const, status: 400, error: "Incorrect code.", remaining: Math.max(0, OTP_MAX_ATTEMPTS - (row.attempts + 1)) };
      }
      await tx.update(publicEmailOtps).set({ verifiedAt: new Date() }).where(eq(publicEmailOtps.tokenId, investorId));
      return { ok: true as const, email: row.email };
    });

    if (!res.ok) return NextResponse.json({ error: res.error, remaining: (res as any).remaining }, { status: res.status });
    return NextResponse.json({ ok: true, maskedEmail: maskEmail(res.email) });
  } catch (err) {
    return handleApiError(err);
  }
}
