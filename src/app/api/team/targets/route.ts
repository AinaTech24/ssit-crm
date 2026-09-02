import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { withTenant } from "@/db/client";
import { currentFiscalYear } from "@/lib/business/sif-status";
import { TARGETABLE_METRICS } from "@/lib/team/scorecard";

/** List the targetable metrics, active members, and the current FY's targets
 *  (for the mobile Targets screen). Owners / branch heads. */
export async function GET() {
  const session = await requireSession();
  if (!can(session.roles, "dashboard.view.owner", session.permissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const fiscalYear = currentFiscalYear();
  const data = await withTenant(session.tenantId, async (tx) => {
    const members = await tx.execute(sql`
      SELECT id, name FROM users
      WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
      ORDER BY name
    `);
    const targets = await tx.execute(sql`
      SELECT user_id, metric_key, annual_target
      FROM kra_targets
      WHERE tenant_id = ${session.tenantId}::uuid AND fiscal_year = ${fiscalYear}
    `);
    return { members: members.rows as any[], targets: targets.rows as any[] };
  });
  const map: Record<string, Record<string, number>> = {};
  for (const t of data.targets) (map[t.user_id] ??= {})[t.metric_key] = Number(t.annual_target);
  return NextResponse.json({ fiscalYear, metrics: TARGETABLE_METRICS, members: data.members, targets: map });
}

/** Upsert one person's annual target for one KRA metric. Owners / branch heads. */
export async function POST(req: Request) {
  const session = await requireSession();
  if (!can(session.roles, "dashboard.view.owner", session.permissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const userId = String(body.userId ?? "");
  const metricKey = String(body.metricKey ?? "");
  const annualTarget = Number(body.annualTarget);
  const fiscalYear = /^\d{4}-\d{2}$/.test(String(body.fiscalYear ?? "")) ? String(body.fiscalYear) : currentFiscalYear();

  if (!/^[0-9a-f-]{36}$/i.test(userId)) return NextResponse.json({ error: "Invalid user" }, { status: 400 });
  if (!TARGETABLE_METRICS.some((m) => m.key === metricKey)) return NextResponse.json({ error: "Invalid metric" }, { status: 400 });
  if (!Number.isFinite(annualTarget) || annualTarget < 0 || annualTarget > 1e12) {
    return NextResponse.json({ error: "Invalid target" }, { status: 400 });
  }

  await withTenant(session.tenantId, async (tx) =>
    tx.execute(sql`
      INSERT INTO kra_targets (tenant_id, user_id, fiscal_year, metric_key, annual_target, updated_by)
      VALUES (${session.tenantId}::uuid, ${userId}::uuid, ${fiscalYear}, ${metricKey}, ${annualTarget}, ${session.userId}::uuid)
      ON CONFLICT (tenant_id, user_id, fiscal_year, metric_key)
      DO UPDATE SET annual_target = excluded.annual_target, updated_by = excluded.updated_by, updated_at = now()
    `)
  );
  return NextResponse.json({ ok: true });
}
