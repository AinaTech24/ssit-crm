import { handleApiError } from "@/lib/api/error-handler";
/**
 * Named events a lead can be attributed to when its source is "event" —
 * seminars, expos, society camps, AMC roadshows.
 *
 *   GET  /api/lead-events   — the firm's active events, newest label order
 *   POST /api/lead-events   — add one (idempotent on the derived key)
 *
 * Stored as `master_values` rows with master_type = 'lead_event', so events sit
 * alongside every other firm-managed lookup and show up in Settings → Masters.
 *
 * Why this exists rather than reusing /api/masters/[type]: that endpoint is
 * gated on `settings.masters`, which only compliance / back-office / ops hold.
 * The RM capturing a lead at the event itself needs to add it on the spot, so
 * this route is gated on the lead-edit capabilities instead. It is deliberately
 * limited to this one master type — it cannot write any other lookup.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { masterValues } from "@/db/schema";

export const dynamic = "force-dynamic";

const MASTER_TYPE = "lead_event" as const;

const Body = z.object({
  label: z.string().trim().min(2).max(120),
});

/** "Mumbai Investor Meet 2026" → "mumbai_investor_meet_2026" */
function keyFor(label: string): string {
  return (
    label
      .normalize("NFKD")
      .replace(/[^\x20-\x7E]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || `event_${Date.now().toString(36)}`
  );
}

export async function GET() {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["lead.view.all", "lead.view.assigned"], session.permissions);
    const rows = await withTenant(session.tenantId, async (tx) =>
      tx
        .select({
          key: masterValues.key,
          label: masterValues.label,
          sortOrder: masterValues.sortOrder,
        })
        .from(masterValues)
        .where(
          and(
            eq(masterValues.tenantId, session.tenantId),
            eq(masterValues.masterType, MASTER_TYPE),
            eq(masterValues.isActive, true)
          )
        )
        .orderBy(asc(masterValues.sortOrder), asc(masterValues.label))
    );
    return NextResponse.json({ events: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

/**
 * Remove one event from the firm's list.
 *
 * Soft delete (is_active = false), not a row delete. A lead stores the event
 * LABEL in source_campaign rather than a foreign key, so past leads keep their
 * attribution either way — but keeping the row means re-adding the same name
 * later reactivates it instead of silently creating a duplicate key.
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["lead.edit.all", "lead.edit.assigned"], session.permissions);
    const key = new URL(req.url).searchParams.get("key")?.trim();
    if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

    const updated = await withTenant(session.tenantId, async (tx) =>
      tx
        .update(masterValues)
        .set({ isActive: false })
        .where(
          and(
            eq(masterValues.tenantId, session.tenantId),
            eq(masterValues.masterType, MASTER_TYPE),
            eq(masterValues.key, key)
          )
        )
        .returning({ key: masterValues.key })
    );
    if (updated.length === 0) {
      return NextResponse.json({ error: "event not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["lead.edit.all", "lead.edit.assigned"], session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "an event name is required", issues: parse.error.issues }, { status: 400 });
    }
    const label = parse.data.label;
    const key = keyFor(label);

    const event = await withTenant(session.tenantId, async (tx) => {
      // Adding the same event twice (two RMs at the same seminar) is a no-op
      // that returns what is already there, not a 409 the user has to decode.
      const [existing] = await tx
        .select({ key: masterValues.key, label: masterValues.label })
        .from(masterValues)
        .where(
          and(
            eq(masterValues.tenantId, session.tenantId),
            eq(masterValues.masterType, MASTER_TYPE),
            eq(masterValues.key, key)
          )
        )
        .limit(1);
      if (existing) {
        // Re-activate one that had been switched off.
        await tx
          .update(masterValues)
          .set({ isActive: true, updatedAt: new Date() } as any)
          .where(
            and(
              eq(masterValues.tenantId, session.tenantId),
              eq(masterValues.masterType, MASTER_TYPE),
              eq(masterValues.key, key)
            )
          );
        return existing;
      }

      await tx.insert(masterValues).values({
        id: uuid(),
        tenantId: session.tenantId,
        masterType: MASTER_TYPE,
        key,
        label,
        sortOrder: 0,
        isActive: true,
        isSystemDefault: false,
      } as any);
      return { key, label };
    });

    return NextResponse.json({ event }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
