import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/leads/[id]/won
 *
 * "Qualified — Won Lead" with a product choice. Records which product(s) the
 * client is investing in, sets the lead's pipeline from the PRIMARY product
 * (which decides the onboarding branch — MF vs Insurance), then advances the
 * blueprint to "Won Lead". The Won-Lead stage then surfaces the product-
 * appropriate onboarding actions.
 *
 *   Body: { products: string[], primaryProduct: string, notes?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { clientMetaFromHeaders } from "@/lib/audit";
import { transitionTo } from "@/lib/blueprints/engine";
import { productToPipeline } from "@/lib/blueprints/lead_to_client";
import { leads, eventsOutbox } from "@/db/schema";
import { loadEditableLead } from "@/lib/leads/access";

export const dynamic = "force-dynamic";

const Body = z.object({
  products: z.array(z.string().min(1)).min(1, "Pick at least one product"),
  primaryProduct: z.string().min(2),
  notes: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["lead.edit.all", "lead.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const { id } = await params;

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { products, primaryProduct, notes } = parsed.data;
    const pipeline = productToPipeline(primaryProduct);
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      await loadEditableLead(tx, session, id);

      // Snapshot BEFORE so workflow rules can detect the stage change to won_lead.
      const [before] = await tx.select().from(leads).where(and(eq(leads.id, id), eq(leads.tenantId, session.tenantId))).limit(1);

      // Persist the product interest + the chosen pipeline (drives the branch).
      await tx
        .update(leads)
        .set({ interestProducts: products, pipeline, updatedAt: new Date() })
        .where(and(eq(leads.id, id), eq(leads.tenantId, session.tenantId)));

      // Advance to Won Lead (idempotent — same-stage re-click is a no-op).
      const res = await transitionTo(tx, session.tenantId, id, "won_lead", {
        actorUserId: session.userId,
        actorRoles: session.roles ?? [],
        remarks: notes
          ? `Won — ${products.join(", ")}. ${notes}`
          : `Won — products: ${products.join(", ")}`,
        ...clientMeta,
      });

      // Emit lead.updated (before/after) so the workflow-rules engine can react
      // to "lead won" — e.g. send the risk-profile form on a Mutual Funds win.
      if (res.ok && before) {
        const [after] = await tx.select().from(leads).where(and(eq(leads.id, id), eq(leads.tenantId, session.tenantId))).limit(1);
        await tx.insert(eventsOutbox).values({
          tenantId: session.tenantId,
          kind: "lead.updated",
          entityType: "lead",
          entityId: id,
          before: before as any,
          after: (after ?? before) as any,
          meta: { source: "won_lead" } as any,
        } as any);
      }
      return res;
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason ?? "Could not move the lead to Won Lead." },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true, pipeline });
  } catch (err) {
    return handleApiError(err);
  }
}
