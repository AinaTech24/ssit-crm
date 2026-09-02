import { handleApiError } from "@/lib/api/error-handler";
/**
 * Holiday master — per-tenant list of non-working days.
 *
 *   GET    /api/attendance/holidays            — list (optional ?year=YYYY), ordered by date
 *   POST   /api/attendance/holidays            — add { date, name, isOptional? }
 *   DELETE /api/attendance/holidays?id=...      — remove one
 *
 * Read is allowed for any authenticated user. Add/Delete require a manager
 * (owner / branch_head).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { holidays } from "@/db/schema";

export const dynamic = "force-dynamic";

const AddBody = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
  name: z.string().trim().min(1).max(120),
  isOptional: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const yearParam = req.nextUrl.searchParams.get("year");
    const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null;

    const rows = await withTenant(session.tenantId, async (tx) => {
      const conds = [eq(holidays.tenantId, session.tenantId)];
      if (year !== null) {
        conds.push(gte(holidays.holidayDate, `${year}-01-01`));
        conds.push(lte(holidays.holidayDate, `${year}-12-31`));
      }
      return tx
        .select()
        .from(holidays)
        .where(and(...conds))
        .orderBy(asc(holidays.holidayDate));
    });

    return NextResponse.json({ holidays: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const isManager = session.roles.some((r) => ["owner", "branch_head"].includes(r));
    if (!isManager) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const parse = AddBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const { name } = parse.data;
    const date = parse.data.date;
    const isOptional = parse.data.isOptional ?? false;
    const clientMeta = clientMetaFromHeaders(req.headers);

    const row = await withTenant(session.tenantId, async (tx) => {
      const inserted = await tx
        .insert(holidays)
        .values({ tenantId: session.tenantId, holidayDate: date, name, isOptional })
        .onConflictDoUpdate({
          target: [holidays.tenantId, holidays.holidayDate],
          set: { name, isOptional, updatedAt: new Date() },
        })
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "holiday.add",
        entityType: "holiday",
        entityId: inserted[0]?.id ?? session.tenantId,
        after: { date, name, isOptional } as any,
        ...clientMeta,
      });
      return inserted[0];
    });

    return NextResponse.json({ ok: true, holiday: row });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    const isManager = session.roles.some((r) => ["owner", "branch_head"].includes(r));
    if (!isManager) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);

    const deleted = await withTenant(session.tenantId, async (tx) => {
      const rows = await tx
        .delete(holidays)
        .where(and(eq(holidays.tenantId, session.tenantId), eq(holidays.id, id)))
        .returning();
      if (rows.length) {
        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "holiday.delete",
          entityType: "holiday",
          entityId: id,
          before: { date: rows[0].holidayDate, name: rows[0].name } as any,
          ...clientMeta,
        });
      }
      return rows[0] ?? null;
    });

    if (!deleted) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
