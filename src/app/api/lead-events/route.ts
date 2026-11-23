import { handleApiError } from "@/lib/api/error-handler";
/**
 * Named events a lead can be attributed to when its source is "event" —
 * seminars, expos, society camps, AMC roadshows.
 *
 *   GET    /api/lead-events          — the firm's events: the managed list, plus event names
 *                                      already on leads that the list did not know yet
 *   POST   /api/lead-events          — add one (idempotent on the derived key)
 *   DELETE /api/lead-events?key=&label=  — take one out of the list
 *
 * Stored as `master_values` rows with master_type = 'lead_event', so events sit
 * alongside every other firm-managed lookup and show up in Settings → Masters.
 * One list serves the New-lead form, Edit lead and the bulk "Update a field" (see
 * src/lib/leads/events.ts).
 *
 * Why this exists rather than reusing /api/masters/[type]: that endpoint is
 * gated on `settings.masters`, which only compliance / back-office / ops hold.
 * The RM capturing a lead at the event itself needs to add it on the spot, so
 * this route is gated on the lead-edit capabilities instead. It is deliberately
 * limited to this one master type — it cannot write any other lookup.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { ensureLeadEvent, listLeadEvents, removeLeadEvent } from "@/lib/leads/events";

export const dynamic = "force-dynamic";

const Body = z.object({
  label: z.string().trim().min(2).max(120),
});

export async function GET() {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["lead.view.all", "lead.view.assigned"], session.permissions);
    const events = await withTenant(session.tenantId, async (tx) => listLeadEvents(tx, session.tenantId));
    return NextResponse.json({ events });
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
    const url = new URL(req.url);
    const key = url.searchParams.get("key")?.trim();
    if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
    const label = url.searchParams.get("label");

    const done = await withTenant(session.tenantId, async (tx) => removeLeadEvent(tx, session.tenantId, key, label));
    if (!done) return NextResponse.json({ error: "event not found" }, { status: 404 });
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
    // Adding the same event twice (two RMs at the same seminar) is a no-op that
    // returns what is already there, not a 409 the user has to decode.
    const event = await withTenant(session.tenantId, async (tx) => ensureLeadEvent(tx, session.tenantId, parse.data.label));
    return NextResponse.json({ event }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
