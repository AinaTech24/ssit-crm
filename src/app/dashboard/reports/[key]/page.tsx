import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { ChevronLeft, BarChart3 } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { formatINR, formatDate } from "@/lib/utils";
import { ReportExportButtons } from "@/components/reports/ReportExportButtons";

/**
 * Generic report viewer. Routes /dashboard/reports/<key> through a registry
 * of SQL queries. Adding a new report = adding one entry here.
 */

const REPORTS: Record<
  string,
  {
    title: string;
    desc: string;
    columns: { key: string; label: string; format?: "inr" | "date" | "number" }[];
    runSql: (sqlTag: typeof sql) => any;
  }
> = {
  daily_sip_added: {
    title: "Daily SIP Added",
    desc: "New SIPs registered, by day.",
    columns: [
      { key: "day", label: "Date", format: "date" },
      { key: "count", label: "Count", format: "number" },
      { key: "amount", label: "Monthly SIP value", format: "inr" },
    ],
    runSql: (sql) => sql`
      SELECT created_at::date AS day, COUNT(*)::int AS count, COALESCE(SUM(amount::numeric),0) AS amount
      FROM sips WHERE created_at >= now() - interval '30 days'
      GROUP BY 1 ORDER BY 1 DESC LIMIT 30
    `,
  },
  daily_lumpsum: {
    title: "Daily Lumpsum",
    desc: "Lumpsum purchases by day.",
    columns: [
      { key: "day", label: "Date", format: "date" },
      { key: "count", label: "Count", format: "number" },
      { key: "amount", label: "Amount", format: "inr" },
    ],
    runSql: (sql) => sql`
      SELECT order_date::date AS day, COUNT(*)::int AS count, COALESCE(SUM(amount::numeric),0) AS amount
      FROM transactions WHERE type = 'lumpsum' AND status = 'successful'
        AND order_date >= now() - interval '30 days'
      GROUP BY 1 ORDER BY 1 DESC LIMIT 30
    `,
  },
  redemption: {
    title: "Redemption Report",
    desc: "Outflows by day.",
    columns: [
      { key: "day", label: "Date", format: "date" },
      { key: "count", label: "Count", format: "number" },
      { key: "amount", label: "Redeemed", format: "inr" },
    ],
    runSql: (sql) => sql`
      SELECT order_date::date AS day, COUNT(*)::int AS count, COALESCE(SUM(amount::numeric),0) AS amount
      FROM transactions WHERE type = 'redemption' AND status = 'successful'
        AND order_date >= now() - interval '30 days'
      GROUP BY 1 ORDER BY 1 DESC LIMIT 30
    `,
  },
  net_sales: {
    title: "Net Sales",
    desc: "Gross inflow minus redemption, by day.",
    columns: [
      { key: "day", label: "Date", format: "date" },
      { key: "gross", label: "Gross inflow", format: "inr" },
      { key: "redemption", label: "Redemption", format: "inr" },
      { key: "net", label: "Net", format: "inr" },
    ],
    runSql: (sql) => sql`
      SELECT order_date::date AS day,
        COALESCE(SUM(CASE WHEN direction='inflow' THEN amount::numeric END),0) AS gross,
        COALESCE(SUM(CASE WHEN direction='outflow' THEN amount::numeric END),0) AS redemption,
        COALESCE(SUM(CASE WHEN direction='inflow' THEN amount::numeric ELSE -amount::numeric END),0) AS net
      FROM transactions WHERE status = 'successful'
        AND order_date >= now() - interval '30 days'
      GROUP BY 1 ORDER BY 1 DESC LIMIT 30
    `,
  },
  sip_rejected: {
    title: "SIP Rejected",
    desc: "Recently rejected SIPs.",
    columns: [
      { key: "name", label: "Investor" },
      { key: "scheme_name", label: "Scheme" },
      { key: "amount", label: "Amount", format: "inr" },
      { key: "reason_code", label: "Reason" },
      { key: "created_at", label: "When", format: "date" },
    ],
    runSql: (sql) => sql`
      SELECT i.name, t.scheme_name, t.amount, t.reason_code, t.created_at
      FROM transactions t LEFT JOIN investors i ON i.id = t.investor_id
      WHERE t.type = 'sip' AND t.status = 'rejected'
      ORDER BY t.created_at DESC LIMIT 100
    `,
  },
  active_sip_book: {
    title: "Active SIP Book",
    desc: "Active SIPs by scheme.",
    columns: [
      { key: "scheme_name", label: "Scheme" },
      { key: "count", label: "Count", format: "number" },
      { key: "monthly_value", label: "Monthly value", format: "inr" },
    ],
    runSql: (sql) => sql`
      SELECT scheme_name, COUNT(*)::int AS count, COALESCE(SUM(amount::numeric),0) AS monthly_value
      FROM sips WHERE status = 'active' AND scheme_name IS NOT NULL
      GROUP BY scheme_name ORDER BY monthly_value DESC LIMIT 50
    `,
  },
  rm_business: {
    title: "RM-wise Business",
    desc: "AUM and SIP book per RM.",
    columns: [
      { key: "rm_name", label: "RM" },
      { key: "clients", label: "Clients", format: "number" },
      { key: "aum", label: "AUM", format: "inr" },
      { key: "sip_book", label: "SIP book", format: "inr" },
    ],
    runSql: (sql) => sql`
      SELECT u.name AS rm_name, COUNT(i.id)::int AS clients,
        COALESCE(SUM(i.aum::numeric),0) AS aum,
        COALESCE(SUM(i.active_sip_amount::numeric),0) AS sip_book
      FROM users u LEFT JOIN investors i ON i.rm_id = u.id AND i.status = 'active' AND i.deleted_at IS NULL
      WHERE 'rm' = ANY(u.roles) GROUP BY u.id, u.name ORDER BY aum DESC
    `,
  },
  high_aum: {
    title: "High-AUM Clients",
    desc: "Top 100 clients by AUM.",
    columns: [
      { key: "name", label: "Investor" },
      { key: "segment_tag", label: "Segment" },
      { key: "aum", label: "AUM", format: "inr" },
      { key: "active_sip_amount", label: "Active SIP", format: "inr" },
      { key: "last_review_at", label: "Last review", format: "date" },
    ],
    runSql: (sql) => sql`
      SELECT name, segment_tag, aum, active_sip_amount, last_review_at
      FROM investors WHERE status = 'active' AND deleted_at IS NULL ORDER BY aum::numeric DESC LIMIT 100
    `,
  },
  dormant: {
    title: "Dormant Clients",
    desc: "No transactions in 180+ days.",
    columns: [
      { key: "name", label: "Investor" },
      { key: "aum", label: "AUM", format: "inr" },
      { key: "last_transaction_at", label: "Last txn", format: "date" },
    ],
    runSql: (sql) => sql`
      SELECT name, aum, last_transaction_at FROM investors
      WHERE status = 'active' AND deleted_at IS NULL
        AND (last_transaction_at IS NULL OR last_transaction_at < now() - make_interval(days => COALESCE((SELECT dormancy_window_days FROM tenants WHERE id = investors.tenant_id), 180)))
      ORDER BY last_transaction_at NULLS FIRST LIMIT 100
    `,
  },
  review_pending: {
    title: "Review Pending",
    desc: "Investors with reviews overdue or upcoming.",
    columns: [
      { key: "name", label: "Investor" },
      { key: "segment_tag", label: "Segment" },
      { key: "last_review_at", label: "Last review", format: "date" },
      { key: "next_review_at", label: "Next review", format: "date" },
    ],
    runSql: (sql) => sql`
      SELECT name, segment_tag, last_review_at, next_review_at FROM investors
      WHERE status = 'active' AND deleted_at IS NULL AND next_review_at IS NOT NULL
      ORDER BY next_review_at ASC LIMIT 100
    `,
  },
  service_pending: {
    title: "Service Requests Pending",
    desc: "Open + in-progress service requests.",
    columns: [
      { key: "ticket_no", label: "Ticket" },
      { key: "type", label: "Type" },
      { key: "status", label: "Status" },
      { key: "sla_resolution_at", label: "SLA", format: "date" },
    ],
    runSql: (sql) => sql`
      SELECT ticket_no, type, status, sla_resolution_at
      FROM service_requests WHERE status IN ('open', 'in_progress')
      ORDER BY sla_resolution_at ASC NULLS LAST LIMIT 100
    `,
  },
  lead_conversion: {
    title: "Lead Conversion",
    desc: "Conversion funnel by source.",
    columns: [
      { key: "source", label: "Source" },
      { key: "total", label: "Total", format: "number" },
      { key: "converted", label: "Converted", format: "number" },
      { key: "rate", label: "Rate %", format: "number" },
    ],
    runSql: (sql) => sql`
      SELECT source, COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE converted_investor_id IS NOT NULL)::int AS converted,
        ROUND(100.0 * COUNT(*) FILTER (WHERE converted_investor_id IS NOT NULL) / NULLIF(COUNT(*),0), 1) AS rate
      FROM leads GROUP BY source ORDER BY total DESC
    `,
  },
  // -------------------- Module 5: Family Mapping reports --------------------
  family_aum: {
    title: "Family-wise AUM",
    desc: "Combined AUM and member count per family group.",
    columns: [
      { key: "family_name", label: "Family" },
      { key: "members", label: "Members", format: "number" },
      { key: "aum", label: "Combined AUM", format: "inr" },
      { key: "sip", label: "Combined SIP", format: "inr" },
      { key: "primary", label: "Primary client" },
    ],
    runSql: (sql) => sql`
      SELECT COALESCE(f.family_name, f.head_name) AS family_name,
        COUNT(i.id)::int AS members,
        COALESCE(SUM(i.aum::numeric), 0)::numeric AS aum,
        COALESCE(SUM(i.active_sip_amount::numeric), 0)::numeric AS sip,
        (SELECT name FROM investors WHERE id = f.primary_investor_id) AS primary
      FROM families f
      LEFT JOIN investors i ON i.family_id = f.id AND i.status = 'active' AND i.deleted_at IS NULL
      GROUP BY f.id ORDER BY aum DESC NULLS LAST LIMIT 200
    `,
  },
  family_sip: {
    title: "Family-wise SIP",
    desc: "Total monthly SIP commitment by family.",
    columns: [
      { key: "family_name", label: "Family" },
      { key: "members_with_sip", label: "Members with SIP", format: "number" },
      { key: "monthly_sip", label: "Monthly SIP", format: "inr" },
      { key: "yearly_run_rate", label: "Yearly run-rate", format: "inr" },
    ],
    runSql: (sql) => sql`
      SELECT COALESCE(f.family_name, f.head_name) AS family_name,
        COUNT(i.id) FILTER (WHERE i.active_sip_amount::numeric > 0)::int AS members_with_sip,
        COALESCE(SUM(i.active_sip_amount::numeric), 0)::numeric AS monthly_sip,
        COALESCE(SUM(i.active_sip_amount::numeric) * 12, 0)::numeric AS yearly_run_rate
      FROM families f
      LEFT JOIN investors i ON i.family_id = f.id AND i.status = 'active' AND i.deleted_at IS NULL
      GROUP BY f.id
      HAVING SUM(i.active_sip_amount::numeric) > 0
      ORDER BY monthly_sip DESC LIMIT 200
    `,
  },
  unmapped_family_members: {
    title: "Unmapped family members",
    desc: "Active investors not yet linked to any family group.",
    columns: [
      { key: "name", label: "Investor" },
      { key: "pan", label: "PAN" },
      { key: "segment_tag", label: "Segment" },
      { key: "aum", label: "AUM", format: "inr" },
      { key: "rm_name", label: "RM" },
      { key: "onboarded_at", label: "Client since", format: "date" },
    ],
    runSql: (sql) => sql`
      SELECT i.name, i.pan, i.segment_tag, i.aum,
        u.name AS rm_name, i.onboarded_at
      FROM investors i
      LEFT JOIN users u ON u.id = i.rm_id
      WHERE i.status = 'active' AND i.deleted_at IS NULL AND i.family_id IS NULL
      ORDER BY i.aum::numeric DESC NULLS LAST LIMIT 500
    `,
  },
  family_review_due: {
    title: "Family review due",
    desc: "Families with next-review date overdue or within 30 days.",
    columns: [
      { key: "family_name", label: "Family" },
      { key: "members", label: "Members", format: "number" },
      { key: "combined_aum", label: "Combined AUM", format: "inr" },
      { key: "last_review_at", label: "Last review", format: "date" },
      { key: "next_review_at", label: "Next review", format: "date" },
    ],
    runSql: (sql) => sql`
      SELECT COALESCE(f.family_name, f.head_name) AS family_name,
        COUNT(i.id)::int AS members,
        COALESCE(SUM(i.aum::numeric), 0)::numeric AS combined_aum,
        f.last_review_at, f.next_review_at
      FROM families f
      LEFT JOIN investors i ON i.family_id = f.id AND i.status = 'active' AND i.deleted_at IS NULL
      WHERE f.next_review_at IS NOT NULL
        AND f.next_review_at <= now() + interval '30 days'
      GROUP BY f.id ORDER BY f.next_review_at ASC LIMIT 200
    `,
  },
  next_gen_prospects: {
    title: "Next-generation prospect list",
    desc: "Family members aged 18–30 (or minors approaching majority) with no AUM yet.",
    columns: [
      { key: "investor_name", label: "Prospect" },
      { key: "family_name", label: "Family" },
      { key: "family_role", label: "Relation" },
      { key: "dob", label: "DOB", format: "date" },
      { key: "age", label: "Age", format: "number" },
      { key: "is_minor", label: "Minor?" },
      { key: "rm_name", label: "Family RM" },
    ],
    runSql: (sql) => sql`
      SELECT i.name AS investor_name,
        COALESCE(f.family_name, f.head_name) AS family_name,
        i.family_role,
        i.dob,
        EXTRACT(YEAR FROM age(current_date, i.dob))::int AS age,
        CASE WHEN i.is_minor THEN 'yes' ELSE 'no' END AS is_minor,
        u.name AS rm_name
      FROM investors i
      JOIN families f ON f.id = i.family_id
      LEFT JOIN users u ON u.id = COALESCE(f.rm_id, i.rm_id)
      WHERE i.family_id IS NOT NULL
        AND i.deleted_at IS NULL
        AND i.dob IS NOT NULL
        AND (i.aum::numeric IS NULL OR i.aum::numeric = 0)
        AND (
          i.is_minor = true
          OR EXTRACT(YEAR FROM age(current_date, i.dob)) BETWEEN 18 AND 30
        )
      ORDER BY age ASC LIMIT 500
    `,
  },
  // -------------------- Module 8: Goal Planning reports --------------------
  goal_clients: {
    title: "Goal-wise clients",
    desc: "Clients with each goal category — count, total target, average target.",
    columns: [
      { key: "category", label: "Category" },
      { key: "client_count", label: "Clients", format: "number" },
      { key: "goal_count", label: "Goals", format: "number" },
      { key: "total_target", label: "Total target", format: "inr" },
      { key: "avg_target", label: "Avg target", format: "inr" },
    ],
    runSql: (sql) => sql`
      SELECT category,
        COUNT(DISTINCT investor_id)::int AS client_count,
        COUNT(*)::int AS goal_count,
        COALESCE(SUM(target_amount::numeric), 0)::numeric AS total_target,
        COALESCE(AVG(target_amount::numeric), 0)::numeric AS avg_target
      FROM goals
      WHERE status NOT IN ('abandoned')
      GROUP BY category ORDER BY client_count DESC
    `,
  },
  goals_behind: {
    title: "Goals behind track",
    desc: "Goals where projected corpus is short of target.",
    columns: [
      { key: "investor_name", label: "Investor" },
      { key: "goal_name", label: "Goal" },
      { key: "category", label: "Category" },
      { key: "target_amount", label: "Target", format: "inr" },
      { key: "current_value", label: "Linked", format: "inr" },
      { key: "required_monthly_sip", label: "Req. SIP", format: "inr" },
      { key: "existing_monthly_sip", label: "Existing SIP", format: "inr" },
      { key: "gap_amount", label: "Gap", format: "inr" },
      { key: "target_date", label: "Target", format: "date" },
    ],
    runSql: (sql) => sql`
      SELECT i.name AS investor_name, g.name AS goal_name, g.category,
        g.target_amount, g.current_value,
        g.required_monthly_sip, g.existing_monthly_sip, g.gap_amount, g.target_date
      FROM goals g
      LEFT JOIN investors i ON i.id = g.investor_id
      WHERE g.status = 'behind_track'
      ORDER BY g.gap_amount::numeric DESC NULLS LAST LIMIT 200
    `,
  },
  goals_5yr: {
    title: "Goals due in next 5 years",
    desc: "Goals with target date within the next 60 months — review and rebalance candidates.",
    columns: [
      { key: "investor_name", label: "Investor" },
      { key: "goal_name", label: "Goal" },
      { key: "category", label: "Category" },
      { key: "target_amount", label: "Target", format: "inr" },
      { key: "current_value", label: "Linked", format: "inr" },
      { key: "gap_amount", label: "Gap", format: "inr" },
      { key: "target_date", label: "Target", format: "date" },
      { key: "status", label: "Status" },
    ],
    runSql: (sql) => sql`
      SELECT i.name AS investor_name, g.name AS goal_name, g.category,
        g.target_amount, g.current_value, g.gap_amount, g.target_date, g.status
      FROM goals g
      LEFT JOIN investors i ON i.id = g.investor_id
      WHERE g.status NOT IN ('achieved', 'abandoned')
        AND g.target_date <= current_date + interval '5 years'
        AND g.target_date >= current_date
      ORDER BY g.target_date ASC LIMIT 500
    `,
  },
  retirement_clients: {
    title: "Retirement planning clients",
    desc: "Clients with an active retirement goal — corpus needed vs current investment.",
    columns: [
      { key: "investor_name", label: "Investor" },
      { key: "goal_name", label: "Goal" },
      { key: "target_amount", label: "Corpus target", format: "inr" },
      { key: "current_value", label: "Linked", format: "inr" },
      { key: "required_monthly_sip", label: "Req. SIP", format: "inr" },
      { key: "existing_monthly_sip", label: "Existing SIP", format: "inr" },
      { key: "target_date", label: "Retirement year", format: "date" },
      { key: "status", label: "Status" },
    ],
    runSql: (sql) => sql`
      SELECT i.name AS investor_name, g.name AS goal_name,
        g.target_amount, g.current_value,
        g.required_monthly_sip, g.existing_monthly_sip, g.target_date, g.status
      FROM goals g
      LEFT JOIN investors i ON i.id = g.investor_id
      WHERE g.category = 'retirement' AND g.status NOT IN ('abandoned')
      ORDER BY g.target_date ASC LIMIT 300
    `,
  },
  child_edu_clients: {
    title: "Child education planning clients",
    desc: "Clients with an active child-education goal.",
    columns: [
      { key: "investor_name", label: "Investor" },
      { key: "goal_name", label: "Goal" },
      { key: "target_amount", label: "Target", format: "inr" },
      { key: "current_value", label: "Linked", format: "inr" },
      { key: "required_monthly_sip", label: "Req. SIP", format: "inr" },
      { key: "existing_monthly_sip", label: "Existing SIP", format: "inr" },
      { key: "target_date", label: "Target year", format: "date" },
      { key: "status", label: "Status" },
    ],
    runSql: (sql) => sql`
      SELECT i.name AS investor_name, g.name AS goal_name,
        g.target_amount, g.current_value,
        g.required_monthly_sip, g.existing_monthly_sip, g.target_date, g.status
      FROM goals g
      LEFT JOIN investors i ON i.id = g.investor_id
      WHERE g.category IN ('child_education', 'education')
        AND g.status NOT IN ('abandoned')
      ORDER BY g.target_date ASC LIMIT 300
    `,
  },
  // -------------------- Module 9: MF Transaction reports --------------------
  amc_business: {
    title: "AMC-wise business",
    desc: "Inflow / outflow / net business per AMC for the last 90 days.",
    columns: [
      { key: "amc", label: "AMC" },
      { key: "transactions", label: "Txns", format: "number" },
      { key: "inflow", label: "Inflow", format: "inr" },
      { key: "outflow", label: "Outflow", format: "inr" },
      { key: "net", label: "Net", format: "inr" },
    ],
    runSql: (sql) => sql`
      SELECT COALESCE(amc_name, amc_code, '—') AS amc,
        COUNT(*)::int AS transactions,
        COALESCE(SUM(CASE WHEN direction = 'inflow' THEN amount::numeric ELSE 0 END), 0) AS inflow,
        COALESCE(SUM(CASE WHEN direction = 'outflow' THEN amount::numeric ELSE 0 END), 0) AS outflow,
        COALESCE(SUM(CASE WHEN direction = 'inflow' THEN amount::numeric ELSE -amount::numeric END), 0) AS net
      FROM transactions
      WHERE status IN ('successful','processed')
        AND order_date >= current_date - interval '90 days'
      GROUP BY COALESCE(amc_name, amc_code, '—')
      ORDER BY net DESC LIMIT 100
    `,
  },
  // -------------------- Module 11: SIP Rejection recovery report --------------------
  sip_recovery_monthly: {
    title: "Monthly SIP Rejection Recovery",
    desc: "Last 6 months — rejections raised vs. recovered, with recovery %.",
    columns: [
      { key: "month", label: "Month" },
      { key: "rejections", label: "Rejections", format: "number" },
      { key: "rejected_value", label: "Rejected ₹", format: "inr" },
      { key: "recovered_count", label: "Recovered", format: "number" },
      { key: "recovered_value", label: "Recovered ₹", format: "inr" },
      { key: "recovery_rate", label: "Recovery %", format: "number" },
      { key: "outstanding", label: "Outstanding ₹", format: "inr" },
    ],
    runSql: (sql) => sql`
      SELECT to_char(date_trunc('month', rejection_date), 'Mon YYYY') AS month,
        COUNT(*)::int AS rejections,
        COALESCE(SUM(rejection_amount::numeric), 0)::numeric AS rejected_value,
        COUNT(*) FILTER (WHERE recovery_status = 'recovered')::int AS recovered_count,
        COALESCE(SUM(CASE WHEN recovery_status = 'recovered'
          THEN rejection_amount::numeric ELSE 0 END), 0)::numeric AS recovered_value,
        ROUND(
          100.0 * COALESCE(SUM(CASE WHEN recovery_status = 'recovered'
            THEN rejection_amount::numeric ELSE 0 END), 0)
          / NULLIF(COALESCE(SUM(rejection_amount::numeric), 0), 0),
        1) AS recovery_rate,
        COALESCE(SUM(CASE WHEN recovery_status NOT IN ('recovered', 'not_recoverable')
          THEN rejection_amount::numeric ELSE 0 END), 0)::numeric AS outstanding
      FROM sip_rejections
      WHERE rejection_date >= date_trunc('month', now()) - interval '5 months'
      GROUP BY date_trunc('month', rejection_date)
      ORDER BY date_trunc('month', rejection_date) DESC
    `,
  },
  // -------------------- Module 10: SIP Tracker reports --------------------
  sip_added_mtd: {
    title: "SIP Added This Month",
    desc: "New SIPs registered since the 1st of the current month.",
    columns: [
      { key: "investor_name", label: "Investor" },
      { key: "scheme_name", label: "Scheme" },
      { key: "amc_name", label: "AMC" },
      { key: "amount", label: "Amount", format: "inr" },
      { key: "frequency", label: "Frequency" },
      { key: "start_date", label: "Start", format: "date" },
      { key: "rm_name", label: "RM" },
    ],
    runSql: (sql) => sql`
      SELECT i.name AS investor_name, s.scheme_name, s.amc_name, s.amount,
             s.frequency, s.start_date, u.name AS rm_name
      FROM sips s
      LEFT JOIN investors i ON i.id = s.investor_id
      LEFT JOIN users u ON u.id = COALESCE(s.rm_id, i.rm_id)
      WHERE s.status = 'active'
        AND s.created_at >= date_trunc('month', now())
      ORDER BY s.created_at DESC LIMIT 500
    `,
  },
  sip_expiring: {
    title: "SIP Expiring Soon",
    desc: "Active SIPs whose end_date is within the next 120 days — candidates for renewal or step-up.",
    columns: [
      { key: "investor_name", label: "Investor" },
      { key: "scheme_name", label: "Scheme" },
      { key: "amc_name", label: "AMC" },
      { key: "amount", label: "Amount", format: "inr" },
      { key: "end_date", label: "Ends", format: "date" },
      { key: "days_left", label: "Days left", format: "number" },
      { key: "rm_name", label: "RM" },
    ],
    runSql: (sql) => sql`
      SELECT i.name AS investor_name, s.scheme_name, s.amc_name, s.amount,
             s.end_date,
             (s.end_date - current_date)::int AS days_left,
             u.name AS rm_name
      FROM sips s
      LEFT JOIN investors i ON i.id = s.investor_id
      LEFT JOIN users u ON u.id = COALESCE(s.rm_id, i.rm_id)
      WHERE s.status = 'active' AND s.end_date IS NOT NULL
        AND s.end_date BETWEEN current_date AND current_date + interval '120 days'
      ORDER BY s.end_date ASC LIMIT 500
    `,
  },
  sip_topup_opportunity: {
    title: "SIP Top-Up Opportunity",
    desc: "HNI / Affluent investors with active SIPs unchanged for 12+ months — top-up candidates.",
    columns: [
      { key: "investor_name", label: "Investor" },
      { key: "segment_tag", label: "Segment" },
      { key: "current_monthly_sip", label: "Current SIP", format: "inr" },
      { key: "aum", label: "AUM", format: "inr" },
      { key: "months_since_change", label: "Months unchanged", format: "number" },
      { key: "rm_name", label: "RM" },
    ],
    runSql: (sql) => sql`
      SELECT i.name AS investor_name, i.segment_tag,
             i.active_sip_amount AS current_monthly_sip, i.aum,
             EXTRACT(MONTH FROM age(now(), MAX(s.created_at)))::int
               + 12 * EXTRACT(YEAR FROM age(now(), MAX(s.created_at)))::int AS months_since_change,
             u.name AS rm_name
      FROM investors i
      LEFT JOIN sips s ON s.investor_id = i.id AND s.status = 'active'
      LEFT JOIN users u ON u.id = i.rm_id
      WHERE i.status = 'active' AND i.deleted_at IS NULL
        AND i.segment_tag IN ('HNI', 'Affluent')
        AND i.active_sip_amount::numeric > 0
      GROUP BY i.id, u.name
      HAVING MAX(s.created_at) < now() - interval '12 months'
      ORDER BY i.aum::numeric DESC NULLS LAST LIMIT 200
    `,
  },
  rm_sip_book: {
    title: "RM-wise SIP Book",
    desc: "Active SIP count + monthly inflow grouped by relationship manager.",
    columns: [
      { key: "rm_name", label: "RM" },
      { key: "active_sips", label: "Active SIPs", format: "number" },
      { key: "monthly_sip", label: "Monthly inflow", format: "inr" },
      { key: "yearly_run_rate", label: "Yearly run-rate", format: "inr" },
      { key: "added_mtd", label: "Added MTD", format: "number" },
      { key: "stopped_mtd", label: "Stopped MTD", format: "number" },
    ],
    runSql: (sql) => sql`
      SELECT COALESCE(u.name, '— unassigned —') AS rm_name,
        COUNT(*) FILTER (WHERE s.status = 'active')::int AS active_sips,
        COALESCE(SUM(CASE WHEN s.status = 'active' THEN s.amount::numeric ELSE 0 END), 0)::numeric AS monthly_sip,
        COALESCE(SUM(CASE WHEN s.status = 'active' THEN s.amount::numeric ELSE 0 END), 0)::numeric * 12 AS yearly_run_rate,
        COUNT(*) FILTER (WHERE s.status = 'active'
          AND s.created_at >= date_trunc('month', now()))::int AS added_mtd,
        COUNT(*) FILTER (WHERE s.status IN ('stopped','rejected')
          AND s.updated_at >= date_trunc('month', now()))::int AS stopped_mtd
      FROM sips s
      LEFT JOIN investors i ON i.id = s.investor_id
      LEFT JOIN users u ON u.id = COALESCE(s.rm_id, i.rm_id)
      GROUP BY u.id, u.name
      ORDER BY monthly_sip DESC LIMIT 100
    `,
  },
  scheme_category_business: {
    title: "Scheme category-wise business",
    desc: "Equity / Debt / Hybrid / etc. — inflow + outflow + net for last 90 days.",
    columns: [
      { key: "category", label: "Category" },
      { key: "transactions", label: "Txns", format: "number" },
      { key: "investors_count", label: "Investors", format: "number" },
      { key: "inflow", label: "Inflow", format: "inr" },
      { key: "outflow", label: "Outflow", format: "inr" },
      { key: "net", label: "Net", format: "inr" },
    ],
    runSql: (sql) => sql`
      SELECT COALESCE(scheme_category, '—') AS category,
        COUNT(*)::int AS transactions,
        COUNT(DISTINCT investor_id)::int AS investors_count,
        COALESCE(SUM(CASE WHEN direction = 'inflow' THEN amount::numeric ELSE 0 END), 0) AS inflow,
        COALESCE(SUM(CASE WHEN direction = 'outflow' THEN amount::numeric ELSE 0 END), 0) AS outflow,
        COALESCE(SUM(CASE WHEN direction = 'inflow' THEN amount::numeric ELSE -amount::numeric END), 0) AS net
      FROM transactions
      WHERE status IN ('successful','processed')
        AND order_date >= current_date - interval '90 days'
      GROUP BY COALESCE(scheme_category, '—')
      ORDER BY net DESC LIMIT 50
    `,
  },
  // -------------------- Module 14: Complaint Register reports --------------------
  open_complaints: {
    title: "Open complaints",
    desc: "Complaints currently open, in-progress, or escalated — with age in days and SLA status.",
    columns: [
      { key: "ticket_no", label: "Complaint ID" },
      { key: "investor_name", label: "Client" },
      { key: "sebi_category", label: "Category" },
      { key: "subject", label: "Subject" },
      { key: "priority", label: "Priority" },
      { key: "assignee_name", label: "Assigned to" },
      { key: "days_open", label: "Days open", format: "number" },
      { key: "sla_resolution_at", label: "Due", format: "date" },
      { key: "status", label: "Status" },
      { key: "breached", label: "Breached?" },
    ],
    runSql: (sql) => sql`
      SELECT sr.ticket_no,
        i.name AS investor_name,
        COALESCE(sr.sebi_category, 'Other') AS sebi_category,
        sr.subject,
        sr.priority,
        u.name AS assignee_name,
        EXTRACT(DAY FROM now() - sr.created_at)::int AS days_open,
        sr.sla_resolution_at,
        sr.status,
        CASE WHEN sr.sla_resolution_at < now() THEN 'yes' ELSE 'no' END AS breached
      FROM service_requests sr
      LEFT JOIN investors i ON i.id = sr.investor_id
      LEFT JOIN users u ON u.id = sr.assigned_to_user_id
      WHERE sr.type = 'complaint'
        AND sr.status IN ('open','in_progress','escalated','waiting_customer')
      ORDER BY sr.sla_resolution_at ASC NULLS LAST, sr.created_at ASC
      LIMIT 500
    `,
  },
  resolved_complaints: {
    title: "Resolved complaints",
    desc: "Complaints resolved or closed in the last 90 days — TAT + resolution notes.",
    columns: [
      { key: "ticket_no", label: "Complaint ID" },
      { key: "investor_name", label: "Client" },
      { key: "sebi_category", label: "Category" },
      { key: "subject", label: "Subject" },
      { key: "assignee_name", label: "Assigned to" },
      { key: "resolved_at", label: "Closed on", format: "date" },
      { key: "tat_days", label: "TAT (days)", format: "number" },
      { key: "within_sla", label: "Within SLA?" },
      { key: "resolution_notes", label: "Resolution notes" },
    ],
    runSql: (sql) => sql`
      SELECT sr.ticket_no,
        i.name AS investor_name,
        COALESCE(sr.sebi_category, 'Other') AS sebi_category,
        sr.subject,
        u.name AS assignee_name,
        sr.resolved_at,
        EXTRACT(DAY FROM sr.resolved_at - sr.created_at)::int AS tat_days,
        CASE
          WHEN sr.sla_resolution_at IS NULL THEN '—'
          WHEN sr.resolved_at <= sr.sla_resolution_at THEN 'yes'
          ELSE 'no'
        END AS within_sla,
        sr.resolution_notes
      FROM service_requests sr
      LEFT JOIN investors i ON i.id = sr.investor_id
      LEFT JOIN users u ON u.id = sr.assigned_to_user_id
      WHERE sr.type = 'complaint'
        AND sr.status IN ('resolved','closed')
        AND sr.resolved_at >= now() - interval '90 days'
      ORDER BY sr.resolved_at DESC
      LIMIT 500
    `,
  },
  complaint_tat: {
    title: "Complaint TAT report",
    desc: "Monthly resolution metrics — average TAT, SEBI 21-day compliance %, breach count.",
    columns: [
      { key: "month", label: "Month" },
      { key: "total_resolved", label: "Resolved", format: "number" },
      { key: "avg_tat_days", label: "Avg TAT (d)", format: "number" },
      { key: "max_tat_days", label: "Max TAT (d)", format: "number" },
      { key: "within_sla", label: "Within SLA", format: "number" },
      { key: "breached", label: "Breached", format: "number" },
      { key: "sla_compliance_pct", label: "SLA %", format: "number" },
    ],
    runSql: (sql) => sql`
      SELECT to_char(date_trunc('month', resolved_at), 'Mon YYYY') AS month,
        COUNT(*)::int AS total_resolved,
        ROUND(AVG(EXTRACT(DAY FROM resolved_at - created_at))::numeric, 1) AS avg_tat_days,
        MAX(EXTRACT(DAY FROM resolved_at - created_at))::int AS max_tat_days,
        COUNT(*) FILTER (
          WHERE sla_resolution_at IS NOT NULL AND resolved_at <= sla_resolution_at
        )::int AS within_sla,
        COUNT(*) FILTER (
          WHERE sla_resolution_at IS NOT NULL AND resolved_at > sla_resolution_at
        )::int AS breached,
        ROUND(
          100.0 * COUNT(*) FILTER (
            WHERE sla_resolution_at IS NOT NULL AND resolved_at <= sla_resolution_at
          )
          / NULLIF(COUNT(*) FILTER (WHERE sla_resolution_at IS NOT NULL), 0),
        1) AS sla_compliance_pct
      FROM service_requests
      WHERE type = 'complaint'
        AND status IN ('resolved','closed')
        AND resolved_at IS NOT NULL
        AND resolved_at >= date_trunc('month', now()) - interval '11 months'
      GROUP BY date_trunc('month', resolved_at)
      ORDER BY date_trunc('month', resolved_at) DESC
    `,
  },
  // -------------------- Module 16: Marketing Campaigns reports --------------------
  campaign_leads: {
    title: "Campaign-wise leads",
    desc: "Leads generated by each marketing campaign — lifetime view sorted by leads.",
    columns: [
      { key: "name", label: "Campaign" },
      { key: "kind", label: "Type" },
      { key: "theme", label: "Theme" },
      { key: "start_date", label: "Start", format: "date" },
      { key: "end_date", label: "End", format: "date" },
      { key: "leads_generated", label: "Leads", format: "number" },
      { key: "campaign_cost", label: "Cost", format: "inr" },
      { key: "cost_per_lead", label: "Cost / Lead", format: "inr" },
    ],
    runSql: (sql) => sql`
      SELECT name,
        COALESCE(kind, channel) AS kind,
        theme,
        start_date, end_date,
        COALESCE(leads_generated, 0) AS leads_generated,
        campaign_cost::numeric AS campaign_cost,
        CASE
          WHEN COALESCE(leads_generated, 0) = 0 OR campaign_cost IS NULL THEN NULL
          ELSE ROUND(campaign_cost::numeric / leads_generated, 0)
        END AS cost_per_lead
      FROM campaigns
      WHERE status != 'cancelled'
      ORDER BY COALESCE(leads_generated, 0) DESC, created_at DESC
      LIMIT 200
    `,
  },
  campaign_conversion: {
    title: "Campaign-wise conversion",
    desc: "Leads → meetings → conversions funnel per campaign, with conversion %.",
    columns: [
      { key: "name", label: "Campaign" },
      { key: "kind", label: "Type" },
      { key: "leads", label: "Leads", format: "number" },
      { key: "meetings", label: "Meetings", format: "number" },
      { key: "converted", label: "Converted", format: "number" },
      { key: "meeting_rate", label: "Meet %", format: "number" },
      { key: "conversion_rate", label: "Conv %", format: "number" },
      { key: "cost", label: "Cost", format: "inr" },
      { key: "cost_per_conversion", label: "Cost / Conv", format: "inr" },
    ],
    runSql: (sql) => sql`
      SELECT name,
        COALESCE(kind, channel) AS kind,
        COALESCE(leads_generated, 0) AS leads,
        COALESCE(meetings_booked, 0) AS meetings,
        COALESCE(clients_converted, 0) AS converted,
        ROUND(100.0 * COALESCE(meetings_booked, 0)
          / NULLIF(COALESCE(leads_generated, 0), 0), 1) AS meeting_rate,
        ROUND(100.0 * COALESCE(clients_converted, 0)
          / NULLIF(COALESCE(leads_generated, 0), 0), 1) AS conversion_rate,
        campaign_cost::numeric AS cost,
        CASE
          WHEN COALESCE(clients_converted, 0) = 0 OR campaign_cost IS NULL THEN NULL
          ELSE ROUND(campaign_cost::numeric / clients_converted, 0)
        END AS cost_per_conversion
      FROM campaigns
      WHERE status != 'cancelled'
      ORDER BY converted DESC, leads DESC
      LIMIT 200
    `,
  },
  marketing_calendar: {
    title: "Monthly marketing calendar",
    desc: "Campaigns by month — count, total leads, conversions, spend per month.",
    columns: [
      { key: "month", label: "Month" },
      { key: "campaigns", label: "Campaigns", format: "number" },
      { key: "types", label: "Types" },
      { key: "leads", label: "Leads", format: "number" },
      { key: "meetings", label: "Meetings", format: "number" },
      { key: "converted", label: "Converted", format: "number" },
      { key: "spend", label: "Spend", format: "inr" },
    ],
    runSql: (sql) => sql`
      SELECT to_char(date_trunc('month', COALESCE(start_date, created_at)), 'Mon YYYY') AS month,
        COUNT(*)::int AS campaigns,
        string_agg(DISTINCT COALESCE(kind, channel), ', ') AS types,
        COALESCE(SUM(leads_generated), 0)::int AS leads,
        COALESCE(SUM(meetings_booked), 0)::int AS meetings,
        COALESCE(SUM(clients_converted), 0)::int AS converted,
        COALESCE(SUM(campaign_cost::numeric), 0)::numeric AS spend
      FROM campaigns
      WHERE status != 'cancelled'
        AND COALESCE(start_date, created_at) >= date_trunc('month', now()) - interval '11 months'
      GROUP BY date_trunc('month', COALESCE(start_date, created_at))
      ORDER BY date_trunc('month', COALESCE(start_date, created_at)) DESC
    `,
  },
  pending_approval_content: {
    title: "Pending approval content",
    desc: "Campaigns whose content / compliance / approval gate is still open — owner action queue.",
    columns: [
      { key: "name", label: "Campaign" },
      { key: "kind", label: "Type" },
      { key: "theme", label: "Theme" },
      { key: "start_date", label: "Goes live", format: "date" },
      { key: "content_status", label: "Content" },
      { key: "compliance_check_status", label: "Compliance" },
      { key: "approval_status", label: "Approval" },
      { key: "days_in_queue", label: "Days waiting", format: "number" },
      { key: "remarks", label: "Remarks" },
    ],
    runSql: (sql) => sql`
      SELECT name,
        COALESCE(kind, channel) AS kind,
        theme, start_date,
        content_status, compliance_check_status, approval_status,
        EXTRACT(DAY FROM now() - created_at)::int AS days_in_queue,
        remarks
      FROM campaigns
      WHERE status NOT IN ('cancelled', 'sent')
        AND (
          approval_status = 'pending'
          OR compliance_check_status = 'pending'
          OR content_status IN ('not_started', 'drafting')
        )
      ORDER BY
        CASE WHEN start_date IS NULL THEN 1 ELSE 0 END,
        start_date ASC,
        created_at ASC
      LIMIT 200
    `,
  },
  complaint_category: {
    title: "Complaint category report",
    desc: "Volume + resolution metrics by SEBI complaint category — drives the FY-end SEBI inspection report.",
    columns: [
      { key: "category", label: "SEBI category" },
      { key: "total", label: "Total", format: "number" },
      { key: "open_count", label: "Open", format: "number" },
      { key: "resolved_count", label: "Resolved", format: "number" },
      { key: "escalated_count", label: "Escalated", format: "number" },
      { key: "avg_tat_days", label: "Avg TAT (d)", format: "number" },
      { key: "breach_pct", label: "Breach %", format: "number" },
    ],
    runSql: (sql) => sql`
      SELECT COALESCE(sebi_category, 'Other') AS category,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status IN ('open','in_progress','waiting_customer'))::int AS open_count,
        COUNT(*) FILTER (WHERE status IN ('resolved','closed'))::int AS resolved_count,
        COUNT(*) FILTER (WHERE status = 'escalated' OR escalated_at IS NOT NULL)::int AS escalated_count,
        ROUND(
          AVG(EXTRACT(DAY FROM resolved_at - created_at))
            FILTER (WHERE resolved_at IS NOT NULL)::numeric,
        1) AS avg_tat_days,
        ROUND(
          100.0 * COUNT(*) FILTER (
            WHERE sla_resolution_at IS NOT NULL
              AND (
                (resolved_at IS NOT NULL AND resolved_at > sla_resolution_at)
                OR (resolved_at IS NULL AND sla_resolution_at < now())
              )
          ) / NULLIF(COUNT(*), 0),
        1) AS breach_pct
      FROM service_requests
      WHERE type = 'complaint'
      GROUP BY COALESCE(sebi_category, 'Other')
      ORDER BY total DESC
    `,
  },

  // ───────────────────────────────────────────────────────────────────────
  // Module 19 — Employee / Team reports
  // ───────────────────────────────────────────────────────────────────────

  employee_tasks: {
    title: "Employee-wise tasks",
    desc:
      "For every team member: open tasks, overdue, due today, due this week, completed last 30 days, and SLA-breach count.",
    columns: [
      { key: "name", label: "Employee" },
      { key: "department", label: "Dept" },
      { key: "open_tasks", label: "Open", format: "number" },
      { key: "overdue_tasks", label: "Overdue", format: "number" },
      { key: "due_today", label: "Due today", format: "number" },
      { key: "due_this_week", label: "Due 7d", format: "number" },
      { key: "completed_30d", label: "Completed 30d", format: "number" },
      { key: "sla_breached", label: "SLA breach", format: "number" },
    ],
    runSql: (sql) => sql`
      SELECT
        u.name,
        COALESCE(u.department, '—') AS department,
        COUNT(t.id) FILTER (WHERE t.status IN ('open','in_progress'))::int AS open_tasks,
        COUNT(t.id) FILTER (WHERE t.status IN ('open','in_progress') AND t.due_at < now())::int AS overdue_tasks,
        COUNT(t.id) FILTER (
          WHERE t.status IN ('open','in_progress') AND t.due_at::date = current_date
        )::int AS due_today,
        COUNT(t.id) FILTER (
          WHERE t.status IN ('open','in_progress')
            AND t.due_at >= now() AND t.due_at < now() + interval '7 days'
        )::int AS due_this_week,
        COUNT(t.id) FILTER (
          WHERE t.status = 'completed' AND t.completed_at >= now() - interval '30 days'
        )::int AS completed_30d,
        COUNT(t.id) FILTER (
          WHERE t.status IN ('open','in_progress')
            AND t.sla_due_at IS NOT NULL AND t.sla_due_at < now()
        )::int AS sla_breached
      FROM users u
      LEFT JOIN tasks t ON t.assignee_id = u.id
      WHERE u.status IN ('active','invited')
      GROUP BY u.id, u.name, u.department
      ORDER BY open_tasks DESC, overdue_tasks DESC
    `,
  },

  rm_clients: {
    title: "RM-wise clients",
    desc:
      "Client headcount per RM split by segment and tier. Useful for territory rebalancing.",
    columns: [
      { key: "rm_name", label: "RM" },
      { key: "total_clients", label: "Total", format: "number" },
      { key: "hni", label: "HNI", format: "number" },
      { key: "affluent", label: "Affluent", format: "number" },
      { key: "retail", label: "Retail", format: "number" },
      { key: "tier_a", label: "Tier A", format: "number" },
      { key: "tier_b", label: "Tier B", format: "number" },
      { key: "tier_c", label: "Tier C", format: "number" },
      { key: "aum", label: "AUM", format: "inr" },
    ],
    runSql: (sql) => sql`
      SELECT
        u.name AS rm_name,
        COUNT(i.id)::int AS total_clients,
        COUNT(i.id) FILTER (WHERE i.segment_tag = 'HNI')::int AS hni,
        COUNT(i.id) FILTER (WHERE i.segment_tag = 'Affluent')::int AS affluent,
        COUNT(i.id) FILTER (WHERE i.segment_tag = 'Retail')::int AS retail,
        COUNT(i.id) FILTER (WHERE i.service_tier = 'A')::int AS tier_a,
        COUNT(i.id) FILTER (WHERE i.service_tier = 'B')::int AS tier_b,
        COUNT(i.id) FILTER (WHERE i.service_tier = 'C')::int AS tier_c,
        COALESCE(SUM(i.aum::numeric), 0) AS aum
      FROM users u
      LEFT JOIN investors i ON i.rm_id = u.id AND i.status = 'active' AND i.deleted_at IS NULL
      WHERE 'rm' = ANY(u.roles) AND u.status = 'active'
      GROUP BY u.id, u.name
      ORDER BY total_clients DESC
    `,
  },

  rm_reviews: {
    title: "RM-wise reviews",
    desc:
      "Per-RM review-meeting metrics: scheduled, completed last 30/90 days, overdue follow-ups, and review-cadence health.",
    columns: [
      { key: "rm_name", label: "RM" },
      { key: "upcoming", label: "Upcoming", format: "number" },
      { key: "completed_30d", label: "Done 30d", format: "number" },
      { key: "completed_90d", label: "Done 90d", format: "number" },
      { key: "no_show", label: "No-shows 90d", format: "number" },
      { key: "clients_no_recent_review", label: "Clients overdue review", format: "number" },
    ],
    runSql: (sql) => sql`
      SELECT
        u.name AS rm_name,
        COUNT(m.id) FILTER (
          WHERE m.status IN ('scheduled','confirmed') AND m.meeting_date >= now()
        )::int AS upcoming,
        COUNT(m.id) FILTER (
          WHERE m.status = 'completed' AND m.meeting_date >= now() - interval '30 days'
        )::int AS completed_30d,
        COUNT(m.id) FILTER (
          WHERE m.status = 'completed' AND m.meeting_date >= now() - interval '90 days'
        )::int AS completed_90d,
        COUNT(m.id) FILTER (
          WHERE m.status = 'no_show' AND m.meeting_date >= now() - interval '90 days'
        )::int AS no_show,
        (
          SELECT COUNT(*)::int FROM investors i
          WHERE i.rm_id = u.id AND i.status = 'active' AND i.deleted_at IS NULL
            AND (i.next_review_at IS NULL OR i.next_review_at < current_date)
        ) AS clients_no_recent_review
      FROM users u
      LEFT JOIN review_meetings m ON m.rm_id = u.id
      WHERE 'rm' = ANY(u.roles) AND u.status = 'active'
      GROUP BY u.id, u.name
      ORDER BY clients_no_recent_review DESC, upcoming DESC
    `,
  },

  blueprint_drop_off: {
    title: "Lead drop-off analysis",
    desc:
      "Where leads stall in the lead-to-client journey. Counts every lead that ever entered each stage and how many advanced past it — exposes the funnel's leakiest steps.",
    columns: [
      { key: "stage_name", label: "Stage" },
      { key: "entered", label: "Entered", format: "number" },
      { key: "exited", label: "Advanced", format: "number" },
      { key: "still_here", label: "Stuck", format: "number" },
      { key: "drop_off_pct", label: "Drop-off %", format: "number" },
      { key: "breach_pct", label: "SLA breach %", format: "number" },
      { key: "avg_hours_in_stage", label: "Avg hrs in stage", format: "number" },
    ],
    runSql: (sql) => sql`
      SELECT
        bs.stage_name,
        bs.stage_order,
        COUNT(lsh.id)::int AS entered,
        COUNT(lsh.id) FILTER (WHERE lsh.exited_at IS NOT NULL)::int AS exited,
        COUNT(lsh.id) FILTER (WHERE lsh.exited_at IS NULL)::int AS still_here,
        ROUND(
          100.0 * COUNT(lsh.id) FILTER (
            WHERE lsh.exited_at IS NULL AND lbi.status <> 'in_progress'
          ) / NULLIF(COUNT(lsh.id), 0),
        1) AS drop_off_pct,
        ROUND(
          100.0 * COUNT(lsh.id) FILTER (WHERE lsh.breached_sla)
          / NULLIF(COUNT(lsh.id), 0),
        1) AS breach_pct,
        ROUND(AVG(lsh.duration_seconds) / 3600.0, 1) AS avg_hours_in_stage
      FROM blueprint_stages bs
      LEFT JOIN lead_stage_history lsh ON lsh.stage_key = bs.stage_key
      LEFT JOIN lead_blueprint_instances lbi ON lbi.id = lsh.instance_id
      WHERE bs.blueprint_id IN (
        SELECT id FROM blueprint_definitions WHERE module_name = 'leads' AND is_active = true
      )
      GROUP BY bs.stage_key, bs.stage_name, bs.stage_order
      ORDER BY bs.stage_order
    `,
  },

  blueprint_delayed_leads: {
    title: "SLA-overdue leads",
    desc: "Lead-blueprint instances that have breached the current stage's SLA. Owner + RM should action these today.",
    columns: [
      { key: "name", label: "Lead" },
      { key: "stage_name", label: "Stage" },
      { key: "owner_role", label: "Owner role" },
      { key: "rm_name", label: "RM" },
      { key: "days_in_stage", label: "Days in stage", format: "number" },
      { key: "sla_days", label: "SLA (days)", format: "number" },
      { key: "overdue_days", label: "Overdue (days)", format: "number" },
    ],
    runSql: (sql) => sql`
      SELECT
        l.name,
        bs.stage_name,
        bs.owner_role,
        u.name AS rm_name,
        ROUND(EXTRACT(EPOCH FROM (now() - lbi.stage_entered_at)) / 86400.0, 1) AS days_in_stage,
        bs.sla_days,
        ROUND(EXTRACT(EPOCH FROM (now() - lbi.stage_entered_at)) / 86400.0 - bs.sla_days, 1) AS overdue_days
      FROM lead_blueprint_instances lbi
      JOIN leads l ON l.id = lbi.lead_id
      JOIN blueprint_stages bs ON bs.blueprint_id = lbi.blueprint_id AND bs.stage_key = lbi.current_stage_key
      LEFT JOIN users u ON u.id = l.owner_id
      WHERE lbi.status = 'in_progress'
        AND bs.sla_days IS NOT NULL
        AND lbi.stage_entered_at + (bs.sla_days || ' days')::interval < now()
      ORDER BY overdue_days DESC
      LIMIT 200
    `,
  },

  blueprint_pipeline_by_rm: {
    title: "RM-wise blueprint pipeline",
    desc:
      "For each RM: how many leads/clients sit in each phase of the Lead → Client SOP. Surfaces who has bandwidth and who's holding the line.",
    columns: [
      { key: "rm_name", label: "RM" },
      { key: "new_leads", label: "New", format: "number" },
      { key: "calling", label: "Calling", format: "number" },
      { key: "meeting_stage", label: "Meeting", format: "number" },
      { key: "won", label: "Won", format: "number" },
      { key: "onboarding", label: "Docs/KYC", format: "number" },
      { key: "activation", label: "UCC/Mandate/Txn", format: "number" },
      { key: "lost", label: "Lost", format: "number" },
      { key: "converted_30d", label: "Active 30d", format: "number" },
    ],
    // Stage keys mirror the 30-stage SOP in src/lib/blueprints/lead_to_client.ts.
    runSql: (sql) => sql`
      SELECT
        u.name AS rm_name,
        COUNT(lbi.id) FILTER (WHERE lbi.current_stage_key = 'new')::int AS new_leads,
        COUNT(lbi.id) FILTER (WHERE lbi.current_stage_key IN
          ('call_done','call_back_later','call_not_connected','contact_in_future'))::int AS calling,
        COUNT(lbi.id) FILTER (WHERE lbi.current_stage_key IN
          ('meeting_scheduled','meeting_pending','meeting_done'))::int AS meeting_stage,
        COUNT(lbi.id) FILTER (WHERE lbi.current_stage_key = 'won_lead')::int AS won,
        COUNT(lbi.id) FILTER (WHERE lbi.current_stage_key IN
          ('request_documents','documents_pending','documents_received',
           'kyc_validated','kyc_registered','kyc_pending','modify_kyc','physical_kyc','online_kyc'))::int AS onboarding,
        COUNT(lbi.id) FILTER (WHERE lbi.current_stage_key IN
          ('ucc_create','ucc_activated','mandate_create','mandate_activated','mandate_reject',
           'make_transaction','transaction_successful','transaction_failed','family_mapping','update_information'))::int AS activation,
        COUNT(lbi.id) FILTER (WHERE lbi.status = 'lost')::int AS lost,
        COUNT(lbi.id) FILTER (
          WHERE lbi.status = 'completed' AND lbi.completed_at >= now() - interval '30 days'
        )::int AS converted_30d
      FROM users u
      LEFT JOIN leads l ON l.owner_id = u.id
      LEFT JOIN lead_blueprint_instances lbi ON lbi.lead_id = l.id
      WHERE 'rm' = ANY(u.roles) AND u.status = 'active'
      GROUP BY u.id, u.name
      ORDER BY COUNT(lbi.id) DESC
    `,
  },

  blueprint_lost_reasons: {
    title: "Lead loss reasons",
    desc:
      "Why leads die — every lost lead grouped by the disposition that closed it, with the average time-to-loss. Answers \"why are we losing leads?\".",
    columns: [
      { key: "reason", label: "Disposition / reason" },
      { key: "leads", label: "Leads lost", format: "number" },
      { key: "share_pct", label: "Share %", format: "number" },
      { key: "avg_days_to_lose", label: "Avg days to loss", format: "number" },
    ],
    runSql: (sql) => sql`
      WITH lost AS (
        SELECT COALESCE(NULLIF(lsh.transition_name, 'system'), 'Unspecified') AS reason,
               EXTRACT(EPOCH FROM (lsh.entered_at - lbi.started_at)) / 86400.0 AS days_to_lose
        FROM lead_blueprint_instances lbi
        JOIN lead_stage_history lsh
          ON lsh.instance_id = lbi.id
         AND lsh.stage_key = lbi.current_stage_key
         AND lsh.exited_at IS NULL
        WHERE lbi.status = 'lost'
      )
      SELECT reason,
             COUNT(*)::int AS leads,
             ROUND(100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0), 1) AS share_pct,
             ROUND(AVG(days_to_lose)::numeric, 1) AS avg_days_to_lose
      FROM lost
      GROUP BY reason
      ORDER BY leads DESC
    `,
  },

  rm_pending: {
    title: "RM-wise pending work",
    desc:
      "What's on each RM's plate right now: open tasks (with overdue split), open SRs, pending proposals, and SIP rejections awaiting recovery.",
    columns: [
      { key: "rm_name", label: "RM" },
      { key: "open_tasks", label: "Open tasks", format: "number" },
      { key: "overdue_tasks", label: "Overdue", format: "number" },
      { key: "open_srs", label: "Open SRs", format: "number" },
      { key: "breached_srs", label: "SR breached", format: "number" },
      { key: "pending_proposals", label: "Proposals out", format: "number" },
      { key: "sip_rejections_pending", label: "SIP recovery pending", format: "number" },
    ],
    runSql: (sql) => sql`
      SELECT
        u.name AS rm_name,
        (
          SELECT COUNT(*)::int FROM tasks t
          WHERE t.assignee_id = u.id AND t.status IN ('open','in_progress')
        ) AS open_tasks,
        (
          SELECT COUNT(*)::int FROM tasks t
          WHERE t.assignee_id = u.id AND t.status IN ('open','in_progress') AND t.due_at < now()
        ) AS overdue_tasks,
        (
          SELECT COUNT(*)::int FROM service_requests s
          WHERE s.assigned_to_user_id = u.id AND s.status IN ('open','in_progress','escalated','waiting_customer')
        ) AS open_srs,
        (
          SELECT COUNT(*)::int FROM service_requests s
          WHERE s.assigned_to_user_id = u.id
            AND s.status NOT IN ('resolved','closed')
            AND s.sla_resolution_at < now()
        ) AS breached_srs,
        (
          SELECT COUNT(*)::int FROM proposals p
          WHERE p.prepared_by_user_id = u.id AND p.status IN ('sent','viewed')
        ) AS pending_proposals,
        (
          SELECT COUNT(*)::int FROM sip_rejections r
          WHERE r.assigned_rm_id = u.id
            AND r.recovery_status IN ('pending','client_contacted','bank_issue','mandate_issue')
        ) AS sip_rejections_pending
      FROM users u
      WHERE 'rm' = ANY(u.roles) AND u.status = 'active'
      ORDER BY (
        (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.status IN ('open','in_progress'))
        + (SELECT COUNT(*) FROM service_requests s WHERE s.assigned_to_user_id = u.id AND s.status IN ('open','in_progress','escalated'))
      ) DESC
    `,
  },

  // ───────────────────────────────────────────────────────────────────────
  // Sales & Business / SIP / Team / Clients — additions
  // ───────────────────────────────────────────────────────────────────────

  aum_movement: {
    title: "AUM Movement",
    desc: "Monthly gross inflow, redemption outflow, and net business — last 12 months.",
    columns: [
      { key: "month", label: "Month" },
      { key: "inflow", label: "Inflow", format: "inr" },
      { key: "outflow", label: "Outflow", format: "inr" },
      { key: "net", label: "Net", format: "inr" },
    ],
    runSql: (sql) => sql`
      SELECT to_char(date_trunc('month', order_date), 'Mon YYYY') AS month,
        COALESCE(SUM(CASE WHEN direction = 'inflow' THEN amount::numeric ELSE 0 END), 0) AS inflow,
        COALESCE(SUM(CASE WHEN direction = 'outflow' THEN amount::numeric ELSE 0 END), 0) AS outflow,
        COALESCE(SUM(CASE WHEN direction = 'inflow' THEN amount::numeric ELSE -amount::numeric END), 0) AS net
      FROM transactions
      WHERE status IN ('successful', 'processed')
        AND order_date >= date_trunc('month', now()) - interval '11 months'
      GROUP BY date_trunc('month', order_date)
      ORDER BY date_trunc('month', order_date) DESC
    `,
  },

  sip_stopped: {
    title: "SIP Stopped This Month",
    desc: "SIPs stopped or rejected since the 1st of the current month — recovery candidates.",
    columns: [
      { key: "investor_name", label: "Investor" },
      { key: "scheme_name", label: "Scheme" },
      { key: "amc_name", label: "AMC" },
      { key: "amount", label: "Amount", format: "inr" },
      { key: "status", label: "Status" },
      { key: "updated_at", label: "When", format: "date" },
      { key: "rm_name", label: "RM" },
    ],
    runSql: (sql) => sql`
      SELECT i.name AS investor_name, s.scheme_name, s.amc_name, s.amount, s.status,
        s.updated_at, u.name AS rm_name
      FROM sips s
      LEFT JOIN investors i ON i.id = s.investor_id
      LEFT JOIN users u ON u.id = COALESCE(s.rm_id, i.rm_id)
      WHERE s.status IN ('stopped', 'rejected')
        AND s.updated_at >= date_trunc('month', now())
      ORDER BY s.updated_at DESC LIMIT 500
    `,
  },

  branch_business: {
    title: "Branch-wise Business",
    desc: "Clients, AUM and SIP book per branch.",
    columns: [
      { key: "branch_name", label: "Branch" },
      { key: "clients", label: "Clients", format: "number" },
      { key: "aum", label: "AUM", format: "inr" },
      { key: "sip_book", label: "SIP book", format: "inr" },
    ],
    runSql: (sql) => sql`
      SELECT COALESCE(b.name, '— Unassigned —') AS branch_name,
        COUNT(i.id)::int AS clients,
        COALESCE(SUM(i.aum::numeric), 0) AS aum,
        COALESCE(SUM(i.active_sip_amount::numeric), 0) AS sip_book
      FROM investors i
      LEFT JOIN branches b ON b.id = i.branch_id
      WHERE i.status = 'active' AND i.deleted_at IS NULL
      GROUP BY b.id, b.name
      ORDER BY aum DESC
    `,
  },

  team_productivity: {
    title: "Team Productivity",
    desc: "Per team member: open tasks, tasks completed (30d), review meetings done (30d), and leads owned.",
    columns: [
      { key: "name", label: "Member" },
      { key: "department", label: "Dept" },
      { key: "open_tasks", label: "Open tasks", format: "number" },
      { key: "completed_30d", label: "Completed 30d", format: "number" },
      { key: "meetings_30d", label: "Meetings 30d", format: "number" },
      { key: "leads_owned", label: "Leads owned", format: "number" },
    ],
    runSql: (sql) => sql`
      SELECT u.name, COALESCE(u.department, '—') AS department,
        COUNT(t.id) FILTER (WHERE t.status IN ('open','in_progress'))::int AS open_tasks,
        COUNT(t.id) FILTER (WHERE t.status = 'completed' AND t.completed_at >= now() - interval '30 days')::int AS completed_30d,
        (SELECT COUNT(*)::int FROM review_meetings m
           WHERE m.rm_id = u.id AND m.status = 'completed' AND m.meeting_date >= now() - interval '30 days') AS meetings_30d,
        (SELECT COUNT(*)::int FROM leads l WHERE l.owner_id = u.id) AS leads_owned
      FROM users u
      LEFT JOIN tasks t ON t.assignee_id = u.id
      WHERE u.status = 'active'
      GROUP BY u.id, u.name, u.department
      ORDER BY completed_30d DESC, open_tasks DESC
    `,
  },

  segmentation: {
    title: "Client Segmentation",
    desc: "Client count, AUM and SIP book by segment (HNI / Affluent / Retail / …).",
    columns: [
      { key: "segment", label: "Segment" },
      { key: "clients", label: "Clients", format: "number" },
      { key: "aum", label: "AUM", format: "inr" },
      { key: "avg_aum", label: "Avg AUM", format: "inr" },
      { key: "sip_book", label: "SIP book", format: "inr" },
    ],
    runSql: (sql) => sql`
      SELECT COALESCE(segment_tag, 'Unclassified') AS segment,
        COUNT(*)::int AS clients,
        COALESCE(SUM(aum::numeric), 0) AS aum,
        COALESCE(AVG(aum::numeric), 0) AS avg_aum,
        COALESCE(SUM(active_sip_amount::numeric), 0) AS sip_book
      FROM investors
      WHERE status = 'active' AND deleted_at IS NULL
      GROUP BY segment_tag
      ORDER BY aum DESC
    `,
  },
};

export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const report = REPORTS[key];
  if (!report) notFound();

  const session = await requireSession();
  // Every report here is FIRM-WIDE by construction — a whole-book roll-up with
  // no per-owner filter. This page had no capability check at all, so any
  // logged-in RM could open one (or guess a /dashboard/reports/<key> URL) and
  // read the entire firm's client list, AUM and pipeline. Limited to the roles
  // that are supposed to see firm-level MIS; an RM's own numbers live on their
  // dashboard and in the walled module lists.
  requireAny(
    session.roles,
    ["reports.business", "reports.manage", "reports.commission", "investor.view.all"],
    session.permissions
  );
  const rows = await withTenant(session.tenantId, async (tx) => {
    const r = await tx.execute(report.runSql(sql));
    return r.rows as any[];
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <Link href="/dashboard/reports" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to reports
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="size-5" /> {report.title}
          </h1>
          <p className="text-muted-foreground text-sm">{report.desc}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{rows.length} rows</span>
          <ReportExportButtons
            rows={JSON.parse(JSON.stringify(rows))}
            columns={report.columns.map((c) => ({ key: c.key, label: c.label }))}
            filename={key}
          />
        </div>
      </div>

      <div className="border rounded-lg bg-card">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">No data for this report.</div>
        ) : (
          <div className="max-h-[65vh] overflow-auto scrollbar-none rounded-lg">
            <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
              <tr>
                {report.columns.map((c) => (
                  <th key={c.key} className={`px-4 py-2 font-medium ${c.format === "inr" || c.format === "number" ? "text-right" : "text-left"}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-accent/40">
                  {report.columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-4 py-2 ${
                        c.format === "inr" || c.format === "number" ? "text-right tabular-nums" : "text-left"
                      }`}
                    >
                      {formatCell(r[c.key], c.format)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function formatCell(v: any, fmt?: "inr" | "date" | "number"): string {
  if (v === null || v === undefined) return "—";
  if (fmt === "inr") return formatINR(Number(v));
  if (fmt === "date") return formatDate(v as any);
  if (fmt === "number") return Number(v).toLocaleString("en-IN");
  return String(v);
}
