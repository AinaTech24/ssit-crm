import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { notifications } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  ids: z.array(z.string().uuid()).optional(),
  all: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

    await withTenant(session.tenantId, async (tx) => {
      if (parse.data.all) {
        await tx.execute(sql`
          UPDATE notifications SET read_at = now()
          WHERE user_id = ${session.userId} AND read_at IS NULL
        `);
      } else if (parse.data.ids?.length) {
        await tx
          .update(notifications)
          .set({ readAt: new Date() } as any)
          .where(and(eq(notifications.userId, session.userId), inArray(notifications.id, parse.data.ids)));
      }
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
