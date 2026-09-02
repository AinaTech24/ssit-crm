/**
 * Background worker for Marketing Campaigns — the broadcast fan-out.
 *
 * For each campaign in 'sending' status, in three phases per tick:
 *   1. PLAN  — short transaction, claims the campaign row FOR UPDATE, resolves
 *              the next batch of unsent recipients (batch size honours
 *              throttlePerMinute) and records skips for no-contact members.
 *   2. SEND  — each recipient dispatched in ITS OWN transaction, so a committed
 *              communications row exists per send (durable, resumable) and a
 *              failure can't roll back already-sent messages → no double-send.
 *   3. RECONCILE — recompute the campaign's delivery counters from the logs.
 */

import { and, eq, sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { withTenant, withSystem } from "@/db/client";
import { campaigns, segments, segmentMemberships, investors, leads, templates, communications } from "@/db/schema";
import { dispatch } from "@/lib/comms/pipeline";
import { isBroadcastCampaign } from "@/lib/campaigns/broadcast";
import { recomputeCampaignRoi } from "@/lib/campaigns/roi";
import { captureError } from "@/lib/observability/capture";

/** Deterministic A/B bucket for a subject. Returns the variant ('a' | 'b') the
 *  subject falls into given the % of the audience assigned to B. Stable per
 *  subject so re-runs don't reshuffle. */
function pickVariant(subjectId: string, splitPctToB: number): "a" | "b" {
  let h = 2166136261;
  for (let i = 0; i < subjectId.length; i++) {
    h ^= subjectId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100 < splitPctToB ? "b" : "a";
}

/** Tick cadence (15s) → 4 ticks/minute. Batch size = throttlePerMinute / 4 so
 *  the configured per-minute rate is actually respected. */
const TICKS_PER_MIN = 4;
const MAX_BATCH = 200;

type Recipient = { subjectId: string; name: string; contact: string; kind: "investor" | "lead" };

export async function processActiveCampaigns(): Promise<number> {
  const active = await withSystem(async (tx) =>
    tx.select({ id: campaigns.id, tenantId: campaigns.tenantId }).from(campaigns).where(eq(campaigns.status, "sending"))
  );

  let completedCount = 0;
  for (const c of active) {
    try {
      const completed = await processOneCampaign(c.tenantId, c.id);
      if (completed) completedCount++;
    } catch (err: any) {
      captureError("[campaign-dispatcher] campaign run failed", err, { campaignId: c.id });
    }
  }
  return completedCount;
}

async function processOneCampaign(tenantId: string, campaignId: string): Promise<boolean> {
  // ── Phase 1: PLAN (short tx, claim row FOR UPDATE so two ticks/workers
  //    don't plan the same batch concurrently) ──────────────────────────────
  const plan = await withTenant(tenantId, async (tx) => {
    const claimed = await tx.execute(
      sql`SELECT * FROM campaigns WHERE id = ${campaignId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE` as any
    );
    const c = claimed.rows?.[0] as any;
    if (!c || c.status !== "sending") return { done: true as const };

    // Broadcast = channel + template + segment (NOT kind). A non-broadcast
    // campaign (seminar / social log) has nothing to send — complete it.
    if (!isBroadcastCampaign({ channel: c.channel, templateId: c.template_id, segmentId: c.segment_id })) {
      await markSent(tx, campaignId, tenantId);
      return { done: true as const };
    }

    const [seg] = await tx
      .select()
      .from(segments)
      .where(and(eq(segments.id, c.segment_id), eq(segments.tenantId, tenantId)))
      .limit(1);
    const [tpl] = await tx
      .select()
      .from(templates)
      .where(and(eq(templates.id, c.template_id), eq(templates.tenantId, tenantId)))
      .limit(1);
    if (!seg || !tpl) {
      await cancel(tx, campaignId, tenantId, "Linked segment or template not found.");
      return { done: true as const };
    }

    // A/B: load the optional second template variant. Each recipient is bucketed
    // into A or B (unless a winner has been picked, in which case everyone gets it).
    let variantTpl: any = null;
    if (c.variant_template_id) {
      [variantTpl] = await tx
        .select()
        .from(templates)
        .where(and(eq(templates.id, c.variant_template_id), eq(templates.tenantId, tenantId)))
        .limit(1);
    }

    const members = await tx
      .select()
      .from(segmentMemberships)
      .where(
        and(
          eq(segmentMemberships.segmentId, c.segment_id),
          eq(segmentMemberships.tenantId, tenantId),
          sql`${segmentMemberships.removedAt} IS NULL`
        )
      );

    // Already-processed recipients (any communications row — sent OR skipped —
    // counts, so no-contact skips don't get retried forever).
    const sentComms = await tx
      .select({ investorId: communications.investorId, leadId: communications.leadId })
      .from(communications)
      .where(and(eq(communications.campaignId, campaignId), eq(communications.tenantId, tenantId)));
    const processedIds = new Set(sentComms.map((s) => s.investorId || s.leadId).filter(Boolean));

    const unsent = members.filter((m) => !processedIds.has(m.subjectId));
    if (unsent.length === 0) {
      await markSent(tx, campaignId, tenantId);
      return { done: true as const };
    }

    const batchSize = Math.max(1, Math.min(MAX_BATCH, Math.floor(Number(c.throttle_per_minute ?? 60) / TICKS_PER_MIN)));
    const batch = unsent.slice(0, batchSize);
    const overrides = (c.variable_overrides ?? {}) as Record<string, Record<string, string>>;

    const recipients: Recipient[] = [];
    for (const m of batch) {
      let subj: any = null;
      if (seg.subjectType === "investor") {
        subj = (await tx.select().from(investors).where(and(eq(investors.id, m.subjectId), eq(investors.tenantId, tenantId))).limit(1))[0];
      } else if (seg.subjectType === "lead") {
        subj = (await tx.select().from(leads).where(and(eq(leads.id, m.subjectId), eq(leads.tenantId, tenantId))).limit(1))[0];
      }
      const contact = subj ? (c.channel === "email" ? subj.email : subj.phone) : null;
      if (!subj || !contact) {
        // Record a skip so this member leaves `unsent` — otherwise no-contact
        // members permanently occupy the batch and the campaign never finishes.
        await tx.insert(communications).values({
          tenantId,
          channel: c.channel,
          direction: "outbound",
          status: "skipped_no_contact",
          statusReason: subj ? `no ${c.channel === "email" ? "email" : "phone"} on file` : "subject not found",
          campaignId,
          templateKey: tpl.key,
          investorId: seg.subjectType === "investor" ? m.subjectId : null,
          leadId: seg.subjectType === "lead" ? m.subjectId : null,
        } as any);
        continue;
      }
      recipients.push({ subjectId: m.subjectId, name: subj.name ?? "", contact, kind: seg.subjectType as "investor" | "lead" });
    }

    return {
      done: false as const,
      channel: c.channel as string,
      tplKey: tpl.key as string,
      tplKeyB: (variantTpl?.key as string | undefined) ?? null,
      abSplitPct: Math.max(0, Math.min(100, Number(c.ab_split_pct ?? 50))),
      abWinner: (c.ab_winner as "a" | "b" | null) ?? null,
      recipients,
      overrides,
    };
  });

  if (plan.done) {
    await recomputeCounters(tenantId, campaignId);
    return true;
  }

  // ── Phase 2: SEND — each recipient in its OWN transaction ─────────────────
  for (const r of plan.recipients) {
    // Resolve which template + variant this recipient gets. A picked winner
    // overrides the split (everyone left gets the winner); otherwise bucket by
    // the deterministic split. With no B template, it's a plain single-variant send.
    let variant: "a" | "b" | undefined;
    let templateKey = plan.tplKey;
    if (plan.tplKeyB) {
      if (plan.abWinner) {
        variant = plan.abWinner;
      } else {
        variant = pickVariant(r.subjectId, plan.abSplitPct);
      }
      templateKey = variant === "b" && plan.tplKeyB ? plan.tplKeyB : plan.tplKey;
    }
    try {
      await withTenant(tenantId, async (tx) => {
        await dispatch(tx, {
          tenantId,
          channel: plan.channel as any,
          templateKey,
          recipient: r.contact,
          variables: { name: r.name, ...(plan.overrides[r.subjectId] ?? {}) },
          category: "marketing",
          ...(r.kind === "investor" ? { investorId: r.subjectId } : { leadId: r.subjectId }),
          campaignId,
          ...(variant ? { variant } : {}),
        } as any);
      });
    } catch (e: any) {
      console.error(`[campaign-dispatcher] send failed for ${r.kind} ${r.subjectId}:`, e?.message);
    }
  }

  // ── Phase 3: RECONCILE counters ──────────────────────────────────────────
  await recomputeCounters(tenantId, campaignId);
  return false; // batch processed; more likely remain
}

/**
 * Promote scheduled campaigns whose send time has arrived to 'sending' — only
 * when they're a valid, approved broadcast. Without this, a campaign created
 * with a `scheduledAt` would sit in 'scheduled' forever (the dispatcher only
 * processes 'sending'). Invalid/unapproved ones are left scheduled.
 */
export async function promoteDueScheduledCampaigns(): Promise<number> {
  const due = await withSystem(async (tx) =>
    tx.execute(sql`SELECT id, tenant_id FROM campaigns WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= now()` as any)
  );
  let promoted = 0;
  for (const row of (due.rows ?? []) as any[]) {
    try {
      const ok = await withTenant(row.tenant_id, async (tx) => {
        const [c] = await tx
          .select()
          .from(campaigns)
          .where(and(eq(campaigns.id, row.id), eq(campaigns.tenantId, row.tenant_id)))
          .limit(1);
        if (!c || c.status !== "scheduled") return false;
        if (!isBroadcastCampaign(c)) return false; // not a real broadcast — leave as-is
        const [tpl] = await tx
          .select()
          .from(templates)
          .where(and(eq(templates.id, c.templateId as string), eq(templates.tenantId, row.tenant_id)))
          .limit(1);
        if (!tpl || tpl.status !== "approved") return false;
        if (c.approvalStatus !== "approved" && c.approvalStatus !== "not_required") return false;
        await tx
          .update(campaigns)
          .set({ status: "sending", startedAt: new Date(), updatedAt: new Date() } as any)
          .where(and(eq(campaigns.id, row.id), eq(campaigns.tenantId, row.tenant_id)));
        return true;
      });
      if (ok) promoted++;
    } catch (err: any) {
      captureError("[campaign-dispatcher] scheduled-campaign promote failed", err, { campaignId: row.id });
    }
  }
  return promoted;
}

async function markSent(tx: any, campaignId: string, tenantId: string) {
  await tx
    .update(campaigns)
    .set({ status: "sent", completedAt: new Date(), updatedAt: new Date() } as any)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.tenantId, tenantId)));

  // Attribute ROI (meetings booked / clients converted) the moment the send
  // finishes — early numbers; a marketer can also re-run it later from the UI as
  // more outcomes land inside the attribution window.
  try {
    await recomputeCampaignRoi(tx, tenantId, campaignId);
  } catch (err: any) {
    captureError("[campaign-dispatcher] ROI attribution failed", err, { campaignId });
  }

  // Recurrence: if this campaign repeats, clone it as a fresh scheduled run for
  // the next interval (re-using the same dynamic segment, so membership is
  // re-evaluated at the next send). Bounded by recurrenceUntil.
  try {
    await maybeCloneRecurring(tx, tenantId, campaignId);
  } catch (err: any) {
    captureError("[campaign-dispatcher] recurrence clone failed", err, { campaignId });
  }
}

/** Next fire time for a recurrence kind, computed from `from`. */
function nextOccurrence(from: Date, recurrence: string): Date | null {
  const d = new Date(from);
  if (recurrence === "daily") d.setDate(d.getDate() + 1);
  else if (recurrence === "weekly") d.setDate(d.getDate() + 7);
  else if (recurrence === "monthly") d.setMonth(d.getMonth() + 1);
  else return null;
  return d;
}

/**
 * Clone a completed recurring campaign into a new 'scheduled' run for the next
 * interval. The clone points at the same segment + template(s); counters reset.
 * Stops when the next occurrence would fall after `recurrenceUntil`.
 */
async function maybeCloneRecurring(tx: any, tenantId: string, campaignId: string) {
  const [c] = await tx.select().from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.tenantId, tenantId))).limit(1);
  if (!c || !c.recurrence || c.recurrence === "none") return;
  if (!isBroadcastCampaign(c)) return;

  const base = c.scheduledAt ? new Date(c.scheduledAt) : c.startedAt ? new Date(c.startedAt) : new Date();
  const next = nextOccurrence(base, c.recurrence as string);
  if (!next) return;
  if (c.recurrenceUntil && next > new Date(c.recurrenceUntil)) return;

  const newId = uuid();
  await tx.insert(campaigns).values({
    id: newId,
    tenantId,
    name: c.name,
    description: c.description,
    kind: c.kind,
    theme: c.theme,
    channel: c.channel,
    templateId: c.templateId,
    templateVersionId: c.templateVersionId,
    variantTemplateId: c.variantTemplateId,
    variantTemplateVersionId: c.variantTemplateVersionId,
    abSplitPct: c.abSplitPct,
    segmentId: c.segmentId,
    targetAudience: c.targetAudience,
    status: "scheduled",
    scheduledAt: next,
    throttlePerMinute: c.throttlePerMinute,
    // Carry approval forward so the recurring run isn't stuck pending each cycle.
    approvalStatus: c.approvalStatus,
    contentStatus: c.contentStatus,
    complianceCheckStatus: c.complianceCheckStatus,
    recurrence: c.recurrence,
    recurrenceUntil: c.recurrenceUntil,
    parentCampaignId: c.parentCampaignId ?? c.id,
    campaignCost: c.campaignCost,
    variableOverrides: c.variableOverrides,
    createdByUserId: c.createdByUserId,
  } as any);
}

async function cancel(tx: any, campaignId: string, tenantId: string, reason: string) {
  await tx
    .update(campaigns)
    .set({ status: "cancelled", remarks: `Cancelled automatically: ${reason}`, updatedAt: new Date() } as any)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.tenantId, tenantId)));
}

async function recomputeCounters(tenantId: string, campaignId: string) {
  await withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({ status: communications.status, count: sql<number>`COUNT(*)::int` })
      .from(communications)
      .where(and(eq(communications.campaignId, campaignId), eq(communications.tenantId, tenantId)))
      .groupBy(communications.status);

    // Clicks are orthogonal to the delivery status (a delivered/read message can
    // also be clicked) — count them separately from the clicked_at stamp.
    const [{ clicked }] = await tx
      .select({ clicked: sql<number>`count(*) FILTER (WHERE ${communications.clickedAt} IS NOT NULL)::int` })
      .from(communications)
      .where(and(eq(communications.campaignId, campaignId), eq(communications.tenantId, tenantId)));

    let queued = 0, sent = 0, delivered = 0, read = 0, replied = 0, failed = 0, bounced = 0, unsubscribed = 0;
    let total = 0;
    for (const row of rows) {
      const n = Number(row.count ?? 0);
      total += n;
      const s = row.status as string;
      if (s === "queued" || s === "scheduled") queued += n;
      else if (s === "sent") sent += n;
      else if (s === "delivered") { delivered += n; sent += n; }
      else if (s === "read") { read += n; delivered += n; sent += n; }
      else if (s === "replied") { replied += n; read += n; delivered += n; sent += n; }
      else if (s === "bounced") { bounced += n; failed += n; }
      else if (s === "unsubscribed") { unsubscribed += n; }
      else if (s === "failed" || s.startsWith("skipped_")) failed += n;
    }

    await tx
      .update(campaigns)
      .set({
        queuedCount: queued,
        sentCount: sent,
        deliveredCount: delivered,
        readCount: read,
        repliedCount: replied,
        clickedCount: Number(clicked ?? 0),
        failedCount: failed,
        bouncedCount: bounced,
        unsubscribedCount: unsubscribed,
        updatedAt: new Date(),
      } as any)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.tenantId, tenantId)));
  });
}

export function startCampaignDispatcherWorker() {
  const interval = 15_000; // 15s → TICKS_PER_MIN
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const launched = await promoteDueScheduledCampaigns();
      if (launched > 0) console.log(`[campaign-dispatcher] launched ${launched} scheduled campaign(s)`);
      const processed = await processActiveCampaigns();
      if (processed > 0) {
        console.log(`[campaign-dispatcher] completed ${processed} campaign(s)`);
      }
    } catch (err: any) {
      captureError("[campaign-dispatcher] tick error", err);
    } finally {
      running = false;
    }
  };

  const handle = setInterval(tick, interval);
  console.log(`[campaign-dispatcher] worker started (interval=${interval}ms)`);
  return () => clearInterval(handle);
}
