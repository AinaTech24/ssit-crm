import { handleApiError } from "@/lib/api/error-handler";
/**
 * Client engagement — firm-wide gift log.
 *
 *   GET  /api/engagement/gifts?month=YYYY-MM   — rows for the month + counters
 *   POST /api/engagement/gifts                 — log a gift for any client
 *
 * The per-client endpoint (/api/investors/[id]/gifts) is the same table seen
 * from one client's record. This one is the firm's view: who sent what, from
 * whose desk, on which day. Raw SQL for the same reason that route uses it —
 * client_gifts has no Drizzle schema (migration 0159).
 *
 * The RM is resolved from the client SERVER-SIDE. The form shows it so the user
 * knows whose number this lands on, but a posted rmId is ignored: engagement
 * counts are attribution, and attribution the caller can choose is not
 * attribution.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { notifyGiftDelivered } from "@/lib/gifts/notify";
import { GIFT_CATEGORIES, giftLabel, isValidGrade } from "@/lib/gifts/catalogue";

export const dynamic = "force-dynamic";

/**
 * The shapes the raw SQL below returns. client_gifts has no Drizzle schema, so
 * these stand in for the inferred row types the rest of the codebase gets for
 * free — snake_case, because that is what the driver hands back.
 */
type GiftRowSql = {
  id: string;
  investor_id: string;
  category: string | null;
  grade: string | null;
  occasion: string;
  title: string;
  amount: number | string;
  given_on: string;
  delivered_on: string | null;
  notes: string | null;
  client_name: string | null;
  rm_name: string | null;
};
type TotalsSql = {
  total: number;
  today: number;
  month: number;
  year: number;
  delivered: number;
  spend_ytd: number;
};
type PerRmSql = { rm_id: string | null; rm_name: string; day: number; month: number; year: number; total: number };
type ByCategorySql = { category: string; grade: string; n: number };
type InsertedGiftSql = {
  id: string;
  category: string | null;
  grade: string | null;
  title: string;
  amount: number | string;
  given_on: string;
  delivered_on: string | null;
};

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected yyyy-mm-dd");
const MonthStr = z.string().regex(/^\d{4}-\d{2}$/, "expected yyyy-mm");

const AddBody = z.object({
  investorId: z.string().uuid(),
  category: z.enum(GIFT_CATEGORIES),
  grade: z.string().max(4).nullish(),
  occasion: z.enum(["birthday", "anniversary", "festival", "other"]).default("birthday"),
  amount: z.number().int().min(0).default(0),
  givenOn: DateStr,
  deliveredOn: DateStr.nullish(),
  notes: z.string().max(500).nullish(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    // Engagement is a management view of the whole firm's gifting.
    requireAny(session.roles, ["investor.view.all"], session.permissions);

    const monthParse = MonthStr.safeParse(req.nextUrl.searchParams.get("month") ?? "");
    const month = monthParse.success ? monthParse.data : new Date().toISOString().slice(0, 7);
    const monthStart = `${month}-01`;

    const data = await withTenant(session.tenantId, async (tx) => {
      // One month of gifts, for the calendar and the recent-activity list.
      const rows = (
        await tx.execute(sql`
          SELECT g.id, g.investor_id, g.category, g.grade, g.occasion, g.title,
                 g.amount, g.given_on, g.delivered_on, g.notes,
                 i.name AS client_name,
                 u.name AS rm_name
            FROM client_gifts g
            JOIN investors i ON i.id = g.investor_id
            LEFT JOIN users u ON u.id = g.rm_id
           WHERE g.tenant_id = ${session.tenantId}::uuid
             AND g.given_on >= ${monthStart}::date
             AND g.given_on < (${monthStart}::date + interval '1 month')
           ORDER BY g.given_on DESC, g.created_at DESC
        `)
      ).rows as unknown as GiftRowSql[];

      // Firm-level counters. `current_date` is the server's day — good enough
      // for an engagement tally, and it keeps the whole thing one round trip.
      const totals = (
        await tx.execute(sql`
          SELECT
            count(*)::int                                                          AS total,
            count(*) FILTER (WHERE given_on = current_date)::int                   AS today,
            count(*) FILTER (WHERE given_on >= date_trunc('month', current_date))::int AS month,
            count(*) FILTER (WHERE given_on >= date_trunc('year', current_date))::int  AS year,
            count(*) FILTER (WHERE delivered_on IS NOT NULL)::int                  AS delivered,
            COALESCE(SUM(amount) FILTER (WHERE given_on >= date_trunc('year', current_date)), 0)::int AS spend_ytd
          FROM client_gifts
          WHERE tenant_id = ${session.tenantId}::uuid
        `)
      ).rows[0] as unknown as TotalsSql | undefined;

      // Per-RM day / month / year. Gifts whose RM was never captured (rows
      // predating migration 0210) group under a null RM rather than vanishing.
      const perRm = (
        await tx.execute(sql`
          SELECT g.rm_id,
                 COALESCE(u.name, 'Unassigned')                                        AS rm_name,
                 count(*) FILTER (WHERE g.given_on = current_date)::int                AS day,
                 count(*) FILTER (WHERE g.given_on >= date_trunc('month', current_date))::int AS month,
                 count(*) FILTER (WHERE g.given_on >= date_trunc('year', current_date))::int  AS year,
                 count(*)::int                                                         AS total
            FROM client_gifts g
            LEFT JOIN users u ON u.id = g.rm_id
           WHERE g.tenant_id = ${session.tenantId}::uuid
           GROUP BY g.rm_id, u.name
           ORDER BY year DESC, total DESC
        `)
      ).rows as unknown as PerRmSql[];

      const byCategory = (
        await tx.execute(sql`
          SELECT COALESCE(category, 'uncategorised') AS category,
                 COALESCE(grade, '—')               AS grade,
                 count(*)::int                      AS n
            FROM client_gifts
           WHERE tenant_id = ${session.tenantId}::uuid
             AND given_on >= date_trunc('year', current_date)
           GROUP BY 1, 2
           ORDER BY n DESC
        `)
      ).rows as unknown as ByCategorySql[];

      return { rows, totals, perRm, byCategory };
    });

    return NextResponse.json({
      month,
      gifts: data.rows.map((r) => ({
        id: r.id,
        investorId: r.investor_id,
        clientName: r.client_name,
        rmName: r.rm_name,
        category: r.category,
        grade: r.grade,
        label: giftLabel(r.category, r.grade),
        occasion: r.occasion,
        title: r.title,
        amount: Number(r.amount ?? 0),
        givenOn: r.given_on,
        deliveredOn: r.delivered_on,
        notes: r.notes,
      })),
      totals: {
        total: Number(data.totals?.total ?? 0),
        today: Number(data.totals?.today ?? 0),
        month: Number(data.totals?.month ?? 0),
        year: Number(data.totals?.year ?? 0),
        delivered: Number(data.totals?.delivered ?? 0),
        spendYtd: Number(data.totals?.spend_ytd ?? 0),
      },
      perRm: data.perRm.map((r) => ({
        rmId: r.rm_id,
        rmName: r.rm_name,
        day: Number(r.day ?? 0),
        month: Number(r.month ?? 0),
        year: Number(r.year ?? 0),
        total: Number(r.total ?? 0),
      })),
      byCategory: data.byCategory.map((r) => ({
        category: r.category,
        grade: r.grade,
        count: Number(r.n ?? 0),
      })),
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.edit.all", "investor.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = AddBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const b = parse.data;
    if (!isValidGrade(b.category, b.grade)) {
      return NextResponse.json(
        { error: `grade ${b.grade} is not available for a ${b.category}` },
        { status: 400 }
      );
    }
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const invRes = await tx.execute(sql`
        SELECT name, rm_id FROM investors
        WHERE id = ${b.investorId}::uuid AND tenant_id = ${session.tenantId}::uuid
        LIMIT 1
      `);
      if (invRes.rows.length === 0) return null;
      const inv = invRes.rows[0] as { name: string | null; rm_id: string | null };

      // `title` is NOT NULL on the table and is what the older per-client UI
      // renders, so keep it populated from the catalogue label.
      const title = giftLabel(b.category, b.grade);

      const ins = await tx.execute(sql`
        INSERT INTO client_gifts
          (tenant_id, investor_id, category, grade, rm_id, occasion, title, amount, given_on, delivered_on, notes, created_by)
        VALUES (
          ${session.tenantId}::uuid,
          ${b.investorId}::uuid,
          ${b.category},
          ${b.grade ?? null},
          ${inv.rm_id}::uuid,
          ${b.occasion},
          ${title},
          ${b.amount},
          ${b.givenOn}::date,
          ${b.deliveredOn ?? null}::date,
          ${b.notes ?? null},
          ${session.userId}::uuid
        )
        RETURNING id, category, grade, title, amount, given_on, delivered_on
      `);
      const g = ins.rows[0] as unknown as InsertedGiftSql;

      if (g.delivered_on) {
        const sent = await notifyGiftDelivered(tx, {
          tenantId: session.tenantId,
          rmId: inv.rm_id,
          giftId: g.id,
          investorId: b.investorId,
          clientName: inv.name ?? "this client",
          giftTitle: g.title,
          amount: Number(g.amount ?? 0),
          onDate: g.delivered_on,
        });
        if (sent) {
          await tx.execute(sql`UPDATE client_gifts SET rm_notified_at = now() WHERE id = ${g.id}::uuid`);
        }
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "gift.create",
        entityType: "client_gift",
        entityId: g.id,
        after: { category: b.category, grade: b.grade ?? null, investorId: b.investorId },
        ...clientMeta,
      });

      return {
        id: g.id,
        category: g.category,
        grade: g.grade,
        label: giftLabel(g.category, g.grade),
        amount: Number(g.amount ?? 0),
        givenOn: g.given_on,
        deliveredOn: g.delivered_on,
        clientName: inv.name,
      };
    });

    if (!result) return NextResponse.json({ error: "client not found" }, { status: 404 });
    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
