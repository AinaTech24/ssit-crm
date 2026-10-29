import { handleApiError } from "@/lib/api/error-handler";
/**
 * PATCH  /api/investors/[id]/notes/[noteId]  — reword your own note
 * DELETE /api/investors/[id]/notes/[noteId]  — remove it
 *
 * Everyone who can open the client can READ its notes; only the author can
 * change or remove one, so a shared client history cannot be quietly rewritten
 * by someone else. An owner can do both, because someone has to be able to
 * remove a note written by a person who has since left.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { activities, investors } from "@/db/schema";
import { assertCanViewClient } from "@/lib/investors/access";

export const dynamic = "force-dynamic";

const Patch = z.object({ note: z.string().trim().min(1).max(4000) });

async function loadOwnNote(tx: any, session: any, investorId: string, noteId: string) {
  const [inv] = await tx
    .select({ rmId: investors.rmId, serviceRmId: investors.serviceRmId, branchId: investors.branchId })
    .from(investors)
    .where(and(eq(investors.id, investorId), eq(investors.tenantId, session.tenantId)))
    .limit(1);
  if (!inv) return "not_found" as const;
  await assertCanViewClient(tx, session, inv);

  const [note] = await tx
    .select()
    .from(activities)
    .where(
      and(
        eq(activities.id, noteId),
        eq(activities.tenantId, session.tenantId),
        eq(activities.subjectId, investorId),
        inArray(activities.kind, ["note", "call", "visit", "whatsapp", "email", "sms"])
      )
    )
    .limit(1);
  if (!note) return "not_found" as const;
  const isOwner = session.roles.includes("owner");
  if (!isOwner && note.ownerUserId !== session.userId) return "forbidden" as const;
  return note;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  const { id, noteId } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "a note cannot be empty" }, { status: 400 });
    const meta = clientMetaFromHeaders(req.headers);

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const note = await loadOwnNote(tx, session, id, noteId);
      if (note === "not_found" || note === "forbidden") return note;
      await tx
        .update(activities)
        .set({ notes: parse.data.note, updatedAt: new Date() })
        .where(and(eq(activities.id, noteId), eq(activities.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "investor.note.update",
        entityType: "investor",
        entityId: id,
        before: { noteId, notes: note.notes },
        after: { noteId, notes: parse.data.note },
        ...meta,
      });
      return "ok" as const;
    });

    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (outcome === "forbidden") return NextResponse.json({ error: "you can only edit your own notes" }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  const { id, noteId } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const meta = clientMetaFromHeaders(req.headers);

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const note = await loadOwnNote(tx, session, id, noteId);
      if (note === "not_found" || note === "forbidden") return note;
      await tx
        .delete(activities)
        .where(and(eq(activities.id, noteId), eq(activities.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "investor.note.delete",
        entityType: "investor",
        entityId: id,
        before: { noteId, notes: note.notes },
        ...meta,
      });
      return "ok" as const;
    });

    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (outcome === "forbidden") return NextResponse.json({ error: "you can only delete your own notes" }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
