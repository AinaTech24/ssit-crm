import { handleApiError } from "@/lib/api/error-handler";
/**
 * PATCH  /api/ai/chats/[id]  — rename ({title}) or archive/unarchive ({archived})
 * DELETE /api/ai/chats/[id]  — delete the chat (messages cascade)
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { aiChats } from "@/db/schema";

export const dynamic = "force-dynamic";

const Patch = z.object({
  title: z.string().min(1).max(120).optional(),
  archived: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const patch: any = { updatedAt: new Date() };
    if (parse.data.title !== undefined) patch.title = parse.data.title.trim();
    if (parse.data.archived !== undefined) patch.archivedAt = parse.data.archived ? new Date() : null;
    await withTenant(session.tenantId, async (tx) => {
      await tx
        .update(aiChats)
        .set(patch)
        .where(and(eq(aiChats.id, id), eq(aiChats.userId, session.userId)));
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    await withTenant(session.tenantId, async (tx) => {
      await tx.delete(aiChats).where(and(eq(aiChats.id, id), eq(aiChats.userId, session.userId)));
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
