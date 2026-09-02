import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/command-center/snooze
 * Body: { itemKey: string, action: "1d" | "3d" | "7d" | "dismiss" | "unsnooze" }
 *
 * Per-user snooze / dismiss of a Command Center triage item. Upserts a row keyed
 * by (tenant, user, itemKey). The queue builder excludes dismissed/snoozed keys.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { commandCenterSnoozes } from "@/db/schema/command_center";

export const dynamic = "force-dynamic";

const Body = z.object({
  itemKey: z.string().min(1).max(120),
  action: z.enum(["1d", "3d", "7d", "dismiss", "unsnooze"]),
});

function untilFor(action: string): { snoozedUntil: Date | null; dismissed: boolean } {
  const now = Date.now();
  const day = 86_400_000;
  switch (action) {
    case "1d": return { snoozedUntil: new Date(now + day), dismissed: false };
    case "3d": return { snoozedUntil: new Date(now + 3 * day), dismissed: false };
    case "7d": return { snoozedUntil: new Date(now + 7 * day), dismissed: false };
    case "dismiss": return { snoozedUntil: null, dismissed: true };
    default: return { snoozedUntil: null, dismissed: false }; // unsnooze
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const { itemKey, action } = parsed.data;
    const { snoozedUntil, dismissed } = untilFor(action);

    await withTenant(session.tenantId, async (tx) => {
      if (action === "unsnooze") {
        await tx
          .delete(commandCenterSnoozes)
          .where(
            and(
              eq(commandCenterSnoozes.tenantId, session.tenantId),
              eq(commandCenterSnoozes.userId, session.userId),
              eq(commandCenterSnoozes.itemKey, itemKey)
            )
          );
        return;
      }
      await tx
        .insert(commandCenterSnoozes)
        .values({
          tenantId: session.tenantId,
          userId: session.userId,
          itemKey,
          snoozedUntil,
          dismissed,
        } as any)
        .onConflictDoUpdate({
          target: [commandCenterSnoozes.tenantId, commandCenterSnoozes.userId, commandCenterSnoozes.itemKey],
          set: { snoozedUntil, dismissed, updatedAt: new Date() },
        });
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
