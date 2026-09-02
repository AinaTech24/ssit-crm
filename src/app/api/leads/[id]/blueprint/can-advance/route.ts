import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/leads/[id]/blueprint/can-advance?to=<stageKey>
 *
 * Returns the prerequisite checklist for advancing a lead to the
 * requested target stage. Shape:
 *
 *   {
 *     ok: boolean,
 *     items: Array<{
 *       label: string,
 *       satisfied: boolean,
 *       hint?: string,
 *       cta?: { href: string; label: string },
 *     }>
 *   }
 *
 * Drives the guided action UI: when the user clicks a stage button
 * (e.g. "Call Done"), the UI calls this first. If `ok` → fire the
 * actual advance. If not → render the unsatisfied items inline with
 * direct CTAs so the user knows what to do.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { checkPrerequisites } from "@/lib/blueprints/prerequisites";
import { leadBlueprintInstances, blueprintStages } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { loadViewableLead } from "@/lib/leads/access";
import { normalizeLeadStage } from "@/lib/leads/normalize";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const target = req.nextUrl.searchParams.get("to");
    if (!target) {
      return NextResponse.json({ error: "missing ?to=<stageKey>" }, { status: 400 });
    }
    const targetStage = normalizeLeadStage(target);
    const data = await withTenant(session.tenantId, async (tx) => {
      const lead = await loadViewableLead(tx, session, id);
      if (!lead) throw Object.assign(new Error("Lead not found"), { status: 404 });
      const prereqs = await checkPrerequisites(tx, session.tenantId, id, targetStage);

      // Load lead and target stage definition
      // Resolve the active blueprint instance for this lead to get the blueprintId
      const [inst] = await tx
        .select()
        .from(leadBlueprintInstances)
        .where(eq(leadBlueprintInstances.leadId, id))
        .limit(1);

      const missingFields: Array<{ key: string; label: string; type: string; options?: string[] }> = [];
      if (inst && lead) {
        const [stageDef] = await tx
          .select()
          .from(blueprintStages)
          .where(
            and(
              eq(blueprintStages.blueprintId, inst.blueprintId),
              eq(blueprintStages.stageKey, targetStage)
            )
          )
          .limit(1);

        if (stageDef && stageDef.requiredFields) {
          const FIELD_METADATA: Record<string, { label: string; type: string; options?: string[] }> = {
            name: { label: "Lead Name", type: "text" },
            email: { label: "Email Address", type: "email" },
            phone: { label: "Phone Number", type: "text" },
            city: { label: "City", type: "text" },
            pincode: { label: "Pincode", type: "text" },
            intendedAmount: { label: "Intended Investment Amount (₹)", type: "number" },
            source: {
              label: "Lead Source",
              type: "select",
              options: [
                "referral",
                "website",
                "social_media",
                "webinar",
                "seminar",
                "walk_in",
                "existing_client",
                "google",
                "cold_call",
                "other",
              ],
            },
          };
          for (const f of stageDef.requiredFields) {
            const val = (lead as any)[f];
            if (val === null || val === undefined || val === "") {
              const meta = FIELD_METADATA[f] ?? { label: f.charAt(0).toUpperCase() + f.slice(1), type: "text" };
              missingFields.push({ key: f, label: meta.label, type: meta.type, options: meta.options });
            }
          }
        }
      }

      return {
        ...prereqs,
        missingFields,
      };
    });
    return NextResponse.json(data);
  } catch (err: any) {
    return handleApiError(err);
  }
}
