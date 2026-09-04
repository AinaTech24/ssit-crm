/**
 * Live, RLS-scoped snapshot of a firm's key metrics — the ONLY source of truth
 * the AI assistant is allowed to answer from. The model never sees or writes SQL;
 * it only receives these already-computed figures, so answers are accurate and
 * there's no injection / exfiltration surface. Shared by /api/ai/ask and the
 * AI-assistant chat endpoint.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

export type FirmSnapshot = {
  active_clients: number;
  total_aum_inr: number;
  monthly_sip_book_inr: number;
  kyc_pending_clients: number;
  clients_without_nominee: number;
  hni_clients: number;
  dormant_clients: number;
  /** The firm's dormancy window in days (tenants.dormancy_window_days) — so the
   *  answer text can state the window it used instead of a hardcoded number. */
  dormancy_window_days: number;
  open_leads: number;
  open_tasks: number;
  overdue_tasks: number;
  active_sips: number;
  active_insurance_policies: number;
  active_insurance_annual_premium_inr: number;
  upcoming_meetings: number;
  new_clients_this_month: number;
  new_clients_last_30d: number;
  avg_aum_per_client_inr: number;
  top_clients_by_aum: Array<{ name: string; aum_inr: number }>;
  aum_by_rm: Array<{ rm: string; aum_inr: number; clients: number }>;
  kyc_status_breakdown: Array<{ status: string; clients: number }>;
};

/** Run inside withTenant(tenantId, …) so RLS + the explicit tenant filter agree. */
export async function firmSnapshot(tx: Tx, tenantId: string): Promise<FirmSnapshot> {
  const inv = (
    await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status <> 'closed' AND merged_into_id IS NULL AND deleted_at IS NULL)::int AS active_clients,
        COALESCE(SUM(aum) FILTER (WHERE status <> 'closed' AND merged_into_id IS NULL AND deleted_at IS NULL), 0)::numeric AS total_aum,
        COALESCE(SUM(active_sip_amount) FILTER (WHERE status <> 'closed' AND merged_into_id IS NULL AND deleted_at IS NULL), 0)::numeric AS monthly_sip_book,
        COUNT(*) FILTER (WHERE kyc_status NOT IN ('verified','registered') AND deleted_at IS NULL)::int AS kyc_pending,
        COUNT(*) FILTER (WHERE (nominee_name IS NULL OR nominee_name = '') AND deleted_at IS NULL AND status <> 'closed')::int AS no_nominee,
        COUNT(*) FILTER (WHERE segment_tag = 'HNI' AND deleted_at IS NULL)::int AS hni_clients,
        COUNT(*) FILTER (WHERE last_transaction_at < now() - make_interval(days => (SELECT dormancy_window_days FROM tenants WHERE id = ${tenantId}::uuid)) AND deleted_at IS NULL AND status <> 'closed')::int AS dormant_clients,
        (SELECT dormancy_window_days FROM tenants WHERE id = ${tenantId}::uuid)::int AS dormancy_window_days
      FROM investors WHERE tenant_id = ${tenantId}::uuid
    `)
  ).rows[0] as any;

  const top = (
    await tx.execute(sql`
      SELECT name, COALESCE(aum,0)::numeric AS aum FROM investors
      WHERE tenant_id = ${tenantId}::uuid AND status <> 'closed' AND merged_into_id IS NULL AND deleted_at IS NULL
      ORDER BY aum DESC NULLS LAST LIMIT 10
    `)
  ).rows as any[];

  const leads = (
    await tx.execute(sql`SELECT COUNT(*)::int AS open_leads FROM leads WHERE tenant_id = ${tenantId}::uuid AND stage NOT IN ('converted','lost','not_interested','not_qualified')`)
  ).rows[0] as any;

  const tasks = (
    await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('open','in_progress','blocked'))::int AS open_tasks,
        COUNT(*) FILTER (WHERE status IN ('open','in_progress','blocked') AND due_at < now())::int AS overdue_tasks
      FROM tasks WHERE tenant_id = ${tenantId}::uuid
    `)
  ).rows[0] as any;

  const sips = (
    await tx.execute(sql`SELECT COUNT(*)::int AS active_sips FROM sips WHERE tenant_id = ${tenantId}::uuid AND status = 'active'`)
  ).rows[0] as any;

  const ins = (
    await tx.execute(sql`
      SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active_policies,
             COALESCE(SUM(annual_premium) FILTER (WHERE status = 'active'),0)::numeric AS active_annual_premium
      FROM insurance_policies WHERE tenant_id = ${tenantId}::uuid
    `)
  ).rows[0] as any;

  const meetings = (
    await tx.execute(sql`SELECT COUNT(*)::int AS upcoming_meetings FROM review_meetings WHERE tenant_id = ${tenantId}::uuid AND status IN ('scheduled','confirmed') AND meeting_date >= now()`)
  ).rows[0] as any;

  const byRm = (
    await tx.execute(sql`
      SELECT u.name, COALESCE(SUM(i.aum),0)::numeric AS aum, COUNT(*)::int AS clients
      FROM investors i JOIN users u ON u.id = i.rm_id
      WHERE i.tenant_id = ${tenantId}::uuid AND i.status <> 'closed' AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
      GROUP BY u.name ORDER BY aum DESC LIMIT 8
    `)
  ).rows as any[];

  const kyc = (
    await tx.execute(sql`
      SELECT COALESCE(kyc_status,'unknown') AS status, COUNT(*)::int AS n
      FROM investors WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND status <> 'closed'
      GROUP BY COALESCE(kyc_status,'unknown') ORDER BY n DESC
    `)
  ).rows as any[];

  const extra = (
    await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS new_clients_this_month,
        COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS new_clients_30d
      FROM investors WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
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
}

/** The system prompt shared by the ask + chat endpoints: CRM-only, read-only,
 *  answers strictly from the live snapshot, formats with Markdown tables + links. */
export function assistantSystemPrompt(snapshot: FirmSnapshot): string {
  return `You are "Equitywala Assistant", the analytics assistant embedded inside an Indian Mutual Fund Distributor's CRM (Equitywala).

SCOPE — you exist ONLY to help this MFD firm understand and act on their own CRM data. Politely decline anything outside that (general trivia, coding, world knowledge). You CANNOT and MUST NOT change any data, settings, or code — you are strictly read-only. If asked to modify/create/delete something, explain that you can't act, and point them to the right screen.

TRUTH — answer using ONLY the JSON metrics below. They are LIVE, real figures for THIS firm right now. NEVER invent, estimate, or extrapolate a number that isn't present. If a metric isn't in the snapshot, say you don't track that yet and list 2-3 things you CAN answer.

FORMAT —
- Use GitHub-flavored **Markdown**. When presenting more than ~3 related numbers (top clients, AUM by RM, KYC breakdown, etc.), use a Markdown **table**. Keep prose tight.
- Money: Indian format with ₹ (e.g. ₹1,23,45,000). "AUM" = assets under management; "SIP book" = total monthly SIP amount.
- REDIRECTION: link relevant destinations as Markdown links to these CRM routes so the user can act:
  Clients \`/dashboard/investors\` · Leads \`/dashboard/leads\` · SIPs \`/dashboard/sips\` · Tasks \`/dashboard/tasks\` · Insurance \`/dashboard/insurance\` · Meetings \`/dashboard/review-meetings\` · KYC tracker \`/dashboard/reports/kyc-tracker\` · Nominee tracker \`/dashboard/reports/nomination-tracker\` · Churn risk \`/dashboard/reports/churn-risk\` · Business MIS \`/dashboard/reports/business-mis\` · Goals \`/dashboard/goals\` · Proposals \`/dashboard/proposals\`.
  Only link routes from this list.

LIVE METRICS (JSON):
${JSON.stringify(snapshot, null, 2)}`;
}
