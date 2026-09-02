import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/ai/ask — conversational Q&A over the firm's REAL data.
 *
 * Body: { question }
 *
 * Safe-by-design: we never let the model write SQL. Instead we compute a live
 * snapshot of the firm's key metrics from the database (RLS-scoped to the tenant)
 * and hand it to the model as the ONLY source of truth, with a hard rule to
 * answer strictly from those figures (no invented numbers). This makes answers
 * accurate ("real database") without any SQL-injection / data-exfiltration risk.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { aiMessagesClient, isAiConfigured } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";

const Body = z.object({
  question: z.string().min(2).max(500),
  /** Prior turns for multi-turn follow-ups ("…and how many of those are HNI?"). */
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(12)
    .optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

    // The metrics below are computed from the DB and are useful on their own —
    // so we still answer (deterministically) even when no LLM is configured.
    const aiConfigured = await isAiConfigured();

    // ── Live metric snapshot (RLS-scoped to this tenant) ───────────────────
    const snapshot = await withTenant(session.tenantId, async (tx) => {
      const inv = (
        await tx.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE status <> 'closed' AND merged_into_id IS NULL AND deleted_at IS NULL)::int AS active_clients,
            COALESCE(SUM(aum) FILTER (WHERE status <> 'closed' AND merged_into_id IS NULL AND deleted_at IS NULL), 0)::numeric AS total_aum,
            COALESCE(SUM(active_sip_amount) FILTER (WHERE status <> 'closed' AND merged_into_id IS NULL AND deleted_at IS NULL), 0)::numeric AS monthly_sip_book,
            COUNT(*) FILTER (WHERE kyc_status NOT IN ('verified','registered') AND deleted_at IS NULL)::int AS kyc_pending,
            COUNT(*) FILTER (WHERE (nominee_name IS NULL OR nominee_name = '') AND deleted_at IS NULL AND status <> 'closed')::int AS no_nominee,
            COUNT(*) FILTER (WHERE segment_tag = 'HNI' AND deleted_at IS NULL)::int AS hni_clients,
            COUNT(*) FILTER (WHERE last_transaction_at < now() - make_interval(days => (SELECT dormancy_window_days FROM tenants WHERE id = ${session.tenantId}::uuid)) AND deleted_at IS NULL AND status <> 'closed')::int AS dormant_clients,
            (SELECT dormancy_window_days FROM tenants WHERE id = ${session.tenantId}::uuid)::int AS dormancy_window_days
          FROM investors WHERE tenant_id = ${session.tenantId}::uuid
        `)
      ).rows[0] as any;

      const top = (
        await tx.execute(sql`
          SELECT name, COALESCE(aum,0)::numeric AS aum FROM investors
          WHERE tenant_id = ${session.tenantId}::uuid AND status <> 'closed' AND merged_into_id IS NULL AND deleted_at IS NULL
          ORDER BY aum DESC NULLS LAST LIMIT 10
        `)
      ).rows as any[];

      const leads = (
        await tx.execute(sql`SELECT COUNT(*)::int AS open_leads FROM leads WHERE tenant_id = ${session.tenantId}::uuid AND stage NOT IN ('converted','lost','not_interested','not_qualified')`)
      ).rows[0] as any;

      const tasks = (
        await tx.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE status IN ('open','in_progress','blocked'))::int AS open_tasks,
            COUNT(*) FILTER (WHERE status IN ('open','in_progress','blocked') AND due_at < now())::int AS overdue_tasks
          FROM tasks WHERE tenant_id = ${session.tenantId}::uuid
        `)
      ).rows[0] as any;

      const sips = (
        await tx.execute(sql`SELECT COUNT(*)::int AS active_sips FROM sips WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'`)
      ).rows[0] as any;

      const ins = (
        await tx.execute(sql`
          SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active_policies,
                 COALESCE(SUM(annual_premium) FILTER (WHERE status = 'active'),0)::numeric AS active_annual_premium
          FROM insurance_policies WHERE tenant_id = ${session.tenantId}::uuid
        `)
      ).rows[0] as any;

      const meetings = (
        await tx.execute(sql`SELECT COUNT(*)::int AS upcoming_meetings FROM review_meetings WHERE tenant_id = ${session.tenantId}::uuid AND status IN ('scheduled','confirmed') AND meeting_date >= now()`)
      ).rows[0] as any;

      // AUM by RM (top 8) — answers "who's my biggest RM by book?".
      const byRm = (
        await tx.execute(sql`
          SELECT u.name, COALESCE(SUM(i.aum),0)::numeric AS aum, COUNT(*)::int AS clients
          FROM investors i JOIN users u ON u.id = i.rm_id
          WHERE i.tenant_id = ${session.tenantId}::uuid AND i.status <> 'closed' AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
          GROUP BY u.name ORDER BY aum DESC LIMIT 8
        `)
      ).rows as any[];

      // KYC status breakdown + new clients this month.
      const kyc = (
        await tx.execute(sql`
          SELECT COALESCE(kyc_status,'unknown') AS status, COUNT(*)::int AS n
          FROM investors WHERE tenant_id = ${session.tenantId}::uuid AND deleted_at IS NULL AND status <> 'closed'
          GROUP BY COALESCE(kyc_status,'unknown') ORDER BY n DESC
        `)
      ).rows as any[];

      const extra = (
        await tx.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS new_clients_this_month,
            COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS new_clients_30d
          FROM investors WHERE tenant_id = ${session.tenantId}::uuid AND deleted_at IS NULL
        `)
      ).rows[0] as any;

      const activeClients = Number(inv.active_clients);
      const totalAum = Number(inv.total_aum);

      return {
        active_clients: Number(inv.active_clients),
        total_aum_inr: Math.round(Number(inv.total_aum)),
        monthly_sip_book_inr: Math.round(Number(inv.monthly_sip_book)),
        kyc_pending_clients: Number(inv.kyc_pending),
        clients_without_nominee: Number(inv.no_nominee),
        hni_clients: Number(inv.hni_clients),
        dormant_clients: Number(inv.dormant_clients),
        dormancy_window_days: Number(inv.dormancy_window_days) || 180,
        open_leads: Number(leads.open_leads),
        open_tasks: Number(tasks.open_tasks),
        overdue_tasks: Number(tasks.overdue_tasks),
        active_sips: Number(sips.active_sips),
        active_insurance_policies: Number(ins.active_policies),
        active_insurance_annual_premium_inr: Math.round(Number(ins.active_annual_premium)),
        upcoming_meetings: Number(meetings.upcoming_meetings),
        new_clients_this_month: Number(extra.new_clients_this_month),
        new_clients_last_30d: Number(extra.new_clients_30d),
        avg_aum_per_client_inr: activeClients > 0 ? Math.round(totalAum / activeClients) : 0,
        top_clients_by_aum: top.map((t) => ({ name: t.name, aum_inr: Math.round(Number(t.aum)) })),
        aum_by_rm: byRm.map((r) => ({ rm: r.name, aum_inr: Math.round(Number(r.aum)), clients: Number(r.clients) })),
        kyc_status_breakdown: kyc.map((k) => ({ status: k.status, clients: Number(k.n) })),
      };
    });

    const system = `You are the analytics assistant inside an Indian Mutual Fund Distributor's CRM.
Answer the user's question using ONLY the JSON metrics below — these are LIVE, real figures for THIS firm.
Rules:
- Use ONLY these numbers. NEVER invent or estimate a figure that isn't present.
- If the question needs a metric that's not in the snapshot, say you don't track that yet and list 2-3 things you CAN answer.
- Format money in Indian style with the ₹ symbol (e.g. ₹1,23,45,000). Be concise (1-4 sentences or a short list).
- "AUM" = assets under management. "SIP book" = total monthly SIP amount.

LIVE METRICS (JSON):
${JSON.stringify(snapshot, null, 2)}`;

    // A deterministic, always-correct one-liner straight from the live metrics —
    // used when the AI provider is busy/unconfigured so the user STILL gets real
    // data (the numbers are computed from the DB, not the model).
    const fallbackAnswer = deterministicAnswer(parse.data.question, snapshot);

    // Carry prior turns so follow-ups ("…and how many of those are HNI?") resolve.
    const history = (parse.data.history ?? []).slice(-8).map((m) => ({ role: m.role, content: m.content }));
    let answer = fallbackAnswer;
    let aiUsed = false;
    if (aiConfigured) {
      try {
        const res = await aiMessagesClient().messages.create({
          model: "fast",
          max_tokens: 600,
          system,
          messages: [...history, { role: "user", content: parse.data.question }],
        });
        const text = res.content
          .filter((b) => b.type === "text")
          .map((b: any) => b.text)
          .join("\n")
          .trim();
        if (text) {
          answer = text;
          aiUsed = true;
        }
      } catch {
        // AI provider busy / rate-limited / down — fall back to the deterministic
        // answer. We still return 200 with the REAL metrics rather than a 500.
      }
    }

    return NextResponse.json({ answer, metrics: snapshot, aiUsed });
  } catch (err: any) {
    return handleApiError(err);
  }
}

/** A safe, numbers-only answer built straight from the live snapshot. Keyword-
 *  matched to the question so the user always gets real data even with no LLM. */
function deterministicAnswer(question: string, s: any): string {
  const q = question.toLowerCase();
  const inr = (n: number) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
  const has = (...k: string[]) => k.some((x) => q.includes(x));
  if (has("aum", "assets under")) {
    if (has("rm", "manager")) {
      const lines = (s.aum_by_rm ?? []).map((r: any) => `• ${r.rm}: ${inr(r.aum_inr)} (${r.clients})`);
      return lines.length ? `AUM by RM:\n${lines.join("\n")}` : "No RM-wise AUM yet.";
    }
    return `Total AUM is ${inr(s.total_aum_inr)} across ${s.active_clients} active clients (avg ${inr(s.avg_aum_per_client_inr)} per client).`;
  }
  if (has("kyc")) return `${s.kyc_pending_clients} clients are KYC-pending.`;
  if (has("sip")) return `You have ${s.active_sips} active SIPs — a monthly SIP book of ${inr(s.monthly_sip_book_inr)}.`;
  if (has("nominee")) return `${s.clients_without_nominee} clients have no nominee on file.`;
  if (has("dormant")) return `${s.dormant_clients} clients are dormant (no transaction in ${s.dormancy_window_days} days).`;
  if (has("new", "this month")) return `${s.new_clients_this_month} new clients this month (${s.new_clients_last_30d} in the last 30 days).`;
  if (has("top", "biggest", "largest")) {
    const lines = (s.top_clients_by_aum ?? []).slice(0, 10).map((t: any, i: number) => `${i + 1}. ${t.name} — ${inr(t.aum_inr)}`);
    return lines.length ? `Top clients by AUM:\n${lines.join("\n")}` : "No clients yet.";
  }
  if (has("lead")) return `${s.open_leads} open leads in the pipeline.`;
  if (has("task")) return `${s.open_tasks} open tasks (${s.overdue_tasks} overdue).`;
  if (has("insurance", "policy", "policies")) return `${s.active_insurance_policies} active policies — ${inr(s.active_insurance_annual_premium_inr)} annual premium.`;
  if (has("meeting")) return `${s.upcoming_meetings} upcoming meetings scheduled.`;
  if (has("hni")) return `${s.hni_clients} HNI clients.`;
  // Generic snapshot summary.
  return `Here's your firm right now: ${s.active_clients} active clients · ${inr(s.total_aum_inr)} AUM · ${s.active_sips} active SIPs (${inr(s.monthly_sip_book_inr)}/mo) · ${s.open_leads} open leads · ${s.open_tasks} open tasks. Ask about AUM, KYC, SIPs, top clients, dormant clients and more.`;
}
