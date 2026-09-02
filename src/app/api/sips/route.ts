import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/sips — manually register a SIP.
 *
 * SIPs normally flow in from the CAMS/KFintech feeds or an Excel import, but
 * MFDs also need to capture a SIP by hand (e.g. a fresh registration not yet in
 * the feed). Gated like other transaction writes (transactions.execute).
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { sips, investors, users, eventsOutbox } from "@/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/sips — JSON feed for the mobile SIP Tracker.
 *
 * Mirrors the web /dashboard/sips list: most-recent ~200 SIPs with the investor
 * name joined, excluding SIPs whose client is soft-deleted. Read-only over
 * current DB state. RLS scopes to the tenant.
 */
export async function GET() {
  try {
    const session = await requireSession();
    // SIPs expose client commitments. Managers see all; everyone else only SIPs
    // for a client they manage (investors.rm_id).
    const seesAll =
      can(session.roles, "investor.view.all", session.permissions) ||
      can(session.roles, "compliance.view", session.permissions);
    const ownScope = seesAll
      ? undefined
      : sql`${sips.investorId} IN (SELECT id FROM investors WHERE rm_id = ${session.userId}::uuid)`;

    const rows = await withTenant(
      session.tenantId,
      async (tx) => {
        return tx
          .select({
            id: sips.id,
            schemeName: sips.schemeName,
            schemeCode: sips.schemeCode,
            amcName: sips.amcName,
            amount: sips.amount,
            frequency: sips.frequency,
            status: sips.status,
            nextDate: sips.nextInstallmentAt,
            folioNumber: sips.folioNumber,
            consecutiveFailures: sips.consecutiveFailures,
            investorId: sips.investorId,
            investorName: investors.name,
          })
          .from(sips)
          .leftJoin(investors, eq(investors.id, sips.investorId))
          .where(and(isNull(investors.deletedAt), ownScope))
          .orderBy(desc(sips.nextInstallmentAt), desc(sips.createdAt))
          .limit(200);
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    // Bounce signal. `sips.consecutive_failures` is only populated by some feeds,
    // so the authoritative source is the transaction ledger — the SAME source
    // the SIP-health report counts as "bounced", which keeps the tracker and the
    // dashboard telling the same story. Matched per CLIENT (folio/scheme are
    // frequently blank in RTA rejection rows), newest reason wins.
    const failureByInvestor = await withTenant(
      session.tenantId,
      async (tx) => {
        const ids = Array.from(new Set(rows.map((r) => r.investorId).filter(Boolean))) as string[];
        if (ids.length === 0) return new Map<string, { count: number; reason: string | null; at: string | null }>();
        // Parameterized IN list — a JS array bound to ANY(...) is expanded by the
        // driver into separate params, which is not valid array syntax.
        const idList = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
        const res = await tx.execute(sql`
          SELECT investor_id,
                 COUNT(*)::int AS cnt,
                 (ARRAY_AGG(COALESCE(reason_description, reason_code) ORDER BY order_date DESC NULLS LAST))[1] AS reason,
                 MAX(order_date) AS last_at
          FROM transactions
          WHERE tenant_id = ${session.tenantId}::uuid
            AND type = 'sip' AND status = 'rejected'
            AND investor_id IN (${idList})
          GROUP BY investor_id
        `);
        const m = new Map<string, { count: number; reason: string | null; at: string | null }>();
        for (const row of res.rows as any[]) {
          m.set(String(row.investor_id), {
            count: Number(row.cnt ?? 0),
            reason: row.reason ?? null,
            at: row.last_at ? new Date(row.last_at).toISOString() : null,
          });
        }
        return m;
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    const list = rows.map((r) => {
      const f = r.investorId ? failureByInvestor.get(String(r.investorId)) : undefined;
      return {
      id: r.id,
      schemeName: r.schemeName ?? r.schemeCode ?? null,
      amcName: r.amcName ?? null,
      amount: r.amount != null ? Number(r.amount) : null,
      frequency: r.frequency,
      status: r.status,
      nextDate: r.nextDate ?? null,
      folioNumber: r.folioNumber ?? null,
      consecutiveFailures: r.consecutiveFailures != null ? Number(r.consecutiveFailures) : 0,
      /** Rejected SIP debits on the ledger for this client (bounce signal). */
      failedCount: f?.count ?? 0,
      lastFailureReason: f?.reason ?? null,
      lastFailureAt: f?.at ?? null,
      investorId: r.investorId,
      investorName: r.investorName ?? null,
      };
    });

    return NextResponse.json({ sips: list });
  } catch (err) {
    return handleApiError(err);
  }
}

const Body = z.object({
  investorId: z.string().uuid(),
  schemeName: z.string().max(200).optional(),
  schemeCode: z.string().max(60).optional(),
  amcName: z.string().max(160).optional(),
  folioNumber: z.string().max(60).optional(),
  amount: z.number().positive().max(1e9),
  frequency: z.enum(["monthly", "quarterly", "weekly", "fortnightly", "yearly"]).default("monthly"),
  sipDate: z.string().regex(/^([1-9]|[12]\d|2[0-8])$/).optional(), // day of month 1..28
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: z.enum(["active", "paused", "stopped", "rejected", "completed", "pending"]).default("active"),
  rmId: z.string().uuid().optional(),
  remarks: z.string().max(1000).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "transactions.execute", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const b = parse.data;

    const id = uuid();
    const clientMeta = clientMetaFromHeaders(req.headers);

    await withTenant(session.tenantId, async (tx) => {
      // Confirm the investor belongs to this tenant (RLS already scopes, but we
      // also want a clean 404 rather than an FK error) and fall back to their RM.
      const inv = (
        await tx
          .select({ id: investors.id, rmId: investors.rmId })
          .from(investors)
          .where(and(eq(investors.id, b.investorId), eq(investors.tenantId, session.tenantId)))
          .limit(1)
      )[0];
      if (!inv) {
        throw Object.assign(new Error("investor not found"), { status: 404 });
      }

      // An explicit RM must be a user in THIS firm (a stray uuid would attribute
      // the SIP to someone outside the tenant).
      if (b.rmId) {
        const [u] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, b.rmId), eq(users.tenantId, session.tenantId)))
          .limit(1);
        if (!u) throw Object.assign(new Error("RM not found in this firm"), { status: 400 });
      }

      const inserted = await tx
        .insert(sips)
        .values({
          id,
          tenantId: session.tenantId,
          investorId: b.investorId,
          schemeName: b.schemeName || null,
          schemeCode: b.schemeCode || null,
          amcName: b.amcName || null,
          folioNumber: b.folioNumber || null,
          amount: String(b.amount),
          frequency: b.frequency,
          sipDate: b.sipDate || null,
          startDate: b.startDate || null,
          endDate: b.endDate || null,
          nextInstallmentAt: b.startDate || null,
          status: b.status,
          rmId: b.rmId ?? inv.rmId ?? session.userId,
          remarks: b.remarks || null,
        } as any)
        .returning();

      // Let subscribed workflows react to a newly-registered SIP.
      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: "sip.created",
        entityType: "sip",
        entityId: id,
        after: inserted[0] as any,
        meta: { userId: session.userId, source: "manual" } as any,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "sip.create",
        entityType: "sip",
        entityId: id,
        after: { investorId: b.investorId, schemeName: b.schemeName, amount: b.amount, frequency: b.frequency, status: b.status },
        ...clientMeta,
      });
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
