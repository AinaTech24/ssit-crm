import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/investors/[id]/statement/send
 *   body: { channel: 'email' | 'whatsapp' }
 *
 * Thin wrapper over sendInvestorStatement() (shared with the scheduled
 * auto-statement worker). email → PDF attachment via Resend; whatsapp → wa.me
 * summary URL. Both write a communications audit row.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { sendInvestorStatement } from "@/lib/finance/send-statement";

export const dynamic = "force-dynamic";

const Body = z.object({ channel: z.enum(["email", "whatsapp"]) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

    const result = await withTenant(
      session.tenantId,
      async (tx) =>
        sendInvestorStatement(tx, {
          tenantId: session.tenantId,
          investorId: id,
          channel: parse.data.channel,
          actorUserId: session.userId,
        }),
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
