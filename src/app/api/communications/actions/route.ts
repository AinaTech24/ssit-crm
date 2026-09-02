import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/communications/actions
 *   Body: { action: "cancel" | "retry" | "flag" | "unflag", ids: string[] }
 *
 * Bulk row actions for the communications list:
 *   cancel  — a scheduled send → status 'cancelled' (only if still 'scheduled')
 *   retry   — a failed Compose email → re-send through the gate
 *   flag    — star a row (flagged_at = now)
 *   unflag  — clear the star
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { communications, investors, leads } from "@/db/schema";
import { retryEmail } from "@/lib/comms/compose";

export const dynamic = "force-dynamic";

const Body = z.object({
  action: z.enum(["cancel", "retry", "flag", "unflag"]),
  ids: z.array(z.string().uuid()).min(1).max(200),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "communication.send", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { action, ids } = parsed.data;
    const clientMeta = clientMetaFromHeaders(req.headers);

    // Managers / ops / compliance act on any row; a plain RM (or marketing) may
    // only cancel/flag/retry rows they sent or that belong to their own
    // clients/leads — consistent with the scoping on the list view.
    const seesAll =
      can(session.roles, "investor.view.all", session.permissions) ||
      can(session.roles, "compliance.view", session.permissions) ||
      can(session.roles, "reports.business", session.permissions);

    const out = await withTenant(session.tenantId, async (tx) => {
      let affected = 0;

      // Every mutation is tenant-scoped explicitly — withTenant alone doesn't
      // protect under the superuser/RLS-bypass model, so without these
      // predicates one tenant could cancel/flag/retry another tenant's rows by id.
      const tenantPred = eq(communications.tenantId, session.tenantId);

      // Narrow the id set to rows this user is allowed to touch. Managers keep
      // the full set; everyone else is filtered to owned rows up-front so the
      // mutations (and the per-id retry loop) can't reach a peer's threads.
      let scopedIds = ids;
      if (!seesAll) {
        const owned = await tx
          .select({ id: communications.id })
          .from(communications)
          .leftJoin(investors, eq(investors.id, communications.investorId))
          .leftJoin(leads, eq(leads.id, communications.leadId))
          .where(
            and(
              tenantPred,
              inArray(communications.id, ids),
              or(
                eq(communications.userId, session.userId),
                eq(investors.rmId, session.userId),
                eq(leads.ownerId, session.userId)
              )
            )
          );
        scopedIds = owned.map((r) => r.id);
      }

      if (scopedIds.length === 0) return { affected: 0 };

      if (action === "cancel") {
        const r = await tx
          .update(communications)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(and(tenantPred, inArray(communications.id, scopedIds), eq(communications.status, "scheduled")))
          .returning({ id: communications.id });
        affected = r.length;
      } else if (action === "flag" || action === "unflag") {
        const r = await tx
          .update(communications)
          .set({ flaggedAt: action === "flag" ? new Date() : null, updatedAt: new Date() })
          .where(and(tenantPred, inArray(communications.id, scopedIds)))
          .returning({ id: communications.id });
        affected = r.length;
      } else if (action === "retry") {
        // Re-send each failed Compose row through the gate, one at a time.
        // retryEmail is tenant-scoped so a foreign id is a no-op.
        for (const id of scopedIds) {
          const res = await retryEmail(tx, id, session.tenantId);
          if (res.status === "sent" || res.status === "queued") affected++;
        }
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: `communication.${action}`,
        entityType: "communication",
        entityId: ids[0],
        after: { action, count: affected, ids: ids.slice(0, 50) },
        ...clientMeta,
      });

      return { affected };
    });

    return NextResponse.json({ ok: true, ...out });
  } catch (err: any) {
    return handleApiError(err);
  }
}
