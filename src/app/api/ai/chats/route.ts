import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET  /api/ai/chats            — list the current user's chats (?archived=1 for the archive)
 * POST /api/ai/chats            — create a new (empty) chat
 * Per-user: RLS scopes to the tenant, and we additionally filter by user_id so
 * one RM never sees another's assistant history.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNull, isNotNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { aiChats } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const archived = req.nextUrl.searchParams.get("archived") === "1";
    const rows = await withTenant(session.tenantId, async (tx) =>
      tx
        .select({
          id: aiChats.id,
          title: aiChats.title,
          model: aiChats.model,
          archivedAt: aiChats.archivedAt,
          lastMessageAt: aiChats.lastMessageAt,
          createdAt: aiChats.createdAt,
        })
        .from(aiChats)
        .where(
          and(
            eq(aiChats.userId, session.userId),
            archived ? isNotNull(aiChats.archivedAt) : isNull(aiChats.archivedAt)
          )
        )
        .orderBy(desc(aiChats.lastMessageAt), desc(aiChats.createdAt))
        .limit(200)
    );
    return NextResponse.json({ chats: rows });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST() {
  try {
    const session = await requireSession();
    const row = await withTenant(session.tenantId, async (tx) => {
      const [r] = await tx
        .insert(aiChats)
        .values({ tenantId: session.tenantId, userId: session.userId } as any)
        .returning({ id: aiChats.id, title: aiChats.title, model: aiChats.model });
      return r;
    });
    return NextResponse.json({ chat: row }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
