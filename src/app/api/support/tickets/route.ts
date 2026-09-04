import { handleApiError } from "@/lib/api/error-handler";
/**
 * Support tickets — MFD users raise tickets to Equitywala.
 *
 *   GET  /api/support/tickets    — list tickets raised by this tenant
 *   POST /api/support/tickets    — raise a new ticket
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { supportTickets } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  subject: z.string().min(2).max(300),
  description: z.string().max(5000).optional(),
  category: z.enum(["bug", "feature_request", "billing", "training", "integration", "data_help", "other"]).default("other"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
});

export async function GET() {
  try {
    const session = await requireSession();
    const rows = await withTenant(session.tenantId, async (tx) => {
      return tx
        .select()
        .from(supportTickets)
        .where(eq(supportTickets.tenantId, session.tenantId))
        .orderBy(desc(supportTickets.createdAt))
        .limit(50);
    });
    return NextResponse.json({ tickets: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

    const id = uuid();
    await withTenant(session.tenantId, async (tx) => {
      await tx.insert(supportTickets).values({
        id,
        tenantId: session.tenantId,
        raisedByUserId: session.userId,
        ...parse.data,
      } as any);
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
