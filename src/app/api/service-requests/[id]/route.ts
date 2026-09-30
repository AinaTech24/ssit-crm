import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single service-request endpoints.
 *
 *   GET    /api/service-requests/[id]   — fetch one ticket
 *   PATCH  /api/service-requests/[id]   — update status / priority / assignee / resolution
 *   DELETE /api/service-requests/[id]   — close (status='closed')
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { sql } from "drizzle-orm";
import { serviceRequests, eventsOutbox } from "@/db/schema";

export const dynamic = "force-dynamic";

const Patch = z.object({
  subject: z.string().min(2).max(300).optional(),
  description: z.string().optional(),
  status: z.enum(["open", "in_progress", "waiting_customer", "resolved", "closed", "escalated"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  assignedToUserId: z.string().uuid().optional(),
  /** Working fields the detail workspace writes. */
  remarks: z.string().max(4000).optional(),
  resolutionNotes: z.string().max(4000).optional(),
  /** Free-text note appended to the activity timeline. */
  timelineNote: z.string().max(1000).optional(),
  /** Explicitly record the first agent response (stamps respondedAt). */
  markResponded: z.boolean().optional(),
  /** Post-resolution client satisfaction. */
  csatRating: z.number().int().min(1).max(5).optional(),
  csatComment: z.string().max(1000).optional(),
  /** Complaint-register fields (SEBI). */
  sebiCategory: z.string().max(60).optional(),
  sebiSubCategory: z.string().max(120).optional(),
  complaintSource: z.string().max(40).optional(),
  scoresRefNo: z.string().max(80).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const row = await withTenant(session.tenantId, async (tx) =>
      (await tx.select().from(serviceRequests).where(and(eq(serviceRequests.id, id), eq(serviceRequests.tenantId, session.tenantId))).limit(1))[0] ?? null
    );
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "service_request.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);
    const d = parse.data;

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(serviceRequests).where(and(eq(serviceRequests.id, id), eq(serviceRequests.tenantId, session.tenantId))).limit(1))[0];
      if (!before) return null;

      const now = new Date();
      const patch: any = { updatedAt: now };
      if (d.subject !== undefined) patch.subject = d.subject;
      if (d.description !== undefined) patch.description = d.description;
      if (d.status !== undefined) patch.status = d.status;
      if (d.priority !== undefined) patch.priority = d.priority;
      if (d.assignedToUserId !== undefined) patch.assignedToUserId = d.assignedToUserId;
      if (d.remarks !== undefined) patch.remarks = d.remarks;
      if (d.resolutionNotes !== undefined) patch.resolutionNotes = d.resolutionNotes;
      if (d.csatRating !== undefined) { patch.csatRating = d.csatRating; patch.csatAt = now; }
      if (d.csatComment !== undefined) patch.csatComment = d.csatComment;
      if (d.sebiCategory !== undefined) patch.sebiCategory = d.sebiCategory;
      if (d.sebiSubCategory !== undefined) patch.sebiSubCategory = d.sebiSubCategory;
      if (d.complaintSource !== undefined) patch.complaintSource = d.complaintSource;
      if (d.scoresRefNo !== undefined) patch.scoresRefNo = d.scoresRefNo;

      // Stamp resolvedAt the first time it becomes resolved/closed.
      if ((d.status === "resolved" || d.status === "closed") && !before.resolvedAt) patch.resolvedAt = now;

      // First-response capture: stamp respondedAt on the first agent action —
      // moving off 'open', adding a note, writing resolution, or explicit mark.
      const firstResponse =
        !before.respondedAt &&
        (d.markResponded === true ||
          (!!d.status && d.status !== "open" && d.status !== before.status) ||
          !!d.timelineNote ||
          !!d.resolutionNotes);
      if (firstResponse) patch.respondedAt = now;

      // Append activity-timeline entries for the meaningful changes.
      const at = now.toISOString();
      const by = session.userId;
      const entries: Array<{ at: string; by: string; event: string; note?: string }> = [];
      if (d.status && d.status !== before.status) entries.push({ at, by, event: "status", note: `${before.status} → ${d.status}` });
      if (firstResponse) entries.push({ at, by, event: "first_response", note: "First response recorded" });
      if (d.timelineNote) entries.push({ at, by, event: "note", note: d.timelineNote });
      if (d.resolutionNotes !== undefined && d.resolutionNotes !== before.resolutionNotes) entries.push({ at, by, event: "resolution", note: "Resolution notes updated" });
      if (d.assignedToUserId !== undefined && d.assignedToUserId !== before.assignedToUserId) entries.push({ at, by, event: "assigned", note: "Reassigned" });
      if (d.csatRating !== undefined) entries.push({ at, by, event: "csat", note: `CSAT ${d.csatRating}/5` });
      if (entries.length) patch.timeline = [ ...((before.timeline as any[]) ?? []), ...entries ];

      const after = await tx.update(serviceRequests).set(patch).where(and(eq(serviceRequests.id, id), eq(serviceRequests.tenantId, session.tenantId))).returning();

      // Low-CSAT escalation — a 1-2★ rating is a service failure the owner must
      // see immediately. Emit an event + drop a notification to every owner.
      if (d.csatRating !== undefined && d.csatRating <= 2) {
        await tx.insert(eventsOutbox).values({
          tenantId: session.tenantId,
          kind: "service_request.csat_low",
          entityType: "service_request",
          entityId: id,
          after: { ticketNo: before.ticketNo, rating: d.csatRating, comment: d.csatComment ?? null, investorId: before.investorId } as any,
          meta: { userId: session.userId } as any,
        } as any);
        await tx.execute(sql`
          INSERT INTO notifications (id, tenant_id, user_id, kind, title, body, link_url, created_at, updated_at)
          SELECT gen_random_uuid(), ${session.tenantId}::uuid, u.id, 'csat.low',
                 ${`Low CSAT (${d.csatRating}★) on ${before.ticketNo}`},
                 ${`A client rated their service ${d.csatRating}/5${d.csatComment ? `: "${String(d.csatComment).slice(0, 160)}"` : "."} Please follow up personally.`},
                 ${`/dashboard/service-requests/${id}`},
                 now(), now()
          FROM users u
          WHERE u.tenant_id = ${session.tenantId}::uuid AND 'owner' = ANY(u.roles) AND u.status = 'active'
        `);
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "service_request.status_change",
        entityType: "service_request",
        entityId: id,
        before: { status: before.status } as any,
        after: parse.data as any,
        ...clientMeta,
      });
      return after[0];
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "service_request.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);
    // ?purge=1 REMOVES the ticket; without it this closes it, which is what
    // this route has always done despite the verb. Two different intents:
    // closing is "dealt with", purging is "should never have existed".
    const purge = req.nextUrl.searchParams.get("purge") === "1";

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [before] = await tx
        .select()
        .from(serviceRequests)
        .where(and(eq(serviceRequests.id, id), eq(serviceRequests.tenantId, session.tenantId)))
        .limit(1);
      if (!before) return "not_found" as const;

      if (purge) {
        // A complaint is a REGULATORY record: SEBI expects it retained, with
        // its SCORES reference and its 21-day clock. Deleting one to tidy a
        // list is not a trade worth offering, so it can only ever be closed.
        if (before.type === "complaint") {
          return "complaint" as const;
        }
        await tx
          .delete(serviceRequests)
          .where(and(eq(serviceRequests.id, id), eq(serviceRequests.tenantId, session.tenantId)));
        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "service_request.delete",
          entityType: "service_request",
          entityId: id,
          before: { ticketNo: before.ticketNo, subject: before.subject, status: before.status },
          ...clientMeta,
        });
        return "deleted" as const;
      }

      await tx
        .update(serviceRequests)
        .set({ status: "closed", updatedAt: new Date() } as any)
        .where(and(eq(serviceRequests.id, id), eq(serviceRequests.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "service_request.close",
        entityType: "service_request",
        entityId: id,
        ...clientMeta,
      });
      return "closed" as const;
    });

    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (outcome === "complaint") {
      return NextResponse.json(
        { error: "A complaint is a regulatory record and can't be deleted — close it instead." },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true, deleted: outcome === "deleted" });
  } catch (err: any) {
    return handleApiError(err);
  }
}
