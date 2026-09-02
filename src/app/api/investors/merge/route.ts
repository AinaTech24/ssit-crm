import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/investors/merge  — merge a duplicate client into a survivor.
 *
 * Body: { survivorId, loserId }. Reassigns every child row that references the
 * loser to the survivor, fills the survivor's blank contact fields from the
 * loser, then marks the loser status='inactive' + merged_into_id=survivor.
 * Owner / branch-head only. One transaction, fully audited.
 *
 * Child reassignment is auto-discovered from information_schema (any table with
 * an `investor_id` column) so new modules are covered automatically — minus a
 * denylist of tables whose investor_id participates in a uniqueness constraint
 * the survivor may already satisfy (those records stay on the inactive loser).
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { recomputeInvestorAum } from "@/lib/finance/aum-persist";
import { recomputeInvestorHealth } from "@/lib/investors/health-persist";

export const dynamic = "force-dynamic";

const isManager = (roles: string[]) => roles.some((r) => ["owner", "branch_head"].includes(r));

// investor_id on these participates in a uniqueness / one-per-investor rule, or
// is consent/PII that shouldn't silently move; leave on the (inactive) loser.
const DENYLIST = new Set(["investors", "consents", "communications", "campaigns", "risk_profiles", "onboarding"]);

const Body = z.object({
  survivorId: z.string().uuid(),
  loserId: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!isManager(session.roles)) return NextResponse.json({ error: "only owners / branch heads can merge records" }, { status: 403 });
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const { survivorId, loserId } = parse.data;
    if (survivorId === loserId) return NextResponse.json({ error: "survivor and loser must differ" }, { status: 400 });
    const meta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        const both = await tx.execute(sql`
          SELECT id, name, merged_into_id FROM investors
          WHERE tenant_id = ${session.tenantId}::uuid AND id IN (${survivorId}::uuid, ${loserId}::uuid)
        `);
        if (both.rows.length !== 2) return { error: "one or both clients not found" as const };
        if (both.rows.some((r: any) => r.merged_into_id)) return { error: "a selected record is already merged" as const };

        // Tables that carry a tenant_id — used to scope the reassignment for
        // defense-in-depth (the loser UUID is already tenant-unique, but a
        // tenant filter is a cheap second line of defence).
        const tcols = await tx.execute(sql`
          SELECT table_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'tenant_id'
        `);
        const hasTenant = new Set((tcols.rows as Array<{ table_name: string }>).map((r) => r.table_name));
        const tf = (table: string) =>
          hasTenant.has(table) ? sql` AND tenant_id = ${session.tenantId}::uuid` : sql``;

        // Discover child tables that reference investor_id.
        const cols = await tx.execute(sql`
          SELECT table_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'investor_id'
        `);
        let reassigned = 0;
        const skipped: string[] = [];
        for (const row of cols.rows as Array<{ table_name: string }>) {
          const tbl = row.table_name;
          if (DENYLIST.has(tbl)) continue;
          // Per-table SAVEPOINT: if reassigning collides with a uniqueness rule
          // the survivor already satisfies, skip THAT table (its rows stay on the
          // inactive loser) instead of aborting the entire merge.
          await tx.execute(sql`SAVEPOINT merge_child`);
          try {
            const r = await tx.execute(
              sql`UPDATE ${sql.raw(`"${tbl}"`)} SET investor_id = ${survivorId}::uuid WHERE investor_id = ${loserId}::uuid${tf(tbl)}`
            );
            reassigned += (r as any).rowCount ?? 0;
            await tx.execute(sql`RELEASE SAVEPOINT merge_child`);
          } catch {
            await tx.execute(sql`ROLLBACK TO SAVEPOINT merge_child`);
            skipped.push(tbl);
          }
        }

        // Special columns the generic pass misses (tenant-scoped where possible).
        await tx.execute(sql`UPDATE leads SET referred_by_investor_id = ${survivorId}::uuid WHERE referred_by_investor_id = ${loserId}::uuid${tf("leads")}`);
        await tx.execute(sql`UPDATE leads SET converted_investor_id = ${survivorId}::uuid WHERE converted_investor_id = ${loserId}::uuid${tf("leads")}`);
        await tx.execute(sql`UPDATE families SET primary_investor_id = ${survivorId}::uuid WHERE primary_investor_id = ${loserId}::uuid${tf("families")}`);
        await tx.execute(sql`UPDATE activities SET subject_id = ${survivorId}::uuid WHERE subject_type = 'investor' AND subject_id = ${loserId}::uuid${tf("activities")}`);

        // Fill the survivor's blank contact fields from the loser.
        await tx.execute(sql`
          UPDATE investors s SET
            phone = COALESCE(s.phone, l.phone),
            email = COALESCE(s.email, l.email),
            whatsapp_phone = COALESCE(s.whatsapp_phone, l.whatsapp_phone),
            dob = COALESCE(s.dob, l.dob),
            updated_at = now()
          FROM investors l
          WHERE s.id = ${survivorId}::uuid AND l.id = ${loserId}::uuid
        `);

        // Retire the loser.
        await tx.execute(sql`
          UPDATE investors SET status = 'inactive', merged_into_id = ${survivorId}::uuid, merged_at = now(), updated_at = now()
          WHERE id = ${loserId}::uuid
        `);

        // The survivor just absorbed the loser's folios / transactions / SIPs —
        // refresh its cached headline figures (aum, active SIP) and health so the
        // client list, KPI strip and scorecards don't show stale numbers until
        // the nightly recompute. Both losers' rows are now off the survivor.
        await recomputeInvestorAum(tx, survivorId);
        await recomputeInvestorHealth(tx, survivorId);

        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "investor.merge",
          entityType: "investor",
          entityId: survivorId,
          after: { survivorId, loserId, childRowsReassigned: reassigned, skippedTables: skipped } as any,
          ...meta,
        });
        return { ok: true as const, reassigned, skipped };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    const errMsg = "error" in result ? result.error : null;
    if (errMsg) return NextResponse.json({ error: errMsg }, { status: errMsg.includes("not found") ? 404 : 409 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
