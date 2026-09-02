import { handleApiError } from "@/lib/api/error-handler";
/**
 * Investor blueprint endpoint.
 *
 *   GET /api/investors/[id]/blueprint
 *
 * Three render paths, in priority order:
 *
 *   1. Source lead exists (investor was converted from a lead) →
 *      return that lead's real blueprint instance. The bar shows the
 *      lead's actual position through the client-phase stages
 *      (Operations / Portal / Active).
 *
 *   2. Direct-import investor → return a SYNTHETIC stage view built
 *      live from the seeded `blueprint_stages` table. The lead-phase
 *      stages (1-10) carry status="skipped" so the UI greys them out;
 *      the client-phase stages (11-30) show the journey from Won Lead
 *      → Active Client with the investor pinned to "Active Client".
 *      Reading from the DB instead of hardcoding means we always
 *      reflect the *current* blueprint catalog (no stale stage names
 *      after a re-seed).
 *
 *   3. No blueprint seeded yet (rare — only on a fresh tenant) →
 *      404. The UI hides the bar.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import { getStage } from "@/lib/blueprints/engine";
import type { Tx } from "@/db/client";

export const dynamic = "force-dynamic";

/** Final stage in the client phase that direct-import investors are pinned to. */
const TERMINAL_KEY = "add_in_review_sheet";
/** Order cut-off — stages with order ≤ this are lead-phase. */
const LEAD_PHASE_LAST = 10;

/**
 * Synthetic stage view for a direct-import investor, built live from the
 * seeded blueprint_stages table.
 *
 * Returns the full graph (all 30 stages of the current SOP) with:
 *   - lead-phase stages (order ≤ LEAD_PHASE_LAST) → status "skipped"
 *   - client-phase stages → "done" up to TERMINAL_KEY, "current" at it,
 *     "upcoming" after (in practice nothing — it's the last stage).
 */
async function syntheticClientStageView(tx: Tx) {
  const r = await tx.execute(sql`
    SELECT stage_key, stage_name, description, stage_order, owner_role, sla_days
    FROM blueprint_stages bs
    WHERE bs.blueprint_id IN (
      SELECT id FROM blueprint_definitions WHERE module_name = 'leads' AND is_active = true LIMIT 1
    )
    ORDER BY bs.stage_order
  `);
  if (r.rows.length === 0) return null;

  const stages = r.rows.map((s: any) => ({
    key: s.stage_key as string,
    name: s.stage_name as string,
    description: (s.description as string | null) ?? null,
    order: Number(s.stage_order),
    ownerRole: s.owner_role as string | null,
    slaDays: s.sla_days != null ? Number(s.sla_days) : null,
  }));

  const currentIdx = stages.findIndex((s) => s.key === TERMINAL_KEY);
  const current = stages[currentIdx >= 0 ? currentIdx : stages.length - 1];

  return {
    current: {
      key: current.key,
      name: current.name,
      description:
        "Imported directly — no lead-side onboarding journey on file. Client is in the review cycle.",
      ownerRole: current.ownerRole,
      order: current.order,
      slaDays: null,
      allowedActions: [] as string[],
      requiredFields: [] as string[],
      secondsInStage: 0,
      slaRemainingDays: null,
      isDelayed: false,
    },
    allStages: stages.map((s, i) => {
      const phase = (s.order <= LEAD_PHASE_LAST ? "lead" : "client") as "lead" | "client";
      const status =
        phase === "lead"
          ? "skipped"
          : i < currentIdx
            ? "done"
            : i === currentIdx
              ? "current"
              : "upcoming";
      return {
        key: s.key,
        name: s.name,
        order: s.order,
        status: status as "done" | "current" | "upcoming" | "skipped",
        phase,
      };
    }),
    history: [] as any[],
    leadId: null,
    synthetic: true,
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    // Investor-data capability gate (marketing is excluded from investor.view.*).
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const viewAll = can(session.roles, "investor.view.all", session.permissions);
    const { id: investorId } = await params;
    const data = await withTenant(session.tenantId, async (tx) => {
      // Assigned-only roles may read just their own clients' journey. 404 (not
      // 403) so we don't leak which investor ids exist outside their book.
      if (!viewAll) {
        const own = await tx.execute(
          sql`SELECT 1 FROM investors WHERE id = ${investorId}::uuid AND tenant_id = ${session.tenantId}::uuid AND rm_id = ${session.userId}::uuid LIMIT 1` as any
        );
        if ((own.rows?.length ?? 0) === 0) {
          throw Object.assign(new Error("Not found"), { status: 404 });
        }
      }

      // Path 1: real blueprint via source lead
      const lead = await tx.execute(sql`
        SELECT id FROM leads WHERE converted_investor_id = ${investorId}::uuid LIMIT 1
      `);
      const leadId = (lead.rows[0] as any)?.id as string | undefined;
      if (leadId) {
        const view = await getStage(tx, session.tenantId, leadId);
        return { ...view, leadId, synthetic: false };
      }

      // Path 2: synthetic — DB-driven, always reflects current catalog
      return await syntheticClientStageView(tx);
    });

    if (!data) {
      return NextResponse.json(
        { error: "No blueprint seeded yet for this tenant" },
        { status: 404 }
      );
    }
    return NextResponse.json(data);
  } catch (err: any) {
    return handleApiError(err);
  }
}
