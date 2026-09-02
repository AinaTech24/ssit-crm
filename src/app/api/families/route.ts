import { handleApiError } from "@/lib/api/error-handler";
/**
 * Families collection.
 *
 *   GET  /api/families        — list all families with member counts
 *   POST /api/families        — create a new family group
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny, can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { families, users } from "@/db/schema";
import { familyHealthFields } from "@/lib/families/health";
import { computeFamilyNextReview } from "@/lib/families/cadence";
import { WEALTH_BANDS, bandBounds, type WealthBand } from "@/lib/families/wealth-band";

const PAGE_SIZE = 50;

export const dynamic = "force-dynamic";

const Body = z.object({
  headName: z.string().min(2).max(120),
  familyName: z.string().min(2).max(120).optional(),
  primaryInvestorId: z.string().uuid().optional(),
  rmId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
  familyCode: z.string().max(60).optional(),
  familyCategory: z.enum(["HNI", "Affluent", "Retail", "NRI", "Corporate"]).optional(),
  reviewFrequency: z.enum(["monthly", "quarterly", "half_yearly", "annual"]).optional(),
  firstMeetingDate: z.string().optional(), // YYYY-MM-DD
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    // Households carry client PII (member names, PAN via search, AUM rollup).
    // Require an investor-view capability and scope non-managers to their own.
    requireAny(session.roles, ["family.view", "investor.view.all", "investor.view.assigned"], session.permissions);
    const canViewAll = can(session.roles, "investor.view.all", session.permissions);

    const url = req.nextUrl;
    const g = (k: string) => url.searchParams.get(k) ?? "";
    const q = g("q").trim();
    const band = (WEALTH_BANDS as readonly string[]).includes(g("band")) ? (g("band") as WealthBand) : "";
    const sortKey = g("sort") === "health" ? "health" : "aum";
    const page = Math.max(1, parseInt(g("page") || "1", 10) || 1);
    const qf = {
      mine: g("mine") === "1",
      no_primary: g("no_primary") === "1",
      no_rm: g("no_rm") === "1",
      review_due: g("review_due") === "1",
      nominee_gap: g("nominee_gap") === "1",
      has_minor: g("has_minor") === "1",
      hni: g("hni") === "1",
      single: g("single") === "1",
      large: g("large") === "1",
      red_health: g("red_health") === "1",
    };
    const userId = session.userId;

    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        const where: any[] = [];
        if (!canViewAll) where.push(sql`f.rm_id = ${userId}::uuid`);
        if (q) {
          where.push(sql`(
            f.head_name ILIKE ${`%${q}%`}
            OR f.family_name ILIKE ${`%${q}%`}
            OR EXISTS (
              SELECT 1 FROM investors mi WHERE mi.family_id = f.id AND mi.deleted_at IS NULL
                AND (mi.name ILIKE ${`%${q}%`} OR mi.pan ILIKE ${`%${q.toUpperCase()}%`})
            )
          )`);
        }
        if (qf.mine) where.push(sql`f.rm_id = ${userId}::uuid`);
        if (qf.no_primary) where.push(sql`f.primary_investor_id IS NULL`);
        if (qf.no_rm) where.push(sql`f.rm_id IS NULL`);
        if (qf.review_due) where.push(sql`(f.next_review_at IS NULL OR f.next_review_at <= now())`);
        if (qf.red_health) where.push(sql`f.health_band = 'red'`);

        const having: any[] = [];
        if (qf.nominee_gap) having.push(sql`BOOL_OR(i.status = 'active' AND (i.nominee_name IS NULL OR i.nominee_name = '')) = true`);
        if (qf.has_minor) having.push(sql`BOOL_OR(i.is_minor = true) = true`);
        if (qf.hni) having.push(sql`BOOL_OR(i.segment_tag = 'HNI') = true`);
        if (qf.single) having.push(sql`COUNT(i.id) FILTER (WHERE i.status = 'active') = 1`);
        if (qf.large) having.push(sql`COUNT(i.id) FILTER (WHERE i.status = 'active') >= 5`);
        if (band) {
          const b = bandBounds(band);
          const aumExpr = sql.raw(`COALESCE(SUM(i.aum::numeric) FILTER (WHERE i.status = 'active'), 0)`);
          having.push(b.max == null ? sql`${aumExpr} >= ${b.min}` : sql`${aumExpr} >= ${b.min} AND ${aumExpr} < ${b.max}`);
        }

        const whereSql = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;
        const havingSql = having.length ? sql`HAVING ${sql.join(having, sql` AND `)}` : sql``;
        const orderSql = sortKey === "health"
          ? sql`f.health_score ASC, family_aum DESC NULLS LAST`
          : sql`family_aum DESC NULLS LAST`;

        const rowsRes = await tx.execute(sql`
          SELECT
            f.id, f.head_name, f.family_name, f.notes, f.primary_investor_id,
            f.rm_id, f.family_code, f.family_category, f.review_frequency,
            f.last_review_at, f.next_review_at, f.health_score, f.health_band,
            f.created_at, f.updated_at,
            u.name AS rm_name,
            COUNT(i.id) FILTER (WHERE i.status = 'active')::int AS member_count,
            COUNT(i.id) FILTER (WHERE i.status = 'active' AND (i.nominee_name IS NULL OR i.nominee_name = ''))::int AS nominee_gap_count,
            COUNT(i.id) FILTER (WHERE i.status = 'active' AND i.kyc_status = 'verified')::int AS kyc_verified_count,
            COALESCE(SUM(i.aum::numeric) FILTER (WHERE i.status = 'active'), 0)::numeric AS family_aum,
            COALESCE(SUM(i.active_sip_amount::numeric) FILTER (WHERE i.status = 'active'), 0)::numeric AS family_sip,
            BOOL_OR(i.segment_tag = 'HNI') AS has_hni
          FROM families f
          LEFT JOIN investors i ON i.family_id = f.id AND i.deleted_at IS NULL
          LEFT JOIN users u ON u.id = f.rm_id
          ${whereSql}
          GROUP BY f.id, u.name
          ${havingSql}
          ORDER BY ${orderSql}
          LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}
        `);

        const countRes = await tx.execute(sql`
          SELECT COUNT(*)::int AS c FROM (
            SELECT f.id FROM families f
            LEFT JOIN investors i ON i.family_id = f.id AND i.deleted_at IS NULL
            ${whereSql} GROUP BY f.id ${havingSql}
          ) sub
        `);

        // KPI + quick-filter + wealth-band counts, all in one grouped roll-up
        // (scoped to the owner slice for non-managers).
        const scope = canViewAll ? sql`` : sql`AND f.rm_id = ${userId}::uuid`;
        const statsRes = await tx.execute(sql`
          WITH fam AS (
            SELECT f.id, f.primary_investor_id, f.rm_id, f.next_review_at, f.health_band,
              COUNT(i.id) FILTER (WHERE i.status = 'active') AS active_members,
              COUNT(i.id) FILTER (WHERE i.status = 'active' AND (i.nominee_name IS NULL OR i.nominee_name = '')) AS nominee_gap,
              COALESCE(SUM(i.aum::numeric) FILTER (WHERE i.status = 'active'), 0) AS family_aum,
              COALESCE(SUM(i.active_sip_amount::numeric) FILTER (WHERE i.status = 'active'), 0) AS family_sip,
              BOOL_OR(i.segment_tag = 'HNI') AS has_hni,
              BOOL_OR(i.is_minor = true) AS has_minor
            FROM families f LEFT JOIN investors i ON i.family_id = f.id AND i.deleted_at IS NULL
            WHERE f.tenant_id = ${session.tenantId}::uuid ${scope}
            GROUP BY f.id
          )
          SELECT
            COUNT(*)::int AS total_families,
            COALESCE(SUM(family_aum), 0)::numeric AS combined_aum,
            COALESCE(SUM(family_sip), 0)::numeric AS combined_sip,
            COALESCE(AVG(active_members), 0)::numeric AS avg_members,
            COUNT(*) FILTER (WHERE primary_investor_id IS NULL)::int AS no_primary,
            COUNT(*) FILTER (WHERE rm_id IS NULL)::int AS no_rm,
            COUNT(*) FILTER (WHERE next_review_at IS NULL OR next_review_at <= now())::int AS review_due,
            COUNT(*) FILTER (WHERE nominee_gap > 0)::int AS nominee_gap,
            COUNT(*) FILTER (WHERE has_hni)::int AS hni,
            COUNT(*) FILTER (WHERE has_minor)::int AS has_minor,
            COUNT(*) FILTER (WHERE rm_id = ${userId}::uuid)::int AS mine,
            COUNT(*) FILTER (WHERE active_members = 1)::int AS single,
            COUNT(*) FILTER (WHERE active_members >= 5)::int AS large,
            COUNT(*) FILTER (WHERE health_band = 'red')::int AS red_health,
            COUNT(*) FILTER (WHERE family_aum >= 50000000)::int AS band_super_hni,
            COUNT(*) FILTER (WHERE family_aum >= 10000000 AND family_aum < 50000000)::int AS band_hni,
            COUNT(*) FILTER (WHERE family_aum >= 2500000 AND family_aum < 10000000)::int AS band_upper_middle,
            COUNT(*) FILTER (WHERE family_aum >= 1 AND family_aum < 2500000)::int AS band_middle,
            COUNT(*) FILTER (WHERE family_aum = 0)::int AS band_empty
          FROM fam
        `);
        const s = (statsRes.rows[0] ?? {}) as any;
        return {
          families: rowsRes.rows,
          total: Number((countRes.rows[0] as any)?.c ?? 0),
          stats: s,
          bands: {
            super_hni: Number(s.band_super_hni ?? 0),
            hni: Number(s.band_hni ?? 0),
            upper_middle: Number(s.band_upper_middle ?? 0),
            middle: Number(s.band_middle ?? 0),
            empty: Number(s.band_empty ?? 0),
          },
        };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    return NextResponse.json({ families: data.families, total: data.total, page, limit: PAGE_SIZE, stats: data.stats, bands: data.bands });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // A household is grouped by whoever services it: an RM builds families out
    // of their own book, so investor.edit.assigned is enough. Requiring
    // .edit.all here blocked every RM and team member from creating one.
    requireAny(session.roles, ["family.create", "family.manage", "investor.edit.all", "investor.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });

    const id = uuid();
    const clientMeta = clientMetaFromHeaders(req.headers);
    // Auto-derive the next household review from the cadence + first meeting.
    const nextReviewAt = computeFamilyNextReview(
      parse.data.firstMeetingDate ?? null,
      parse.data.reviewFrequency ?? null
    );
    const outcome = await withTenant(session.tenantId, async (tx) => {
      // An explicit RM must be a user in THIS firm — otherwise the household
      // would be owned by an out-of-tenant uuid.
      if (parse.data.rmId) {
        const [u] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, parse.data.rmId), eq(users.tenantId, session.tenantId)))
          .limit(1);
        if (!u) return "bad_rm" as const;
      }
      await tx.insert(families).values({
        id,
        tenantId: session.tenantId,
        branchId: session.branchId,
        headName: parse.data.headName,
        familyName: parse.data.familyName ?? parse.data.headName,
        primaryInvestorId: parse.data.primaryInvestorId ?? null,
        rmId: parse.data.rmId ?? session.userId,
        notes: parse.data.notes,
        familyCode: parse.data.familyCode ?? null,
        familyCategory: parse.data.familyCategory ?? null,
        reviewFrequency: parse.data.reviewFrequency ?? null,
        firstMeetingDate: parse.data.firstMeetingDate ?? null,
        nextReviewAt: nextReviewAt ?? null,
        // Initial health (no members yet ⇒ reflects the setup backlog).
        ...familyHealthFields(
          {
            primaryInvestorId: parse.data.primaryInvestorId ?? null,
            rmId: parse.data.rmId ?? session.userId,
            lastReviewAt: null,
            nextReviewAt: nextReviewAt ?? null,
          },
          []
        ),
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "family.create",
        entityType: "family",
        entityId: id,
        after: {
          headName: parse.data.headName,
          familyName: parse.data.familyName,
        },
        ...clientMeta,
      });
      return "ok" as const;
    });
    if (outcome === "bad_rm") return NextResponse.json({ error: "selected RM is not a user in this firm" }, { status: 400 });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
