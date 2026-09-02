import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/leads/[id]/notes
 * Body: { note, activityType?: 'call'|'meeting'|'email'|'whatsapp'|'note'|'other' }
 *
 * Appends a timestamped activity entry to the lead. The latest goes to the top
 * of the followUpNotes field; stage_changed_at + last_contact_at are bumped so
 * the lead doesn't go stale and the missed-follow-up automation doesn't fire.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { leads, eventsOutbox } from "@/db/schema";
import { autoAdvance } from "@/lib/blueprints/auto-advance";
import { loadEditableLead } from "@/lib/leads/access";

export const dynamic = "force-dynamic";

const Body = z.object({
  note: z.string().min(1).max(4000),
  activityType: z.enum(["call", "meeting", "email", "whatsapp", "note", "other"]).default("note"),
  nextFollowUpAt: z.string().datetime().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

    const result = await withTenant(session.tenantId, async (tx) => {
      const lead = await loadEditableLead(tx, session, id);

      const ts = new Date();
      const stamp = ts.toISOString().slice(0, 16).replace("T", " ");
      const prefix = `[${stamp} · ${parse.data.activityType}${
        session.name ? " · " + session.name : ""
      }]`;
      const entry = `${prefix}\n${parse.data.note}`;
      const combined = lead.followUpNotes ? `${entry}\n\n---\n\n${lead.followUpNotes}` : entry;

      const [after] = await tx
        .update(leads)
        .set({
          followUpNotes: combined,
          lastContactAt: ts,
          lastFollowUpAt: ts,
          nextFollowUpAt: parse.data.nextFollowUpAt ? new Date(parse.data.nextFollowUpAt) : lead.nextFollowUpAt,
          updatedAt: ts,
        } as any)
        .where(eq(leads.id, id))
        .returning();

      // Emit lead.updated so record_action "edit" workflow rules can react to a
      // logged activity (e.g. a contacted-lead follow-up cadence).
      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: "lead.updated",
        entityType: "lead",
        entityId: id,
        before: lead as any,
        after: (after ?? lead) as any,
        meta: { userId: session.userId, source: "note" } as any,
      } as any);

      // ─── Smart blueprint advance — activity logged ────────────────
      // The activity type determines which stage the lead jumps to:
      //   - call    → call_done   (stage 2 of the SOP)
      //   - meeting → meeting_done (stage 8) — RM logged a past meeting
      // Other types (email, whatsapp, note) just refresh the lastContactAt
      // without moving the funnel.
      if (parse.data.activityType === "call") {
        await autoAdvance(tx, session.tenantId, id, "call.logged", {
          remarks: `Auto: call logged on ${ts.toLocaleDateString("en-IN")} — "${parse.data.note.slice(0, 60)}".`,
        });
      } else if (parse.data.activityType === "meeting") {
        await autoAdvance(tx, session.tenantId, id, "meeting.completed", {
          remarks: `Auto: past meeting logged — "${parse.data.note.slice(0, 60)}".`,
        });
      }

      return { ok: true };
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
