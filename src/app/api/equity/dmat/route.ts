/**
 * GET  /api/equity/dmat  → list DMAT accounts
 * POST /api/equity/dmat  → create { clientName, dmatNumber?, broker?, openedDate, status? }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { listDmat, createDmat } from "@/lib/equity/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    const rows = await withTenant(session.tenantId, async (tx) => listDmat(tx));
    return NextResponse.json({ accounts: rows });
  } catch (err) {
    return handleApiError(err);
  }
}

const CreateBody = z.object({
  clientName: z.string().trim().min(1).max(160),
  dmatNumber: z.string().trim().max(60).nullish(),
  broker: z.string().trim().max(80).nullish(),
  openedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["active", "dormant", "closed"]).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["reports.business", "reports.manage"], session.permissions);
    const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });
    const row = await withTenant(session.tenantId, async (tx) => createDmat(tx, session.tenantId, parsed.data));
    return NextResponse.json({ id: row.id }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
