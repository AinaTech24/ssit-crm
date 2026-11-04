import { handleApiError } from "@/lib/api/error-handler";
/** DELETE /api/dhandho/[id] — remove one day from the speaker schedule. Needs dhandho.manage. */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { dhandhoSessions } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "dhandho.manage", session.permissions);
    const rows = await withTenant(session.tenantId, (tx) =>
      tx
        .delete(dhandhoSessions)
        .where(and(eq(dhandhoSessions.id, id), eq(dhandhoSessions.tenantId, session.tenantId)))
        .returning({ id: dhandhoSessions.id })
    );
    if (!rows.length) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
