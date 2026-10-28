import { handleApiError } from "@/lib/api/error-handler";
/**
 * Monthly targets.
 *
 *   GET /api/target-goals?period=YYYY-MM   — the admin's full grid (every subject, every
 *                                       metric, shown or hidden) PLUS the targets
 *                                       and achievements this user may see.
 *   PUT /api/target-goals                  — admin only. Upsert targets for a month:
 *                                       { period, rows:[{subjectType, subjectId,
 *                                       metricKey, targetValue, visible}] }.
 *                                       A blank / 0 target with the row left as is
 *                                       removes it.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { currentPeriod, loadMembership, METRIC_BY_KEY, TARGET_METRICS, validPeriod } from "@/lib/targets";
import { loadVisibleTargets } from "@/lib/targets/view";

type Rec = Record<string, any>;
export const dynamic = "force-dynamic";

const Row = z.object({
  subjectType: z.enum(["user", "branch", "desk"]),
  subjectId: z.string().uuid(),
  metricKey: z.string().refine((k) => METRIC_BY_KEY.has(k), "unknown metric"),
  targetValue: z.number().min(0).max(1e13),
  visible: z.boolean(),
});
const Body = z.object({ period: z.string().refine(validPeriod, "period must be YYYY-MM"), rows: z.array(Row).max(2000) });

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const p = req.nextUrl.searchParams.get("period");
    const period = validPeriod(p) ? p : currentPeriod();
    const isOwner = session.roles.includes("owner");
    const data = await withTenant(session.tenantId, async (tx) => {
      const cards = await loadVisibleTargets(tx, session, period);
      if (!isOwner) return { cards, grid: null };
      const { users, byBranch, byDesk } = await loadMembership(tx, session.tenantId);
      const [br, dk, rows] = await Promise.all([
        tx.execute(sql`SELECT id, name FROM branches WHERE tenant_id = ${session.tenantId}::uuid ORDER BY name`),
        tx.execute(sql`SELECT id, name FROM desks WHERE tenant_id = ${session.tenantId}::uuid ORDER BY name`),
        tx.execute(sql`
          SELECT subject_type, subject_id, metric_key, target_value, visible FROM target_goals
           WHERE tenant_id = ${session.tenantId}::uuid AND period = ${period}`),
      ]);
      return {
        cards,
        grid: {
          users: users.map((u) => ({ id: u.id, name: u.name ?? "—", roles: u.roles ?? [] })),
          branches: (br.rows as Rec[]).map((b) => ({ id: b.id, name: b.name, members: byBranch.get(b.id)?.length ?? 0 })),
          desks: (dk.rows as Rec[]).map((d) => ({ id: d.id, name: d.name, members: byDesk.get(d.id)?.length ?? 0 })),
          rows: (rows.rows as Rec[]).map((r) => ({
            subjectType: r.subject_type,
            subjectId: r.subject_id,
            metricKey: r.metric_key,
            targetValue: Number(r.target_value),
            visible: !!r.visible,
          })),
        },
      };
    });
    return NextResponse.json({ period, metrics: TARGET_METRICS, ...data });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!session.roles.includes("owner")) {
      return NextResponse.json({ error: "Only the admin can set targets" }, { status: 403 });
    }
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const { period, rows } = parse.data;

    await withTenant(session.tenantId, async (tx) => {
      // Every subject must belong to this tenant — a uuid from elsewhere is a
      // valid uuid but would store a target nobody could ever see.
      const { users } = await loadMembership(tx, session.tenantId);
      const [br, dk] = await Promise.all([
        tx.execute(sql`SELECT id FROM branches WHERE tenant_id = ${session.tenantId}::uuid`),
        tx.execute(sql`SELECT id FROM desks WHERE tenant_id = ${session.tenantId}::uuid`),
      ]);
      const ok = {
        user: new Set(users.map((u) => u.id)),
        branch: new Set((br.rows as Rec[]).map((b) => String(b.id))),
        desk: new Set((dk.rows as Rec[]).map((d) => String(d.id))),
      };
      for (const r of rows) {
        if (!ok[r.subjectType].has(r.subjectId)) continue;
        if (r.targetValue === 0) {
          await tx.execute(sql`
            DELETE FROM target_goals
             WHERE tenant_id = ${session.tenantId}::uuid AND subject_type = ${r.subjectType}
               AND subject_id = ${r.subjectId}::uuid AND metric_key = ${r.metricKey} AND period = ${period}`);
          continue;
        }
        await tx.execute(sql`
          INSERT INTO target_goals (tenant_id, subject_type, subject_id, metric_key, period, target_value, visible, updated_by)
          VALUES (${session.tenantId}::uuid, ${r.subjectType}, ${r.subjectId}::uuid, ${r.metricKey}, ${period},
                  ${r.targetValue}, ${r.visible}, ${session.userId}::uuid)
          ON CONFLICT (tenant_id, subject_type, subject_id, metric_key, period)
          DO UPDATE SET target_value = excluded.target_value, visible = excluded.visible,
                        updated_by = excluded.updated_by, updated_at = now()`);
      }
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
