import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/review-meetings/[id]/prep — one-click Meeting Prep Pack.
 *
 * Assembles everything the RM needs before a review meeting in one call:
 *   - client snapshot (AUM, risk profile, SIPs, folios, top holdings)
 *   - what changed since the last completed meeting (transactions, comms)
 *   - open items (tasks) + goals
 *   - AI talking points (same provider-agnostic layer as the client brief);
 *     if AI isn't configured the deterministic sections still return, with
 *     `aiUnavailable: true`.
 *
 * Advisory only — nothing is persisted or auto-sent.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { generateMeetingPrepPoints } from "@/lib/ai/assistant";
import { isAiConfigured } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";

type OpenItem = { title: string; dueAt: string | null };
type GoalRow = { name: string; targetAmount: number; progressPct: number | null };

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    // Mirror the single-meeting GET: either manage.all or manage.assigned
    // (assigned RMs may only prep their own meetings).
    requireAny(session.roles, ["review_meeting.manage.all", "review_meeting.manage.assigned"], session.permissions);
    const canAll = can(session.roles, "review_meeting.manage.all", session.permissions);

    const pack = await withTenant(
      session.tenantId,
      async (tx) => {
        const m = (await tx.execute(sql`
          SELECT m.id, m.investor_id, m.lead_id, m.rm_id, m.meeting_date, m.status,
                 COALESCE(i.name, l.name) AS subject_name
          FROM review_meetings m
          LEFT JOIN investors i ON i.id = m.investor_id
          LEFT JOIN leads l ON l.id = m.lead_id
          WHERE m.id = ${id}::uuid AND m.tenant_id = ${session.tenantId}::uuid
          LIMIT 1
        `)).rows[0] as any;
        if (!m) return null;
        if (!canAll && m.rm_id !== session.userId) return { forbidden: true as const };

        const isLead = !m.investor_id && !!m.lead_id;

        // ── Client snapshot ──────────────────────────────────────────────
        let client: Record<string, unknown>;
        let goals: GoalRow[] = [];
        if (!isLead) {
          const inv = (await tx.execute(sql`
            SELECT i.name, i.risk_profile, i.service_tier,
                   COALESCE(i.aum, 0)::numeric AS aum,
                   i.last_transaction_at,
                   (SELECT count(*) FROM sips s
                      WHERE s.investor_id = i.id
                        AND s.status NOT IN ('stopped','cancelled','completed'))::int AS active_sip_count,
                   (SELECT COALESCE(sum(s.amount), 0) FROM sips s
                      WHERE s.investor_id = i.id
                        AND s.status NOT IN ('stopped','cancelled','completed'))::numeric AS sip_monthly_total,
                   (SELECT count(*) FROM folios f WHERE f.investor_id = i.id)::int AS folio_count
            FROM investors i
            WHERE i.id = ${m.investor_id}::uuid AND i.tenant_id = ${session.tenantId}::uuid
            LIMIT 1
          `)).rows[0] as any;
          if (!inv) return null;

          const holdings = (await tx.execute(sql`
            SELECT s->>'schemeName' AS scheme_name,
                   s->>'category' AS category,
                   SUM(COALESCE((s->>'value')::numeric, 0)) AS value
            FROM folios f, jsonb_array_elements(COALESCE(f.schemes, '[]'::jsonb)) s
            WHERE f.tenant_id = ${session.tenantId}::uuid AND f.investor_id = ${m.investor_id}::uuid
              AND s->>'schemeName' IS NOT NULL
            GROUP BY s->>'schemeName', s->>'category'
            ORDER BY value DESC LIMIT 3
          `)).rows as any[];

          client = {
            id: m.investor_id,
            kind: "investor" as const,
            name: inv.name,
            aum: Number(inv.aum ?? 0),
            riskProfile: inv.risk_profile ?? null,
            serviceTier: inv.service_tier ?? null,
            lastTransactionAt: inv.last_transaction_at ?? null,
            activeSipCount: Number(inv.active_sip_count ?? 0),
            sipMonthlyTotal: Number(inv.sip_monthly_total ?? 0),
            folioCount: Number(inv.folio_count ?? 0),
            topHoldings: holdings.map((h) => ({
              name: String(h.scheme_name),
              category: h.category ? String(h.category) : null,
              value: Number(h.value ?? 0),
            })),
          };

          const goalRows = (await tx.execute(sql`
            SELECT name, COALESCE(target_amount, 0)::numeric AS target_amount, progress_pct
            FROM goals
            WHERE tenant_id = ${session.tenantId}::uuid AND investor_id = ${m.investor_id}::uuid
              AND status NOT IN ('achieved','abandoned')
            ORDER BY target_date ASC LIMIT 3
          `)).rows as any[];
          goals = goalRows.map((g) => ({
            name: String(g.name),
            targetAmount: Number(g.target_amount ?? 0),
            progressPct: g.progress_pct != null ? Number(g.progress_pct) : null,
          }));
        } else {
          const ld = (await tx.execute(sql`
            SELECT name, stage, source, expected_business_amount, last_contact_at
            FROM leads
            WHERE id = ${m.lead_id}::uuid AND tenant_id = ${session.tenantId}::uuid
            LIMIT 1
          `)).rows[0] as any;
          if (!ld) return null;
          client = {
            id: m.lead_id,
            kind: "lead" as const,
            name: ld.name,
            stage: ld.stage ?? null,
            source: ld.source ?? null,
            expectedBusinessAmount: ld.expected_business_amount != null ? Number(ld.expected_business_amount) : null,
            lastContactAt: ld.last_contact_at ?? null,
          };
        }

        // ── Since the last completed meeting ─────────────────────────────
        const subjectCol = isLead ? sql`lead_id = ${m.lead_id}::uuid` : sql`investor_id = ${m.investor_id}::uuid`;
        const prev = (await tx.execute(sql`
          SELECT meeting_date FROM review_meetings
          WHERE tenant_id = ${session.tenantId}::uuid AND ${subjectCol}
            AND status = 'completed' AND id <> ${id}::uuid
            AND meeting_date < ${new Date(m.meeting_date).toISOString()}::timestamptz
          ORDER BY meeting_date DESC LIMIT 1
        `)).rows[0] as any;
        const lastMeetingAt: string | null = prev?.meeting_date ? new Date(prev.meeting_date).toISOString() : null;

        const sinceLast: Record<string, unknown> = {
          lastMeetingAt,
          firstReview: !lastMeetingAt,
        };
        if (lastMeetingAt) {
          if (!isLead) {
            const txn = (await tx.execute(sql`
              SELECT count(*)::int AS tx_count,
                     COALESCE(SUM(CASE
                       WHEN t.direction = 'inflow' THEN COALESCE(t.amount, 0)
                       WHEN t.direction = 'outflow' THEN -COALESCE(t.amount, 0)
                       ELSE 0 END), 0)::numeric AS net_invested
              FROM transactions t
              WHERE t.tenant_id = ${session.tenantId}::uuid AND t.investor_id = ${m.investor_id}::uuid
                AND t.order_date >= ${lastMeetingAt.slice(0, 10)}::date
                AND t.status NOT IN ('rejected','cancelled','failed')
            `)).rows[0] as any;
            sinceLast.transactionCount = Number(txn?.tx_count ?? 0);
            sinceLast.netInvested = Number(txn?.net_invested ?? 0);
          }
          const comms = (await tx.execute(sql`
            SELECT count(*)::int AS n FROM communications c
            WHERE c.tenant_id = ${session.tenantId}::uuid
              AND ${isLead ? sql`c.lead_id = ${m.lead_id}::uuid` : sql`c.investor_id = ${m.investor_id}::uuid`}
              AND c.created_at >= ${lastMeetingAt}::timestamptz
          `)).rows[0] as any;
          sinceLast.communicationsCount = Number(comms?.n ?? 0);
        }

        // ── Open items (tasks on this subject) ───────────────────────────
        const taskRows = (await tx.execute(sql`
          SELECT title, due_at FROM tasks
          WHERE tenant_id = ${session.tenantId}::uuid
            AND subject_type = ${isLead ? "lead" : "investor"}
            AND subject_id = ${(isLead ? m.lead_id : m.investor_id)}::uuid
            AND status IN ('open','in_progress')
          ORDER BY due_at ASC NULLS LAST LIMIT 5
        `)).rows as any[];
        const openItems: OpenItem[] = taskRows.map((t) => ({
          title: String(t.title),
          dueAt: t.due_at ? new Date(t.due_at).toISOString() : null,
        }));

        return {
          meeting: {
            id: m.id as string,
            scheduledAt: new Date(m.meeting_date).toISOString(),
          },
          subjectName: (m.subject_name ?? "Subject") as string,
          isLead,
          client,
          sinceLast,
          openItems,
          goals,
        };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    if (!pack) return NextResponse.json({ error: "not found" }, { status: 404 });
    if ("forbidden" in pack) {
      return NextResponse.json({ error: "you can only prep your own meetings" }, { status: 403 });
    }

    // ── AI talking points — outside the DB transaction, degrade gracefully ──
    let talkingPoints: string[] = [];
    let aiUnavailable = false;
    if (await isAiConfigured()) {
      const ai = await generateMeetingPrepPoints({
        clientName: pack.subjectName,
        isLead: pack.isLead,
        meetingDateIso: pack.meeting.scheduledAt,
        snapshot: pack.client,
        sinceLast: pack.sinceLast,
        openItems: pack.openItems,
        goals: pack.goals.map((g) => ({ name: g.name, targetAmountInr: g.targetAmount, progressPct: g.progressPct })),
      });
      if ("error" in ai) {
        aiUnavailable = true;
      } else {
        talkingPoints = [...ai.talkingPoints, ...ai.questions.map((q) => `Ask: ${q}`)];
      }
    } else {
      aiUnavailable = true;
    }

    return NextResponse.json({
      meeting: pack.meeting,
      client: pack.client,
      sinceLast: pack.sinceLast,
      openItems: pack.openItems,
      goals: pack.goals,
      talkingPoints,
      ...(aiUnavailable ? { aiUnavailable: true } : {}),
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
