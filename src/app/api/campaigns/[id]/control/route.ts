import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/campaigns/[id]/control  — body: { action: "pause" | "resume" | "cancel" }
 *
 * Lifecycle controls for an in-flight (or queued) broadcast:
 *   - pause   : sending → paused   (dispatcher only processes 'sending', so it stops)
 *   - resume  : paused  → sending  (resumes from where it left off — already-sent
 *               recipients have communications rows, so they're skipped)
 *   - cancel  : draft/scheduled/sending/paused → cancelled  (the kill switch)
 *
 * The dispatcher mid-send is safe to pause: each recipient is sent in its own
 * transaction, so pausing simply stops the next tick from picking up new ones.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { campaigns, communications } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({ action: z.enum(["pause", "resume", "cancel", "retry_failed"]) });

/** Allowed source statuses per action. */
const ALLOWED: Record<string, string[]> = {
  pause: ["sending"],
  resume: ["paused"],
  cancel: ["draft", "scheduled", "sending", "paused"],
  // Retry only makes sense once a run has finished (or is paused) and left failures behind.
  retry_failed: ["sent", "paused"],
};
const NEXT: Record<string, string> = { pause: "paused", resume: "sending", cancel: "cancelled", retry_failed: "sending" };

/**
 * Statuses that are worth retrying — transient delivery failures + skips caused
 * by temporary ceilings. We deliberately do NOT retry permanent skips:
 *   skipped_consent      (client opted out)
 *   skipped_no_contact   (no email/phone on file)
 *   skipped_compliance   (would just re-block)
 *   skipped_session      (WhatsApp window closed)
 * — those would fail identically on a re-run.
 */
const RETRYABLE = ["failed", "skipped_rate_limit", "skipped_quota", "skipped_frequency_cap"] as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "campaign.send", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid action" }, { status: 400 });
    const { action } = parsed.data;
    const meta = clientMetaFromHeaders(req.headers);

    const out = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.tenantId, session.tenantId))).limit(1))[0];
      if (!before) return { kind: "not_found" as const };
      if (!ALLOWED[action].includes(before.status as string)) {
        return { kind: "bad_state" as const, status: before.status };
      }

      // Retry: clear the retryable communications rows so the dispatcher sees
      // those subjects as "unsent" again, then flip the campaign back to sending.
      let retried = 0;
      if (action === "retry_failed") {
        const del = await tx
          .delete(communications)
          .where(
            and(
              eq(communications.tenantId, session.tenantId),
              eq(communications.campaignId, id),
              inArray(communications.status, [...RETRYABLE])
            )
          )
          .returning({ delId: communications.id });
        retried = del.length;
        if (retried === 0) {
          return { kind: "noop" as const };
        }
      }

      const next = NEXT[action];
      const patch: any = { status: next, updatedAt: new Date() };
      if (action === "resume") patch.startedAt = before.startedAt ?? new Date();
      if (action === "retry_failed") {
        patch.completedAt = null;
        patch.startedAt = before.startedAt ?? new Date();
      }
      if (action === "cancel") patch.completedAt = new Date();

      const [r] = await tx.update(campaigns).set(patch).where(and(eq(campaigns.id, id), eq(campaigns.tenantId, session.tenantId))).returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: `campaign.${action}`,
        entityType: "campaign",
        entityId: id,
        before: { status: before.status },
        after: { status: next },
        ...meta,
      });
      return { kind: "ok" as const, campaign: r, retried };
    });

    if (out.kind === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (out.kind === "bad_state") {
      return NextResponse.json({ error: `cannot ${action} a campaign in '${out.status}' status` }, { status: 409 });
    }
    if (out.kind === "noop") {
      return NextResponse.json({ error: "No retryable failures — nothing to retry. (Opt-outs, missing contacts and compliance blocks aren't retried.)" }, { status: 409 });
    }
    return NextResponse.json({ ...out.campaign, retried: out.retried });
  } catch (err: any) {
    return handleApiError(err);
  }
}
