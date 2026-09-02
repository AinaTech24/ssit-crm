import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { Repeat, FileDown, ArrowDownToLine, TrendingUp, AlertCircle, FileUp } from "lucide-react";
import { withTenant } from "@/db/client";
import { transactions, investors, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatINR, formatDate } from "@/lib/utils";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { ColumnManager } from "@/components/common/ColumnManager";
import { buildTransactionConditions } from "@/lib/transactions/list-filters";

const TRANSACTIONS_COLUMNS = [
  { key: "date", label: "Date", required: true },
  { key: "investor", label: "Investor", required: true },
  { key: "folio", label: "Folio" },
  { key: "scheme", label: "AMC / Scheme" },
  { key: "category", label: "Category", defaultHidden: true },
  { key: "type", label: "Type" },
  { key: "amount", label: "Amount" },
  { key: "units", label: "Units", defaultHidden: true },
  { key: "nav", label: "NAV", defaultHidden: true },
  { key: "status", label: "Status" },
  { key: "source", label: "Source", defaultHidden: true },
  { key: "rm", label: "RM" },
  { key: "remarks", label: "Remarks", defaultHidden: true },
];

/** Spec § Module 9 — visual chip palette */
const TYPE_TONE: Record<string, string> = {
  purchase: "bg-emerald-50 text-emerald-700",
  lumpsum: "bg-emerald-50 text-emerald-700",
  redemption: "bg-rose-50 text-rose-700",
  switch: "bg-purple-50 text-purple-700",
  sip: "bg-blue-50 text-blue-700",
  sip_stop: "bg-brand-cyan-light/50 text-brand-cyan-deep",
  sip_pause: "bg-amber-50 text-amber-700",
  stp: "bg-cyan-50 text-cyan-700",
  swp: "bg-teal-50 text-teal-700",
  dividend_payout: "bg-teal-50 text-teal-700",
  dividend_reinvest: "bg-cyan-50 text-cyan-700",
};

const TYPE_LABEL: Record<string, string> = {
  purchase: "Purchase",
  lumpsum: "Purchase",
  redemption: "Redemption",
  switch: "Switch",
  sip: "SIP",
  sip_stop: "SIP Stop",
  sip_pause: "SIP Pause",
  stp: "STP",
  swp: "SWP",
  dividend_payout: "Div Payout",
  dividend_reinvest: "Div Reinvest",
};

const STATUS_TONE: Record<string, string> = {
  processed: "bg-emerald-50 text-emerald-700",
  successful: "bg-emerald-50 text-emerald-700",
  pending: "bg-amber-50 text-amber-700",
  submitted: "bg-blue-50 text-blue-700",
  rejected: "bg-rose-50 text-rose-700",
  failed: "bg-rose-50 text-rose-700",
  cancelled: "bg-gray-50 text-gray-700",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  processed: "Processed",
  successful: "Processed",
  submitted: "Pending",
  rejected: "Rejected",
  failed: "Rejected",
  cancelled: "Cancelled",
};

const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual",
  cams: "CAMS",
  kfintech: "KFintech",
  nse: "NSE",
  bse: "BSE",
  mfu: "MFU",
  other: "Other",
  import: "Import",
};

export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const dateFrom = sp.date_from ?? "";
  const dateTo = sp.date_to ?? "";
  const cursor = sp.cursor;

  // Shared filter conditions (search / type / status / date / RM / AMC / source)
  // — identical to the KPI cards and the Excel export, so all three agree.
  const baseConds = buildTransactionConditions(sp);
  const conds = [...baseConds];

  if (cursor) {
    const [cursorOrderDate, cursorCreatedMs, cursorId] = cursor.split(":");
    if (cursorCreatedMs && cursorId) {
      conds.push(
        sql`(COALESCE(${transactions.orderDate}, '1970-01-01'::date), ${transactions.createdAt}, ${transactions.id}) < (${cursorOrderDate === "null" ? "1970-01-01" : cursorOrderDate}::date, ${new Date(Number(cursorCreatedMs)).toISOString()}::timestamp, ${cursorId}::uuid)`
      );
    }
  }

  const data = await withTenant(session.tenantId, async (tx) => {
    // KPI cards reflect the CURRENT filter selection (period-aware) — picking a
    // date range / type / RM updates the headline totals too, and each card
    // links into the rows behind it.
    const statWhere = baseConds.length ? (sql.join(baseConds, sql` AND `) as any) : undefined;
    const statRows = await tx
      .select({
        inflowCount: sql<number>`COUNT(*) FILTER (WHERE ${transactions.direction}='inflow' AND ${transactions.status} IN ('successful','processed'))::int`,
        inflowAmt: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.direction}='inflow' AND ${transactions.status} IN ('successful','processed') THEN ${transactions.amount}::numeric ELSE 0 END),0)`,
        outflowAmt: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.direction}='outflow' AND ${transactions.status} IN ('successful','processed') THEN ${transactions.amount}::numeric ELSE 0 END),0)`,
        rejectedCount: sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} IN ('rejected','failed'))::int`,
        total: sql<number>`COUNT(*)::int`,
      })
      .from(transactions)
      .leftJoin(investors, eq(investors.id, transactions.investorId))
      .where(statWhere);
    const s = statRows[0] as any;

    const baseQ = tx
      .select({ tx: transactions, investorName: investors.name, rmName: users.name })
      .from(transactions)
      .leftJoin(investors, eq(investors.id, transactions.investorId))
      .leftJoin(users, eq(users.id, transactions.executedByUserId));
    const rows = conds.length
      ? await baseQ
        .where(sql.join(conds, sql` AND `) as any)
        .orderBy(desc(transactions.orderDate), desc(transactions.createdAt), desc(transactions.id))
        .limit(51)
      : await baseQ
        .orderBy(desc(transactions.orderDate), desc(transactions.createdAt), desc(transactions.id))
        .limit(51);

    const hasMore = rows.length > 50;
    const displayRows = hasMore ? rows.slice(0, 50) : rows;
    const lastRow = displayRows[displayRows.length - 1];
    const nextCursor = lastRow
      ? `${lastRow.tx.orderDate ?? "null"}:${lastRow.tx.createdAt.getTime()}:${lastRow.tx.id}`
      : "";

    // RM roster + AMC list for the filter dropdowns.
    const rmRows = await tx.execute(
      sql`SELECT id, name FROM users WHERE tenant_id = ${session.tenantId}::uuid AND status='active' ORDER BY name ASC`
    );
    const amcRows = await tx.execute(
      sql`SELECT amc_name, count(*) AS c FROM transactions WHERE tenant_id = ${session.tenantId}::uuid AND amc_name IS NOT NULL AND amc_name <> '' GROUP BY amc_name ORDER BY c DESC LIMIT 60`
    );

    return {
      inflowCount: Number(s.inflowCount),
      inflowAmt: Number(s.inflowAmt),
      outflowAmt: Number(s.outflowAmt),
      rejectedCount: Number(s.rejectedCount),
      total: Number(s.total),
      displayRows,
      hasMore,
      nextCursor,
      rms: rmRows.rows as any[],
      amcs: amcRows.rows as any[],
    };
  });

  const netFlow = data.inflowAmt - data.outflowAmt;
  const pageAmt = data.displayRows.reduce((n, r) => n + (r.tx.amount != null ? Number(r.tx.amount) : 0), 0);

  // Preserve the active filters when building card / export links.
  const filterEntries = Object.entries(sp).filter(
    ([k, v]) => typeof v === "string" && v && k !== "cursor"
  ) as [string, string][];
  const carry = (extra: Record<string, string>) => {
    const p = new URLSearchParams(filterEntries);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/dashboard/transactions?${p.toString()}`;
  };
  const exportHref = `/api/transactions/export?${new URLSearchParams(filterEntries).toString()}`;
  const periodLabel = dateFrom || dateTo ? `${dateFrom || "start"} → ${dateTo || "today"}` : "all dates";

  const rmOptions = (data.rms ?? []).map((r: any) => ({ value: String(r.id), label: r.name ?? "—" }));
  const amcOptions = (data.amcs ?? []).map((r: any) => ({ value: String(r.amc_name), label: String(r.amc_name) }));
  const sourceOptions = [
    { value: "cams", label: "CAMS" },
    { value: "kfintech", label: "KFintech" },
    { value: "manual", label: "Manual" },
    { value: "import", label: "Import" },
    { value: "nse", label: "NSE" },
    { value: "bse", label: "BSE" },
    { value: "mfu", label: "MFU" },
    { value: "other", label: "Other" },
  ];

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Repeat className="size-6 text-brand-cyan" /> MF Transactions
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <a href={exportHref} className="btn-secondary" title="Download the filtered list as Excel">
            <FileUp className="size-4" /> Export
          </a>
          <Link href="/dashboard/transactions/import" className="btn-secondary">
            <FileDown className="size-4" /> Import Excel
          </Link>
        </div>
      </div>

      <CompactFilterBar
        totalCount={data.total}
        filters={[
          { type: "search", key: "q", placeholder: "Search scheme, client, or folio…" },
          {
            type: "multi",
            key: "txtype",
            label: "Type",
            options: [
              { value: "lumpsum", label: "Purchase (Lumpsum)" },
              { value: "sip", label: "SIP" },
              { value: "redemption", label: "Redemption" },
              { value: "switch", label: "Switch" },
              { value: "sip_pause", label: "SIP Pause" },
              { value: "sip_stop", label: "SIP Stop" },
              { value: "stp", label: "STP" },
              { value: "swp", label: "SWP" },
              { value: "dividend", label: "Dividend" },
            ],
          },
          {
            type: "multi",
            key: "status",
            label: "Status",
            options: [
              { value: "processed", label: "Processed" },
              { value: "pending", label: "Pending" },
              { value: "rejected", label: "Rejected" },
              { value: "cancelled", label: "Cancelled" },
            ],
          },
          { type: "date_range", key: "date", label: "Order date" },
          ...(rmOptions.length ? [{ type: "multi" as const, key: "rm", label: "RM", options: rmOptions }] : []),
          ...(amcOptions.length ? [{ type: "multi" as const, key: "amc", label: "AMC", options: amcOptions }] : []),
          { type: "multi" as const, key: "source", label: "Source", options: sourceOptions },
        ]}
        rightSlot={
          <div className="flex items-center gap-2">
            <ColumnManager moduleKey="transactions" columns={TRANSACTIONS_COLUMNS} />
            <CustomViews
              viewsKey="views:transactions"
              presets={[
                { id: "sip", name: "SIPs only", params: "txtype=sip" },
                { id: "rejected-30d", name: "Rejected (30 d)", params: "status=rejected" },
                { id: "purchases-mtd", name: "Purchases", params: "txtype=sip,lumpsum&status=successful,processed" },
                { id: "redemptions", name: "Redemptions", params: "txtype=redemption" },
              ]}
            />
          </div>
        }
      />

      <div className="card-surface">
        {data.displayRows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <Repeat className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2 font-medium">No transactions yet.</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              Transactions flow in automatically from CAMS + KFintech feeds once configured.
              You can also import manually via Excel.
            </p>
          </div>
        ) : (
          <>
            <div className="table-scroll">
              <table className="w-full text-sm" data-table="transactions">
                <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
                  <tr>
                    <th data-col="date" className="text-left px-4 py-2 font-medium">Date</th>
                    <th data-col="investor" className="text-left py-2 font-medium">Investor</th>
                    <th data-col="folio" className="text-left py-2 font-medium">Folio</th>
                    <th data-col="scheme" className="text-left py-2 font-medium">AMC / Scheme</th>
                    <th data-col="category" className="text-left py-2 font-medium">Category</th>
                    <th data-col="type" className="text-left py-2 font-medium">Type</th>
                    <th data-col="amount" className="text-right py-2 font-medium">Amount</th>
                    <th data-col="units" className="text-right py-2 font-medium">Units</th>
                    <th data-col="nav" className="text-right py-2 font-medium">NAV</th>
                    <th data-col="status" className="text-left py-2 font-medium">Status</th>
                    <th data-col="source" className="text-left py-2 font-medium">Source</th>
                    <th data-col="rm" className="text-left py-2 font-medium">RM</th>
                    <th data-col="remarks" className="text-left py-2 font-medium pr-4">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {data.displayRows.map(({ tx: t, investorName, rmName }) => (
                    <tr key={t.id} className="border-b last:border-0 hover:bg-secondary/40">
                      <td data-col="date" className="px-4 py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                        {t.orderDate ? formatDate(t.orderDate) : "—"}
                      </td>
                      <td data-col="investor" className="py-3 whitespace-nowrap">
                        {investorName ? (
                          <Link href={`/dashboard/investors/${t.investorId}`} className="hover:underline">
                            {investorName}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td data-col="folio" className="py-3 text-xs font-mono text-muted-foreground whitespace-nowrap">
                        {t.folioNumber ?? "—"}
                      </td>
                      <td data-col="scheme" className="py-3 max-w-[220px]">
                        <div className="text-sm truncate">{t.schemeName ?? t.schemeCode ?? "—"}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {t.amcName ?? t.amcCode ?? "—"}
                        </div>
                      </td>
                      <td data-col="category" className="py-3 text-xs text-muted-foreground capitalize">
                        {t.schemeCategory ?? "—"}
                      </td>
                      <td data-col="type" className="py-3">
                        <span className={`chip ${TYPE_TONE[t.type] ?? ""} font-medium`}>
                          {TYPE_LABEL[t.type] ?? t.type}
                        </span>
                      </td>
                      <td data-col="amount" className="py-3 text-right tabular-nums">
                        {t.amount != null ? formatINR(Number(t.amount)) : "—"}
                      </td>
                      <td data-col="units" className="py-3 text-right tabular-nums text-muted-foreground">
                        {t.units ? Number(t.units).toFixed(2) : "—"}
                      </td>
                      <td data-col="nav" className="py-3 text-right tabular-nums text-muted-foreground">
                        {t.nav ? Number(t.nav).toFixed(4) : "—"}
                      </td>
                      <td data-col="status" className="py-3">
                        <span className={`chip ${STATUS_TONE[t.status] ?? ""}`}>
                          {STATUS_LABEL[t.status] ?? t.status}
                        </span>
                      </td>
                      <td data-col="source" className="py-3 text-xs text-muted-foreground">
                        {SOURCE_LABEL[t.sourceFeed ?? ""] ?? t.sourceFeed ?? "—"}
                      </td>
                      <td data-col="rm" className="py-3 text-xs">{rmName ?? "—"}</td>
                      <td data-col="remarks" className="py-3 pr-4 text-xs text-muted-foreground max-w-[180px] truncate">
                        {t.remarks ?? t.reasonDescription ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t bg-secondary/30 text-xs font-medium sticky bottom-0">
                  <tr>
                    <td data-col="date" className="px-4 py-2 text-muted-foreground" colSpan={6}>
                      {data.displayRows.length} on this page{data.total > data.displayRows.length ? ` of ${data.total} matching` : ""}
                    </td>
                    <td data-col="amount" className="py-2 text-right tabular-nums">{formatINR(pageAmt)}</td>
                    <td colSpan={6} />
                  </tr>
                </tfoot>
              </table>
            </div>
            {data.hasMore && (
              <div className="p-4 border-t flex justify-end">
                <Link
                  href={{
                    pathname: "/dashboard/transactions",
                    query: {
                      ...Object.fromEntries(filterEntries),
                      cursor: data.nextCursor,
                    },
                  }}
                  className="rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
                >
                  Next Page →
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
  icon: Icon,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "rose" | "amber" | "emerald" | "muted";
  icon?: any;
  href?: string;
}) {
  const color =
    tone === "rose"
      ? "text-rose-600"
      : tone === "amber"
        ? "text-amber-600"
        : tone === "emerald"
          ? "text-emerald-600"
          : "text-foreground";
  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        {Icon && <Icon className="size-3.5 text-muted-foreground" />}
      </div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </>
  );
  if (href) {
    return (
      <Link href={href} className="card-surface p-4 block transition-colors hover:bg-secondary/40 hover:border-brand-cyan/40">
        {inner}
      </Link>
    );
  }
  return <div className="card-surface p-4">{inner}</div>;
}
