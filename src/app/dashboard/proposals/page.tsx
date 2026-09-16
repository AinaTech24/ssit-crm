import Link from "next/link";
import { sql } from "drizzle-orm";
import {
  Plus,
  FileSignature,
  FileText,
  Send,
  CheckCircle2,
  IndianRupee,
  Clock,
} from "lucide-react";
import { withTenant } from "@/db/client";
import { dataScopeSqlFor } from "@/lib/auth/data-scope";
import { requireSession } from "@/lib/auth/session";
import { formatINR } from "@/lib/utils";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { dateRangeCond, dateRangeFilter } from "@/lib/filters/date-range";
import { CustomViews } from "@/components/common/CustomViews";
import { ColumnManager } from "@/components/common/ColumnManager";
import { Pager } from "@/components/common/Pager";
import { ProposalsBulkTable } from "@/components/proposals/ProposalsBulkTable";

const PROPOSALS_COLUMNS = [
  { key: "number", label: "Proposal number", required: true },
  { key: "title", label: "Title" },
  { key: "recipient", label: "Recipient", required: true },
  { key: "type", label: "Type" },
  { key: "invest", label: "Investment ₹" },
  { key: "corpus", label: "Expected corpus" },
  { key: "status", label: "Status" },
  { key: "valid_till", label: "Valid till" },
  { key: "prepared_by", label: "Prepared by", defaultHidden: true },
  { key: "created", label: "Created" },
  { key: "actions", label: "Actions", required: true },
];

export const dynamic = "force-dynamic";

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const statusFilter = (sp.status ?? "").split(",").filter(Boolean);
  const typeFilter = (sp.type ?? "").split(",").filter(Boolean);
  const riskFilter = (sp.risk ?? "").split(",").filter(Boolean);
  const PAGE_SIZE = 50;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  // Sort — by created date or investment amount, ascending or descending.
  const sortKey = (["created_desc", "created_asc", "invest_desc", "invest_asc"] as const).includes(
    (sp.sort ?? "") as any
  )
    ? (sp.sort as "created_desc" | "created_asc" | "invest_desc" | "invest_asc")
    : "created_desc";
  const orderSql =
    sortKey === "created_asc" ? sql`p.created_at ASC`
      : sortKey === "invest_desc" ? sql`p.total_investment::numeric DESC NULLS LAST`
        : sortKey === "invest_asc" ? sql`p.total_investment::numeric ASC NULLS LAST`
          : sql`p.created_at DESC`;

  const data = await withTenant(session.tenantId, async (tx) => {
    // The data wall: a proposal belongs to whoever prepared it.
    const filters: any[] = [
      await dataScopeSqlFor(tx, session, {
        branch: "p.branch_id",
        owner: "p.prepared_by_user_id",
      }),
    ];
    if (q) {
      filters.push(
        sql`(p.proposal_number ILIKE ${`%${q}%`} OR p.title ILIKE ${`%${q}%`} OR p.recipient_name ILIKE ${`%${q}%`})`
      );
    }
    if (statusFilter.length) {
      filters.push(
        sql`p.status IN (${sql.join(statusFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (typeFilter.length) {
      filters.push(
        sql`p.type IN (${sql.join(typeFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (riskFilter.length) {
      filters.push(
        sql`p.risk_rating IN (${sql.join(riskFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    const dr = dateRangeCond(sp, "created", "p.created_at");
    if (dr) filters.push(dr);
    const whereSql = filters.length ? sql` WHERE ${sql.join(filters, sql` AND `)}` : sql``;

    const rows = await tx.execute(sql`
      SELECT p.id, p.proposal_number, p.title, p.type, p.status,
             p.recipient_name, p.recipient_type, p.investor_id, p.lead_id,
             p.total_investment::numeric AS total_investment,
             p.expected_corpus::numeric AS expected_corpus,
             p.risk_rating, p.valid_until, p.sent_at, p.accepted_at,
             p.created_at,
             u.name AS prepared_by,
             i.avatar_url AS investor_avatar_url,
             l.avatar_url AS lead_avatar_url
      FROM proposals p
      LEFT JOIN users u ON u.id = p.prepared_by_user_id
      LEFT JOIN investors i ON i.id = p.investor_id
      LEFT JOIN leads l ON l.id = p.lead_id
      ${whereSql}
      ORDER BY ${orderSql}
      LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}
    `);
    // True count of the filtered set (drives the pager + accurate header count).
    const filtered = await tx.execute(sql`
      SELECT COUNT(*)::int AS c FROM proposals p ${whereSql}
    `);
    const stats = await tx.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status IN ('sent','viewed'))::int AS pending,
        COUNT(*) FILTER (WHERE status = 'accepted')::int AS accepted_total,
        COUNT(*) FILTER (
          WHERE status = 'accepted' AND accepted_at >= date_trunc('month', now())
        )::int AS accepted_mtd,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE status = 'accepted')
          / NULLIF(COUNT(*) FILTER (WHERE status IN ('sent','viewed','accepted','rejected')), 0),
        1) AS conv_pct,
        COALESCE(
          SUM(total_investment::numeric) FILTER (
            WHERE status IN ('sent','viewed')
          ), 0
        )::numeric AS outstanding_value
      FROM proposals
    `);
    return {
      rows: rows.rows as any[],
      s: stats.rows[0] as any,
      filteredTotal: Number((filtered.rows[0] as any)?.c ?? 0),
    };
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">
            <FileSignature className="size-6 text-brand-cyan" /> Proposals
          </h1>
        </div>
        <Link href="/dashboard/proposals/new" className="btn-primary">
          <Plus className="size-4" /> New proposal
        </Link>
      </div>

      <CompactFilterBar
        totalCount={data.filteredTotal}
        filters={[
          { type: "search", key: "q", placeholder: "Search by number, title, recipient…" },
          {
            type: "sort",
            key: "sort",
            label: "Sort",
            options: [
              { value: "created_desc", label: "Newest first" },
              { value: "created_asc", label: "Oldest first" },
              { value: "invest_desc", label: "Investment ₹ — high to low" },
              { value: "invest_asc", label: "Investment ₹ — low to high" },
            ],
          },
          {
            type: "multi",
            key: "status",
            label: "Status",
            options: [
              { value: "draft", label: "Draft" },
              { value: "ready", label: "Ready" },
              { value: "sent", label: "Sent" },
              { value: "viewed", label: "Viewed" },
              { value: "accepted", label: "Accepted" },
              { value: "rejected", label: "Rejected" },
              { value: "expired", label: "Expired" },
            ],
          },
          {
            type: "multi",
            key: "type",
            label: "Type",
            options: [
              { value: "comprehensive", label: "Comprehensive" },
              { value: "mutual_fund", label: "Mutual Fund" },
              { value: "insurance", label: "Insurance" },
              { value: "pms", label: "PMS" },
              { value: "aif", label: "AIF" },
              { value: "mixed", label: "Mixed" },
            ],
          },
          {
            type: "multi",
            key: "risk",
            label: "Risk rating",
            options: [
              { value: "conservative", label: "Conservative" },
              { value: "moderate", label: "Moderate" },
              { value: "aggressive", label: "Aggressive" },
            ],
          },
          dateRangeFilter("created", "Created"),
        ]}
        rightSlot={
          <div className="flex items-center gap-2">
            <ColumnManager moduleKey="proposals" columns={PROPOSALS_COLUMNS} />
            <CustomViews
              viewsKey="views:proposals"
              presets={[
                { id: "awaiting", name: "Awaiting client", params: "status=sent,viewed" },
                { id: "accepted", name: "Accepted", params: "status=accepted" },
                { id: "drafts", name: "My drafts", params: "status=draft,ready" },
                { id: "mf", name: "Mutual Fund only", params: "type=mutual_fund" },
              ]}
            />
          </div>
        }
      />

      <div className="card-surface">
        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <FileSignature className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2 font-medium">No proposals yet.</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              Click <strong>New proposal</strong> to build a branded MF / Insurance / PMS / AIF
              proposal you can download as a PDF and send to a client.
            </p>
          </div>
        ) : (
          <div>
            <ProposalsBulkTable rows={data.rows.map((r, i) => ({ ...r, _seq: (page - 1) * PAGE_SIZE + i + 1 }))} />
            <div className="px-4 pb-3">
              <Pager
                page={page}
                totalPages={Math.ceil(data.filteredTotal / PAGE_SIZE)}
                total={data.filteredTotal}
                pageSize={PAGE_SIZE}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  tone?: "rose" | "amber" | "emerald" | "muted";
  icon?: any;
}) {
  const color =
    tone === "rose"
      ? "text-rose-600"
      : tone === "amber"
        ? "text-amber-600"
        : tone === "emerald"
          ? "text-emerald-600"
          : "text-foreground";
  const iconBg =
    tone === "rose"
      ? "bg-rose-50 text-rose-600"
      : tone === "amber"
        ? "bg-amber-50 text-amber-600"
        : tone === "emerald"
          ? "bg-emerald-50 text-emerald-600"
          : "bg-brand-cyan-light text-brand-cyan-deep";
  return (
    <div className="kpi-card">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
          {label}
        </span>
        {Icon && (
          <div className={`size-7 rounded-lg grid place-items-center ${iconBg}`}>
            <Icon className="size-3.5" />
          </div>
        )}
      </div>
      <div className={`text-2xl font-bold mt-2 tabular-nums tracking-tight ${color}`}>
        {value}
      </div>
    </div>
  );
}
