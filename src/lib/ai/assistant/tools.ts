/**
 * Equitywala Assistant — read-only "skills" (tools the model can call to fetch real,
 * RLS-scoped data). Every executor runs inside `withTenant`, so results are
 * always scoped to the caller's firm (and branch/role via RLS). Nothing here
 * writes, and the model never emits SQL — it only picks a tool + typed args,
 * which we compile into safe, parameterised queries.
 */

import { sql, type SQL } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { firmSnapshot } from "@/lib/ai/firm-snapshot";

export type AssistantCtx = {
  tenantId: string;
  userId: string;
  branchId: string | null;
  roles: string[];
};

export type AssistantTool = {
  name: string;
  description: string;
  input_schema: any;
  /** Friendly present-tense label shown while it runs (for the status pill). */
  label: string;
  run: (ctx: AssistantCtx, args: any) => Promise<any>;
};

function txOpts(ctx: AssistantCtx) {
  return { userId: ctx.userId, branchId: ctx.branchId ?? undefined, roles: ctx.roles };
}

const num = (n: any) => Math.round(Number(n) || 0);
const clampLimit = (n: any, def = 10, max = 50) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(Math.max(1, Math.trunc(v)), max) : def;
};

/** "<col> is null OR older than the firm's dormancy window" — one configurable
 *  definition of dormant (tenants.dormancy_window_days, default 180) shared by
 *  every tool, so the copilot never contradicts itself. */
function dormantCond(col: SQL, ctx: AssistantCtx): SQL {
  return sql`(${col} IS NULL OR ${col} < now() - make_interval(days => (SELECT dormancy_window_days FROM tenants WHERE id = ${ctx.tenantId}::uuid)))`;
}

export const ASSISTANT_TOOLS: AssistantTool[] = [
  {
    name: "get_firm_overview",
    label: "Reading your firm snapshot",
    description:
      "Get the firm-wide snapshot: active clients, total AUM, monthly SIP book, active SIPs, open leads, open/overdue tasks, KYC-pending, clients without nominee, dormant clients, HNI count, new clients this month, top clients by AUM, AUM by RM, KYC breakdown. Use for broad 'how is my firm doing' questions.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    run: (ctx) => withTenant(ctx.tenantId, (tx) => firmSnapshot(tx, ctx.tenantId), txOpts(ctx)),
  },

  {
    name: "search_clients",
    label: "Searching your clients",
    description:
      "Find/list clients (investors) with filters. Use for 'top N clients by AUM', 'clients in Mumbai', 'HNI clients', 'KYC-pending clients', 'dormant clients', 'clients with SIP over X', or a name/PAN lookup. Returns matching client rows.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional name or PAN to search for." },
        segment: { type: "string", enum: ["HNI", "Affluent", "Retail", "NRI", "Corporate"], description: "Segment tag filter." },
        kyc_status: { type: "string", enum: ["verified", "registered", "pending", "hold", "rejected", "expired", "re_kyc_required"], description: "KYC status filter." },
        kyc_pending: { type: "boolean", description: "True to only include clients whose KYC is NOT verified/registered." },
        city: { type: "string", description: "City filter (mailing address)." },
        min_aum: { type: "number", description: "Minimum AUM in ₹." },
        min_sip: { type: "number", description: "Minimum monthly SIP amount in ₹." },
        no_nominee: { type: "boolean", description: "True to only include clients with no nominee on file." },
        dormant: { type: "boolean", description: "True to only include dormant clients (no transaction within the firm's dormancy window)." },
        sort_by: { type: "string", enum: ["aum", "sip", "name", "recent_txn"], description: "Sort key. Default aum (desc)." },
        limit: { type: "number", description: "How many to return (default 10, max 50)." },
      },
      additionalProperties: false,
    },
    run: (ctx, a) =>
      withTenant(
        ctx.tenantId,
        async (tx) => {
          const conds: SQL[] = [
            sql`tenant_id = ${ctx.tenantId}::uuid`,
            sql`deleted_at IS NULL`,
            sql`status <> 'closed'`,
            sql`merged_into_id IS NULL`,
          ];
          if (a?.query) conds.push(sql`(name ILIKE ${"%" + String(a.query) + "%"} OR pan ILIKE ${"%" + String(a.query) + "%"})`);
          if (a?.segment) conds.push(sql`segment_tag = ${a.segment}`);
          if (a?.kyc_status) conds.push(sql`kyc_status = ${a.kyc_status}`);
          if (a?.kyc_pending) conds.push(sql`kyc_status NOT IN ('verified','registered')`);
          if (a?.city) conds.push(sql`lower(address->>'city') = lower(${String(a.city)})`);
          if (a?.min_aum != null) conds.push(sql`COALESCE(aum,0)::numeric >= ${Number(a.min_aum)}`);
          if (a?.min_sip != null) conds.push(sql`COALESCE(active_sip_amount,0)::numeric >= ${Number(a.min_sip)}`);
          if (a?.no_nominee) conds.push(sql`(nominee_name IS NULL OR nominee_name = '')`);
          if (a?.dormant) conds.push(dormantCond(sql`last_transaction_at`, ctx));

          const order =
            a?.sort_by === "sip" ? sql`COALESCE(active_sip_amount,0)::numeric DESC`
            : a?.sort_by === "name" ? sql`name ASC`
            : a?.sort_by === "recent_txn" ? sql`last_transaction_at DESC NULLS LAST`
            : sql`COALESCE(aum,0)::numeric DESC`;

          const limit = clampLimit(a?.limit, 10, 50);
          const r = await tx.execute(sql`
            SELECT name, COALESCE(aum,0)::numeric AS aum, COALESCE(active_sip_amount,0)::numeric AS sip,
                   kyc_status, segment_tag, service_tier, (address->>'city') AS city,
                   last_transaction_at::date AS last_txn
            FROM investors WHERE ${sql.join(conds, sql` AND `)}
            ORDER BY ${order} LIMIT ${limit}
          `);
          return {
            count: r.rows.length,
            clients: (r.rows as any[]).map((x) => ({
              name: x.name, aum_inr: num(x.aum), monthly_sip_inr: num(x.sip),
              kyc_status: x.kyc_status, segment: x.segment_tag, tier: x.service_tier,
              city: x.city ?? null, last_transaction: x.last_txn ?? null,
            })),
          };
        },
        txOpts(ctx)
      ),
  },

  {
    name: "group_clients",
    label: "Grouping your clients",
    description:
      "Aggregate clients by a dimension — returns count, total AUM and total monthly SIP per group. dimension is one of: city, segment, service_tier, kyc_status, rm. Optional filters: dormant, kyc_pending, no_nominee. Use for 'clients per city', 'AUM by segment', 'which RM has the most clients / AUM', 'KYC breakdown', 'dormant clients by RM'.",
    input_schema: {
      type: "object",
      properties: {
        dimension: { type: "string", enum: ["city", "segment", "service_tier", "kyc_status", "rm"] },
        dormant: { type: "boolean", description: "Only dormant clients (no transaction within the firm's dormancy window)." },
        kyc_pending: { type: "boolean", description: "Only clients not KYC-verified/registered." },
        no_nominee: { type: "boolean", description: "Only clients with no nominee." },
        limit: { type: "number", description: "Max groups (default 15, max 50)." },
      },
      required: ["dimension"],
      additionalProperties: false,
    },
    run: (ctx, a) =>
      withTenant(
        ctx.tenantId,
        async (tx) => {
          const dim = ["city", "segment", "service_tier", "kyc_status", "rm"].includes(a?.dimension) ? a.dimension : "segment";
          const groupExpr =
            dim === "city" ? sql`COALESCE(NULLIF(i.address->>'city',''),'—')`
            : dim === "segment" ? sql`COALESCE(i.segment_tag,'—')`
            : dim === "service_tier" ? sql`COALESCE(i.service_tier,'—')`
            : dim === "kyc_status" ? sql`COALESCE(i.kyc_status,'unknown')`
            : sql`COALESCE(u.name,'— unassigned —')`;
          const join = dim === "rm" ? sql`LEFT JOIN users u ON u.id = i.rm_id` : sql``;
          const conds: SQL[] = [
            sql`i.tenant_id = ${ctx.tenantId}::uuid`,
            sql`i.deleted_at IS NULL`,
            sql`i.status <> 'closed'`,
            sql`i.merged_into_id IS NULL`,
          ];
          if (a?.dormant) conds.push(dormantCond(sql`i.last_transaction_at`, ctx));
          if (a?.kyc_pending) conds.push(sql`i.kyc_status NOT IN ('verified','registered')`);
          if (a?.no_nominee) conds.push(sql`(i.nominee_name IS NULL OR i.nominee_name = '')`);
          const limit = clampLimit(a?.limit, 15, 50);
          const r = await tx.execute(sql`
            SELECT ${groupExpr} AS grp, COUNT(*)::int AS clients,
                   COALESCE(SUM(i.aum::numeric),0)::numeric AS aum,
                   COALESCE(SUM(i.active_sip_amount::numeric),0)::numeric AS sip
            FROM investors i ${join}
            WHERE ${sql.join(conds, sql` AND `)}
            GROUP BY ${groupExpr} ORDER BY clients DESC LIMIT ${limit}
          `);
          return {
            dimension: dim,
            groups: (r.rows as any[]).map((x) => ({ group: x.grp, clients: num(x.clients), total_aum_inr: num(x.aum), total_monthly_sip_inr: num(x.sip) })),
          };
        },
        txOpts(ctx)
      ),
  },

  {
    name: "list_leads",
    label: "Looking up your leads",
    description: "List sales leads, optionally filtered by pipeline stage. Use for 'my open leads', 'leads in [stage]'. Returns lead rows.",
    input_schema: {
      type: "object",
      properties: {
        stage: { type: "string", description: "Optional pipeline stage to filter by." },
        open_only: { type: "boolean", description: "Default true — exclude converted/lost/not-interested/not-qualified." },
        limit: { type: "number", description: "How many (default 15, max 50)." },
      },
      additionalProperties: false,
    },
    run: (ctx, a) =>
      withTenant(
        ctx.tenantId,
        async (tx) => {
          const conds: SQL[] = [sql`tenant_id = ${ctx.tenantId}::uuid`];
          if (a?.stage) conds.push(sql`stage = ${String(a.stage)}`);
          if (a?.open_only !== false) conds.push(sql`stage NOT IN ('converted','lost','not_interested','not_qualified')`);
          const limit = clampLimit(a?.limit, 15, 50);
          const r = await tx.execute(sql`
            SELECT name, stage, source, COALESCE(lead_score,0)::int AS score, created_at::date AS created
            FROM leads WHERE ${sql.join(conds, sql` AND `)}
            ORDER BY COALESCE(lead_score,0) DESC, created_at DESC LIMIT ${limit}
          `);
          return { count: r.rows.length, leads: r.rows };
        },
        txOpts(ctx)
      ),
  },

  {
    name: "list_tasks",
    label: "Checking your tasks",
    description: "List tasks. Use for 'my open tasks', 'overdue tasks', 'tasks due this week'. Returns task rows with due dates and assignee.",
    input_schema: {
      type: "object",
      properties: {
        overdue_only: { type: "boolean", description: "Only overdue open tasks." },
        due_within_days: { type: "number", description: "Only tasks due within N days." },
        limit: { type: "number", description: "How many (default 15, max 50)." },
      },
      additionalProperties: false,
    },
    run: (ctx, a) =>
      withTenant(
        ctx.tenantId,
        async (tx) => {
          const conds: SQL[] = [sql`t.tenant_id = ${ctx.tenantId}::uuid`, sql`t.status IN ('open','in_progress','blocked')`];
          if (a?.overdue_only) conds.push(sql`t.due_at < now()`);
          if (a?.due_within_days != null) conds.push(sql`t.due_at <= now() + make_interval(days => ${Number(a.due_within_days)})`);
          const limit = clampLimit(a?.limit, 15, 50);
          const r = await tx.execute(sql`
            SELECT t.title, t.status, t.priority, t.due_at::date AS due, u.name AS assignee
            FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
            WHERE ${sql.join(conds, sql` AND `)}
            ORDER BY t.due_at ASC NULLS LAST LIMIT ${limit}
          `);
          return { count: r.rows.length, tasks: r.rows };
        },
        txOpts(ctx)
      ),
  },

  {
    name: "get_sip_book",
    label: "Tallying your SIP book",
    description:
      "FIRM-WIDE aggregate SIP book ONLY: total active SIP count + total monthly ₹, plus stopped/paused counts and SIPs added this month. Use for 'what's my SIP book', 'how many SIPs stopped'. Do NOT use to list or filter individual clients by their SIP amount — for 'HNI clients with SIP over ₹X' or 'clients with a SIP', use search_clients(min_sip).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    run: (ctx) =>
      withTenant(
        ctx.tenantId,
        async (tx) => {
          const r = await tx.execute(sql`
            SELECT
              COUNT(*) FILTER (WHERE status = 'active')::int AS active_sips,
              COALESCE(SUM(amount::numeric) FILTER (WHERE status = 'active'),0)::numeric AS monthly_sip,
              COUNT(*) FILTER (WHERE status IN ('stopped','cancelled'))::int AS stopped_sips,
              COUNT(*) FILTER (WHERE status = 'paused')::int AS paused_sips,
              COUNT(*) FILTER (WHERE status = 'active' AND created_at >= date_trunc('month', now()))::int AS added_this_month
            FROM sips WHERE tenant_id = ${ctx.tenantId}::uuid
          `);
          const s = r.rows[0] as any;
          return {
            active_sips: num(s.active_sips), monthly_sip_book_inr: num(s.monthly_sip),
            stopped_sips: num(s.stopped_sips), paused_sips: num(s.paused_sips),
            sips_added_this_month: num(s.added_this_month),
          };
        },
        txOpts(ctx)
      ),
  },

  {
    name: "get_insurance_book",
    label: "Reviewing insurance policies",
    description: "Insurance summary: active policy count and total annual premium, plus policies due for renewal in 30 days. Use for insurance questions.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    run: (ctx) =>
      withTenant(
        ctx.tenantId,
        async (tx) => {
          const r = await tx.execute(sql`
            SELECT
              COUNT(*) FILTER (WHERE status = 'active')::int AS active_policies,
              COALESCE(SUM(annual_premium::numeric) FILTER (WHERE status = 'active'),0)::numeric AS annual_premium,
              COUNT(*) FILTER (WHERE status = 'active' AND next_premium_due_date IS NOT NULL
                AND next_premium_due_date BETWEEN current_date AND current_date + interval '30 days')::int AS renewals_30d
            FROM insurance_policies WHERE tenant_id = ${ctx.tenantId}::uuid
          `);
          const s = r.rows[0] as any;
          return {
            active_policies: num(s.active_policies),
            annual_premium_inr: num(s.annual_premium),
            renewals_due_30d: num(s.renewals_30d),
          };
        },
        txOpts(ctx)
      ),
  },

  {
    name: "get_business_summary",
    label: "Adding up your business",
    description:
      "Booked business for a period from the business-entries ledger: SIP added, lumpsum, redemption, and net business. period is one of mtd (month to date), lm (last month), qtd (quarter to date), fytd (financial year to date). Use for 'net business this month', 'how much did I book'.",
    input_schema: {
      type: "object",
      properties: { period: { type: "string", enum: ["mtd", "lm", "qtd", "fytd"], description: "Default mtd." } },
      additionalProperties: false,
    },
    run: (ctx, a) =>
      withTenant(
        ctx.tenantId,
        async (tx) => {
          const period = ["mtd", "lm", "qtd", "fytd"].includes(a?.period) ? a.period : "mtd";
          // India FY starts in April. Compute the window start/end.
          const range =
            period === "lm"
              ? sql`e.business_date >= date_trunc('month', now()) - interval '1 month' AND e.business_date < date_trunc('month', now())`
              : period === "qtd"
              ? sql`e.business_date >= date_trunc('quarter', now())`
              : period === "fytd"
              ? sql`e.business_date >= (date_trunc('year', now() - interval '3 months') + interval '3 months')`
              : sql`e.business_date >= date_trunc('month', now())`;
          const r = await tx.execute(sql`
            SELECT
              COALESCE(SUM(l.amount::numeric) FILTER (WHERE l.txn_type IN ('sip','sip_topup')),0)::numeric AS sip_added,
              COALESCE(SUM(l.amount::numeric) FILTER (WHERE l.txn_type IN ('lumpsum','additional_purchase')),0)::numeric AS lumpsum,
              COALESCE(SUM(l.amount::numeric) FILTER (WHERE l.txn_type IN ('redemption','swp')),0)::numeric AS redemption
            FROM business_entry_lines l JOIN business_entries e ON e.id = l.entry_id
            WHERE e.tenant_id = ${ctx.tenantId}::uuid AND e.status <> 'cancelled' AND ${range}
          `);
          const s = r.rows[0] as any;
          const sipAdded = num(s.sip_added), lumpsum = num(s.lumpsum), redemption = num(s.redemption);
          return { period, sip_added_inr: sipAdded, lumpsum_inr: lumpsum, redemption_inr: redemption, net_business_inr: sipAdded + lumpsum - redemption };
        },
        txOpts(ctx)
      ),
  },

  {
    name: "get_business_trend",
    label: "Charting your business trend",
    description:
      "Month-by-month business over the last N months (default 6, max 24): SIP added, lumpsum, redemption and net business per month, one row per month (zero-filled for quiet months). Use for 'business trend', 'net business over the last 6 months', 'monthly business', 'business month by month'.",
    input_schema: {
      type: "object",
      properties: { months: { type: "number", description: "How many months back (default 6, max 24)." } },
      additionalProperties: false,
    },
    run: (ctx, a) =>
      withTenant(
        ctx.tenantId,
        async (tx) => {
          const n = clampLimit(a?.months, 6, 24);
          const r = await tx.execute(sql`
            WITH months AS (
              SELECT generate_series(
                date_trunc('month', now()) - make_interval(months => ${n - 1}),
                date_trunc('month', now()),
                interval '1 month'
              ) AS m
            )
            SELECT to_char(months.m, 'Mon YYYY') AS label,
              COALESCE(SUM(l.amount::numeric) FILTER (WHERE l.txn_type IN ('sip','sip_topup')), 0)::numeric AS sip,
              COALESCE(SUM(l.amount::numeric) FILTER (WHERE l.txn_type IN ('lumpsum','additional_purchase')), 0)::numeric AS lumpsum,
              COALESCE(SUM(l.amount::numeric) FILTER (WHERE l.txn_type IN ('redemption','swp')), 0)::numeric AS redemption
            FROM months
            LEFT JOIN business_entries e
              ON date_trunc('month', e.business_date) = months.m
              AND e.tenant_id = ${ctx.tenantId}::uuid AND e.status <> 'cancelled'
            LEFT JOIN business_entry_lines l ON l.entry_id = e.id
            GROUP BY months.m ORDER BY months.m
          `);
          return {
            months: (r.rows as any[]).map((x) => {
              const sip = num(x.sip), lump = num(x.lumpsum), red = num(x.redemption);
              return { label: x.label, sip_added_inr: sip, lumpsum_inr: lump, redemption_inr: red, net_business_inr: sip + lump - red };
            }),
          };
        },
        txOpts(ctx)
      ),
  },

  {
    name: "get_aum_trend",
    label: "Charting your AUM trend",
    description:
      "Month-by-month AUM (and monthly SIP book) over the last N months (default 6, max 24), from recorded daily firm snapshots — one point per month. Use for 'AUM trend', 'AUM over time', 'how has my AUM grown', 'SIP book trend'. History accrues from when snapshots began, so it may be short at first.",
    input_schema: {
      type: "object",
      properties: { months: { type: "number", description: "How many months back (default 6, max 24)." } },
      additionalProperties: false,
    },
    run: (ctx, a) =>
      withTenant(
        ctx.tenantId,
        async (tx) => {
          const n = clampLimit(a?.months, 6, 24);
          const r = await tx.execute(sql`
            SELECT to_char(m, 'Mon YYYY') AS label, total_aum, monthly_sip, active_clients
            FROM (
              SELECT DISTINCT ON (date_trunc('month', snapshot_date))
                date_trunc('month', snapshot_date) AS m,
                total_aum, monthly_sip, active_clients
              FROM firm_snapshots
              WHERE tenant_id = ${ctx.tenantId}::uuid
                AND snapshot_date >= date_trunc('month', now()) - make_interval(months => ${n - 1})
              ORDER BY date_trunc('month', snapshot_date), snapshot_date DESC
            ) sub
            ORDER BY m
          `);
          const cnt = await tx.execute(sql`SELECT COUNT(*)::int AS c FROM firm_snapshots WHERE tenant_id = ${ctx.tenantId}::uuid`);
          return {
            days_recorded: num((cnt.rows[0] as any)?.c),
            months: (r.rows as any[]).map((x) => ({
              label: x.label, aum_inr: num(x.total_aum), monthly_sip_inr: num(x.monthly_sip), clients: num(x.active_clients),
            })),
          };
        },
        txOpts(ctx)
      ),
  },

  {
    name: "get_upcoming_renewals",
    label: "Finding upcoming renewals",
    description:
      "Active insurance policies with a premium due within the next N days (default 30, max 365). Use for 'renewals due in 30 days', 'upcoming premium renewals', 'policies expiring soon'. Returns policy rows with client, insurer, plan, premium and due date.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Window in days (default 30, max 365)." },
        limit: { type: "number", description: "How many (default 20, max 50)." },
      },
      additionalProperties: false,
    },
    run: (ctx, a) =>
      withTenant(
        ctx.tenantId,
        async (tx) => {
          const days = clampLimit(a?.days, 30, 365);
          const limit = clampLimit(a?.limit, 20, 50);
          const r = await tx.execute(sql`
            SELECT i.name AS client, p.insurer, p.plan_name, p.policy_type,
                   COALESCE(p.annual_premium, 0)::numeric AS premium, p.next_premium_due_date AS due
            FROM insurance_policies p JOIN investors i ON i.id = p.investor_id
            WHERE p.tenant_id = ${ctx.tenantId}::uuid AND p.status = 'active'
              AND p.next_premium_due_date IS NOT NULL
              AND p.next_premium_due_date BETWEEN current_date AND current_date + make_interval(days => ${days})
            ORDER BY p.next_premium_due_date ASC LIMIT ${limit}
          `);
          return {
            window_days: days, count: r.rows.length,
            policies: (r.rows as any[]).map((x) => ({
              client: x.client, insurer: x.insurer, plan: x.plan_name, type: x.policy_type,
              annual_premium_inr: num(x.premium), due_date: x.due,
            })),
          };
        },
        txOpts(ctx)
      ),
  },

  {
    name: "get_data_quality_summary",
    label: "Auditing your data quality",
    description:
      "Counts of active client records with data gaps: missing KYC (not verified/registered), missing nominee, missing RM, missing city, and dormant (no transaction within the firm's dormancy window). Use for 'data quality', \"what's missing\", 'incomplete client data', 'data cleanup'.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    run: (ctx) =>
      withTenant(
        ctx.tenantId,
        async (tx) => {
          const r = await tx.execute(sql`
            SELECT
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE kyc_status IS NULL OR kyc_status NOT IN ('verified','registered'))::int AS missing_kyc,
              COUNT(*) FILTER (WHERE nominee_name IS NULL OR nominee_name = '')::int AS missing_nominee,
              COUNT(*) FILTER (WHERE rm_id IS NULL)::int AS missing_rm,
              COUNT(*) FILTER (WHERE NULLIF(address->>'city','') IS NULL)::int AS missing_city,
              COUNT(*) FILTER (WHERE ${dormantCond(sql`last_transaction_at`, ctx)})::int AS dormant
            FROM investors
            WHERE tenant_id = ${ctx.tenantId}::uuid AND deleted_at IS NULL AND status <> 'closed' AND merged_into_id IS NULL
          `);
          const s = r.rows[0] as any;
          return {
            total_clients: num(s.total), missing_kyc: num(s.missing_kyc), missing_nominee: num(s.missing_nominee),
            missing_rm: num(s.missing_rm), missing_city: num(s.missing_city), dormant: num(s.dormant),
          };
        },
        txOpts(ctx)
      ),
  },

  {
    name: "get_birthdays",
    label: "Checking client birthdays",
    description:
      "Clients whose birthday falls today or within the next N days (default 0 = today only, max 60). Use for 'birthdays today', 'whose birthday is this week', 'upcoming birthdays'. Returns client + day.",
    input_schema: {
      type: "object",
      properties: {
        within_days: { type: "number", description: "0 = today only (default), up to 60." },
        limit: { type: "number", description: "How many (default 25, max 50)." },
      },
      additionalProperties: false,
    },
    run: (ctx, a) =>
      withTenant(
        ctx.tenantId,
        async (tx) => {
          const within = Math.min(Math.max(0, Math.trunc(Number(a?.within_days) || 0)), 60);
          const limit = clampLimit(a?.limit, 25, 50);
          const r = await tx.execute(sql`
            SELECT name, to_char(dob, 'DD Mon') AS day_label, dob
            FROM investors
            WHERE tenant_id = ${ctx.tenantId}::uuid AND deleted_at IS NULL AND status <> 'closed'
              AND merged_into_id IS NULL AND dob IS NOT NULL
              AND (
                (
                  to_char(current_date + make_interval(days => ${within}), 'MM-DD') >= to_char(current_date, 'MM-DD')
                  AND to_char(dob, 'MM-DD') BETWEEN to_char(current_date, 'MM-DD')
                      AND to_char(current_date + make_interval(days => ${within}), 'MM-DD')
                )
                OR (
                  to_char(current_date + make_interval(days => ${within}), 'MM-DD') < to_char(current_date, 'MM-DD')
                  AND (
                    to_char(dob, 'MM-DD') >= to_char(current_date, 'MM-DD')
                    OR to_char(dob, 'MM-DD') <= to_char(current_date + make_interval(days => ${within}), 'MM-DD')
                  )
                )
              )
            ORDER BY to_char(dob, 'MM-DD') ASC LIMIT ${limit}
          `);
          return {
            within_days: within, count: r.rows.length,
            clients: (r.rows as any[]).map((x) => ({ name: x.name, birthday: x.day_label })),
          };
        },
        txOpts(ctx)
      ),
  },

  {
    name: "get_customer_360",
    label: "Building the client 360",
    description:
      "Full snapshot for ONE client, looked up by name: AUM, monthly SIP, KYC, segment, tier, city, RM, nominee, last transaction, active insurance (count + annual premium), open tasks, and the next review meeting. Use for 'tell me about <name>', \"<name>'s portfolio\", '<name> 360', 'profile of <name>'.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string", description: "Client name (or part of it) to look up." } },
      required: ["name"],
      additionalProperties: false,
    },
    run: (ctx, a) =>
      withTenant(
        ctx.tenantId,
        async (tx) => {
          const q = String(a?.name ?? "").trim();
          if (!q) return { error: "no name" };
          const ir = await tx.execute(sql`
            SELECT id, name, COALESCE(aum,0)::numeric AS aum, COALESCE(active_sip_amount,0)::numeric AS sip,
                   kyc_status, segment_tag, service_tier, (address->>'city') AS city, nominee_name,
                   last_transaction_at::date AS last_txn, rm_id
            FROM investors
            WHERE tenant_id = ${ctx.tenantId}::uuid AND deleted_at IS NULL AND merged_into_id IS NULL AND status <> 'closed'
              AND name ILIKE ${"%" + q + "%"}
            ORDER BY (lower(name) = lower(${q})) DESC, COALESCE(aum,0)::numeric DESC
            LIMIT 1
          `);
          const inv = ir.rows[0] as any;
          if (!inv) return { not_found: true, query: q };
          const [rm, pol, tsk, mtg] = await Promise.all([
            inv.rm_id ? tx.execute(sql`SELECT name FROM users WHERE id = ${inv.rm_id}::uuid LIMIT 1`) : Promise.resolve({ rows: [] } as any),
            tx.execute(sql`SELECT COUNT(*) FILTER (WHERE status='active')::int AS c, COALESCE(SUM(annual_premium::numeric) FILTER (WHERE status='active'),0)::numeric AS prem FROM insurance_policies WHERE tenant_id=${ctx.tenantId}::uuid AND investor_id=${inv.id}::uuid`),
            tx.execute(sql`SELECT COUNT(*)::int AS c FROM tasks WHERE tenant_id=${ctx.tenantId}::uuid AND related_investor_id=${inv.id}::uuid AND status IN ('open','in_progress','blocked')`),
            tx.execute(sql`SELECT meeting_date AS at FROM review_meetings WHERE tenant_id=${ctx.tenantId}::uuid AND investor_id=${inv.id}::uuid AND meeting_date>=now() AND status NOT IN ('cancelled','completed','no_show') ORDER BY meeting_date ASC LIMIT 1`),
          ]);
          const p = pol.rows[0] as any;
          return {
            name: inv.name, aum_inr: num(inv.aum), monthly_sip_inr: num(inv.sip), kyc_status: inv.kyc_status,
            segment: inv.segment_tag, tier: inv.service_tier, city: inv.city ?? null, nominee: inv.nominee_name ?? null,
            last_transaction: inv.last_txn ?? null, rm: (rm.rows[0] as any)?.name ?? null,
            active_policies: num(p?.c), insurance_annual_premium_inr: num(p?.prem),
            open_tasks: num((tsk.rows[0] as any)?.c), next_meeting: (mtg.rows[0] as any)?.at ?? null,
          };
        },
        txOpts(ctx)
      ),
  },

  {
    name: "get_rm_performance",
    label: "Comparing RM performance",
    description:
      "Per-RM scorecard: clients, AUM, monthly SIP, dormant clients and KYC-pending clients for each relationship manager. Use for 'RM performance', 'compare my RMs', 'which RM has the most dormant clients', 'RM scorecard'.",
    input_schema: { type: "object", properties: { limit: { type: "number", description: "Max RMs (default 15, max 50)." } }, additionalProperties: false },
    run: (ctx, a) =>
      withTenant(
        ctx.tenantId,
        async (tx) => {
          const limit = clampLimit(a?.limit, 15, 50);
          const r = await tx.execute(sql`
            SELECT COALESCE(u.name,'— unassigned —') AS rm, COUNT(*)::int AS clients,
              COALESCE(SUM(i.aum::numeric),0)::numeric AS aum,
              COALESCE(SUM(i.active_sip_amount::numeric),0)::numeric AS sip,
              COUNT(*) FILTER (WHERE ${dormantCond(sql`i.last_transaction_at`, ctx)})::int AS dormant,
              COUNT(*) FILTER (WHERE i.kyc_status IS NULL OR i.kyc_status NOT IN ('verified','registered'))::int AS kyc_pending
            FROM investors i LEFT JOIN users u ON u.id = i.rm_id
            WHERE i.tenant_id = ${ctx.tenantId}::uuid AND i.deleted_at IS NULL AND i.status <> 'closed' AND i.merged_into_id IS NULL
            GROUP BY COALESCE(u.name,'— unassigned —') ORDER BY aum DESC LIMIT ${limit}
          `);
          return {
            rms: (r.rows as any[]).map((x) => ({
              rm: x.rm, clients: num(x.clients), aum_inr: num(x.aum), monthly_sip_inr: num(x.sip),
              dormant: num(x.dormant), kyc_pending: num(x.kyc_pending),
            })),
          };
        },
        txOpts(ctx)
      ),
  },

  {
    name: "get_review_meetings",
    label: "Reviewing scheduled meetings",
    description:
      "Review meetings by window: 'upcoming' (next 30 days, default), 'today', 'this_week', or 'overdue' (in the past and still open). Use for 'meetings this week', 'upcoming reviews', 'overdue review meetings'. Returns meetings with client, date and status.",
    input_schema: {
      type: "object",
      properties: {
        window: { type: "string", enum: ["today", "this_week", "upcoming", "overdue"], description: "Default upcoming." },
        limit: { type: "number", description: "How many (default 20, max 50)." },
      },
      additionalProperties: false,
    },
    run: (ctx, a) =>
      withTenant(
        ctx.tenantId,
        async (tx) => {
          const w = ["today", "this_week", "upcoming", "overdue"].includes(a?.window) ? a.window : "upcoming";
          const range =
            w === "today" ? sql`m.meeting_date::date = current_date AND m.status NOT IN ('cancelled')`
            : w === "this_week" ? sql`m.meeting_date >= date_trunc('week', now()) AND m.meeting_date < date_trunc('week', now()) + interval '7 days' AND m.status NOT IN ('cancelled')`
            : w === "overdue" ? sql`m.meeting_date < now() AND m.status NOT IN ('completed','cancelled','no_show')`
            : sql`m.meeting_date >= now() AND m.meeting_date <= now() + interval '30 days' AND m.status NOT IN ('cancelled','completed','no_show')`;
          const limit = clampLimit(a?.limit, 20, 50);
          const r = await tx.execute(sql`
            SELECT COALESCE(i.name, '—') AS client, m.meeting_date AS at, m.status, m.category
            FROM review_meetings m LEFT JOIN investors i ON i.id = m.investor_id
            WHERE m.tenant_id = ${ctx.tenantId}::uuid AND ${range}
            ORDER BY m.meeting_date ASC LIMIT ${limit}
          `);
          return {
            window: w, count: r.rows.length,
            meetings: (r.rows as any[]).map((x) => ({ client: x.client, at: x.at, status: x.status, category: x.category })),
          };
        },
        txOpts(ctx)
      ),
  },
];

export const ANTHROPIC_TOOLS = ASSISTANT_TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema,
}));

const TOOLS_BY_NAME = new Map(ASSISTANT_TOOLS.map((t) => [t.name, t]));

export function toolLabel(name: string): string {
  return TOOLS_BY_NAME.get(name)?.label ?? "Fetching your data";
}

/** Execute a tool by name with the given (validated-by-schema) args. */
export async function runAssistantTool(ctx: AssistantCtx, name: string, args: any): Promise<any> {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) return { error: `unknown tool: ${name}` };
  try {
    return await tool.run(ctx, args ?? {});
  } catch (e: any) {
    return { error: "That lookup failed. Try rephrasing.", detail: String(e?.message ?? e).slice(0, 200) };
  }
}
