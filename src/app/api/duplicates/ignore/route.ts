import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { ignoredDuplicates, investors, families } from "@/db/schema";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

const isManager = (roles: string[]) => roles.some((r) => ["owner", "branch_head"].includes(r));

const Body = z.object({
  entityType: z.enum(["client", "family"]),
  memberIds: z.array(z.string().uuid()).min(2).max(50),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!isManager(session.roles)) {
      return NextResponse.json({ error: "only owners / branch heads can dismiss duplicates" }, { status: 403 });
    }
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const { entityType, memberIds } = parse.data;

    const ids = [...memberIds].sort();
    const meta = clientMetaFromHeaders(req.headers);

    await withTenant(session.tenantId, async (tx) => {
      // Validate every id is a real entity in THIS tenant before recording
      // ignore pairs — avoids junk rows for foreign / bogus ids.
      const found =
        entityType === "client"
          ? await tx.select({ id: investors.id }).from(investors).where(and(eq(investors.tenantId, session.tenantId), inArray(investors.id, ids)))
          : await tx.select({ id: families.id }).from(families).where(and(eq(families.tenantId, session.tenantId), inArray(families.id, ids)));
      if (found.length !== ids.length) {
        throw Object.assign(new Error("one or more records not found in this firm"), { status: 400 });
      }

      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const key1 = ids[i];
          const key2 = ids[j];
          await tx.insert(ignoredDuplicates).values({
            tenantId: session.tenantId,
            entityType,
            key1,
            key2,
          }).onConflictDoNothing();
        }
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "duplicate.ignore",
        entityType,
        entityId: ids[0],
        after: { entityType, memberIds: ids } as any,
        ...meta,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
