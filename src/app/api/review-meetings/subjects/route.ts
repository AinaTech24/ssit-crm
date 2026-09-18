import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/review-meetings/subjects — the investor / lead / family lists the
 * Schedule-Meeting form needs for its subject pickers. Same query the
 * /dashboard/review-meetings/new page runs server-side, exposed so the
 * meeting form can be opened in a modal (e.g. from the lead blueprint) without
 * navigating away.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { investorScopeSql } from "@/lib/investors/access";
import { leadScopeSql } from "@/lib/leads/access";
import { dataScopeSqlFor } from "@/lib/auth/data-scope";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();

    // Fast path: when the form is locked to one preselected subject (e.g. the
    // lead-blueprint modal), fetch ONLY that row — skip the 300×3 lists so the
    // popup opens instantly.
    const leadId = req.nextUrl.searchParams.get("leadId");
    const investorId = req.nextUrl.searchParams.get("investorId");
    if (leadId && UUID.test(leadId)) {
      const lead = await withTenant(session.tenantId, async (tx) => {
        // Walled like the list — otherwise ?leadId=<guessed uuid> hands back
        // another RM's lead, which is exactly what the list prevents.
        const scope = await leadScopeSql(tx, session, "leads").catch(() => sql`FALSE`);
        return (
          await tx.execute(sql`
            SELECT id, name, phone, stage FROM leads
            WHERE id = ${leadId}::uuid AND tenant_id = ${session.tenantId}::uuid AND ${scope}
            LIMIT 1
          `)
        ).rows[0];
      });
      return NextResponse.json({ investors: [], leads: lead ? [lead] : [], families: [] });
    }
    if (investorId && UUID.test(investorId)) {
      const inv = await withTenant(session.tenantId, async (tx) => {
        const scope = await investorScopeSql(tx, session, "investors").catch(() => sql`FALSE`);
        return (
          await tx.execute(sql`
            SELECT id, name, pan, segment_tag, last_review_at, next_review_at FROM investors
            WHERE id = ${investorId}::uuid AND tenant_id = ${session.tenantId}::uuid AND ${scope}
            LIMIT 1
          `)
        ).rows[0];
      });
      return NextResponse.json({ investors: inv ? [inv] : [], leads: [], families: [] });
    }

    const data = await withTenant(session.tenantId, async (tx) => {
      // The same data wall the Clients and Leads lists use. Without it the
      // meeting scheduler's Client / Lead / Family pickers listed the WHOLE
      // firm — an RM could see (and book a meeting against) another RM's or
      // another desk's clients. A role with no client/lead visibility gets an
      // empty list rather than a 500.
      const invScope = await investorScopeSql(tx, session, "investors").catch(() => sql`FALSE`);
      const invScopeI = await investorScopeSql(tx, session, "i").catch(() => sql`FALSE`);
      const leadScope = await leadScopeSql(tx, session, "leads").catch(() => sql`FALSE`);
      const famScope = await dataScopeSqlFor(tx, session, {
        branch: "f.branch_id",
        owner: "f.rm_id",
      }).catch(() => sql`FALSE`);
      const [invRes, leadRes, famRes] = await Promise.all([
        tx.execute(sql`
          SELECT id, name, pan, segment_tag, last_review_at, next_review_at
          FROM investors
          WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' AND deleted_at IS NULL
            AND ${invScope}
          ORDER BY (next_review_at IS NULL) DESC, next_review_at ASC NULLS FIRST, name
          LIMIT 300
        `),
        tx.execute(sql`
          SELECT id, name, phone, stage
          FROM leads
          WHERE tenant_id = ${session.tenantId}::uuid AND converted_investor_id IS NULL AND stage NOT IN ('lost', 'cold', 'not_interested')
            AND ${leadScope}
          ORDER BY updated_at DESC
          LIMIT 300
        `),
        tx.execute(sql`
          SELECT f.id, f.family_name, f.primary_investor_id, i.name AS primary_name
          FROM families f
          JOIN investors i ON i.id = f.primary_investor_id
          WHERE f.tenant_id = ${session.tenantId}::uuid AND f.primary_investor_id IS NOT NULL
            AND (${famScope} OR ${invScopeI})
          ORDER BY f.family_name
          LIMIT 300
        `),
      ]);
      return { investors: invRes.rows as any[], leads: leadRes.rows as any[], families: famRes.rows as any[] };
    });
    return NextResponse.json(data);
  } catch (err: any) {
    return handleApiError(err);
  }
}
