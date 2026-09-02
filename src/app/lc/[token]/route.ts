/**
 * GET /lc/[token]  — email link click-tracking redirect.
 *
 * Verifies the signed token, records the click against the originating
 * communication (first click stamps `clicked_at` and bumps the campaign's
 * `clicked_count`), then 302s to the real destination. Recording is best-effort
 * — a DB hiccup must never strand the user, so we always redirect to the URL
 * carried in the (signed, tamper-proof) token.
 *
 * Runs in system context (no session — the click comes from the recipient's mail
 * client), keyed by the communication id baked into the signed token.
 *
 * NB: lives at /lc/ (not /r/, which is the public risk-profile questionnaire).
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { verifyClickToken } from "@/lib/comms/click-tracking";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const payload = verifyClickToken(token);
  // Invalid/forged token → never redirect to an unverified place (open-redirect
  // guard); send the user home instead.
  if (!payload) {
    return NextResponse.redirect(new URL("/", req.nextUrl.origin), 302);
  }

  try {
    await withSystem(async (tx) => {
      const res = await tx.execute(sql`
        UPDATE communications
        SET clicked_at = now()
        WHERE id = ${payload.c}::uuid AND clicked_at IS NULL
        RETURNING campaign_id
      `);
      const row = res.rows?.[0] as { campaign_id?: string } | undefined;
      if (row?.campaign_id) {
        await tx.execute(sql`
          UPDATE campaigns
          SET clicked_count = COALESCE(clicked_count, 0) + 1, updated_at = now()
          WHERE id = ${row.campaign_id}::uuid
        `);
      }
    });
  } catch {
    // swallow — recording is best-effort; the redirect must still happen
  }

  return NextResponse.redirect(payload.u, 302);
}
