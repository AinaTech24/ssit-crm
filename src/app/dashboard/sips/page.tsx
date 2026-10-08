import Link from "next/link";
import { clientBookSql } from "@/lib/investors/access";
import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { TrendingUp, AlertTriangle, CheckCircle2, Calendar, ShieldAlert, Plus } from "lucide-react";
import { withTenant } from "@/db/client";
import { sips, investors, mandates, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { formatINR, formatDate } from "@/lib/utils";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { dateRangeCond, dateRangeFilter } from "@/lib/filters/date-range";
import { CustomViews } from "@/components/common/CustomViews";
import { ColumnManager } from "@/components/common/ColumnManager";
import { Pager } from "@/components/common/Pager";
import { ModuleTabs, SIP_TABS } from "@/components/common/ModuleTabs";

const SIPS_COLUMNS = [
  { key: "investor", label: "Investor", required: true },
  { key: "folio", label: "Folio", defaultHidden: true },
  { key: "scheme", label: "AMC / Scheme" },
  { key: "amount", label: "Amount" },
  { key: "frequency", label: "Frequency" },
  { key: "start", label: "Start date", defaultHidden: true },
  { key: "end", label: "End date", defaultHidden: true },
  { key: "next_due", label: "Next due" },
  { key: "mandate", label: "Mandate", defaultHidden: true },
  { key: "status", label: "Status" },
  { key: "rm", label: "RM" },
  { key: "remarks", label: "Remarks", defaultHidden: true },
];

/** Spec § Module 10 — visual palette */
const STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  paused: "bg-amber-50 text-amber-700",
  stopped: "bg-rose-50 text-rose-700",
  rejected: "bg-rose-50 text-rose-700",
  completed: "bg-blue-50 text-blue-700",
  pending: "bg-amber-50 text-amber-700",
  expired: "bg-brand-cyan-light/50 text-brand-cyan-deep",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  stopped: "Stopped",
  rejected: "Rejected",
  completed: "Completed",
  pending: "Pending",
  expired: "Completed", // legacy → display as Completed per spec
};

const FREQ_LABEL: Record<string, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  yearly: "Yearly",
};

export const dynamic = "force-dynamic";

export default async function SipsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  // SIPs are transaction data — require the view cap (the page had no gate) and
  // scope non-managers to their own book.
  requireCap(session.roles, "transactions.view", session.permissions);
  const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "reports.business", session.permissions);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const statusFilterRaw = (sp.status ?? "").split(",").filter(Boolean);
  const freqFilter = (sp.frequency ?? "").split(",").filter(Boolean);
  const PAGE_SIZE = 50;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  // Map status to cover both completed and expired (defense against mismatch)
  const statusFilter: string[] = [];
  for (const s of statusFilterRaw) {
    if (s === "completed" || s === "expired") {
      statusFilter.push("completed", "expired");
    } else {
      statusFilter.push(s);
    }
  }

  const data = await withTenant(session.tenantId, async (tx) => {
    // Own-book slice for non-managers: SIPs they own OR for a client they manage.
    const statsScope = seesAll
      ? sql``
      : sql` AND (rm_id = ${session.userId}::uuid OR investor_id IN (SELECT id FROM investors WHERE rm_id = ${session.userId}::uuid))`;
    const stats = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active')::int AS active_sips,
        COALESCE(SUM(CASE WHEN status = 'active' THEN amount::numeric ELSE 0 END), 0) AS active_amount,
        COUNT(*) FILTER (WHERE status = 'active' AND created_at >= date_trunc('month', now()))::int AS added_mtd,
        COUNT(*) FILTER (WHERE status IN ('stopped', 'rejected') AND updated_at >= date_trunc('month', now()))::int AS lost_mtd,
        COUNT(*) FILTER (WHERE status = 'active' AND end_date IS NOT NULL
          AND end_date <= current_date + interval '90 days')::int AS expiring_soon
      FROM sips
      WHERE tenant_id = ${session.tenantId}::uuid
        AND investor_id IN (SELECT id FROM investors WHERE deleted_at IS NULL)${statsScope}
        AND ${await clientBookSql(tx, session, "sips.investor_id")}
    `);
    const s = stats.rows[0] as any;

    const conds: any[] = [];
    // Exclude SIPs whose client is soft-deleted (in Trash) — they were showing
    // here with investor links that 404'd on the deleted client.
    conds.push(isNull(investors.deletedAt));
    conds.push(await clientBookSql(tx, session, "sips.investor_id"));
    if (!seesAll) conds.push(or(eq(sips.rmId, session.userId), eq(investors.rmId, session.userId))!);
    if (q) {
      conds.push(
        or(
          ilike(sips.schemeName, `%${q}%`),
          ilike(sips.amcName, `%${q}%`),
          ilike(sips.folioNumber, `%${q}%`),
          ilike(investors.name, `%${q}%`)
        )!
      );
    }
    if (statusFilter.length) conds.push(inArray(sips.status, statusFilter as any));
    if (freqFilter.length) conds.push(inArray(sips.frequency, freqFilter as any));
    const dr = dateRangeCond(sp, "created", "sips.created_at");
    if (dr) conds.push(dr);
    const where = conds.length ? and(...conds) : undefined;

    const rowsQuery = tx
      .select({
        s: sips,
        investorName: investors.name,
        investorRmId: investors.rmId,
        mandateRef: mandates.mandateRefNo,
        mandateStatus: mandates.status,
        rmName: users.name,
      })
      .from(sips)
      .leftJoin(investors, eq(investors.id, sips.investorId))
      .leftJoin(mandates, eq(mandates.id, sips.mandateId))
      .leftJoin(users, eq(users.id, sips.rmId));
    const rows = await rowsQuery
      .where(where as any)
      .orderBy(desc(sips.updatedAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);

    // True count of the filtered set (drives the pager + accurate header count).
    const cnt = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(sips)
      .leftJoin(investors, eq(investors.id, sips.investorId))
      .where(where as any);

    return {
      activeSips: Number(s.active_sips),
      activeAmount: Number(s.active_amount),
      addedMtd: Number(s.added_mtd),
      lostMtd: Number(s.lost_mtd),
      expiringSoon: Number(s.expiring_soon),
      rows,
      filteredTotal: Number(cnt[0]?.c ?? 0),
    };
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <TrendingUp className="size-6 text-brand-cyan" /> SIP Book
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {can(session.roles, "transactions.execute", session.permissions) && (
            <Link href="/dashboard/sips/new" className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus className="size-4" /> Add SIP
            </Link>
          )}
          <Link href="/dashboard/sips/new-watch" className="btn-secondary text-sm inline-flex items-center gap-1.5">
            <ShieldAlert className="size-4" /> SIP payment watch
          </Link>
        </div>
      </div>

      <ModuleTabs tabs={SIP_TABS} />

      <div className="grid grid-cols-5 gap-3">
        <Stat icon={CheckCircle2} label="Active SIPs" value={String(data.activeSips)} tone="emerald" />
        <Stat icon={TrendingUp} label="Active book / mo" value={formatINR(data.activeAmount)} />
        <Stat icon={TrendingUp} label="Added MTD" value={String(data.addedMtd)} tone={data.addedMtd > 0 ? "emerald" : "muted"} />
        <Stat icon={AlertTriangle} label="Stopped MTD" value={String(data.lostMtd)} tone={data.lostMtd > 0 ? "rose" : "muted"} />
        <Stat icon={Calendar} label="Expiring (90d)" value={String(data.expiringSoon)} tone={data.expiringSoon > 0 ? "amber" : "muted"} />
      </div>

      <CompactFilterBar
        totalCount={data.filteredTotal}
        filters={[
          { type: "search", key: "q", placeholder: "Search by scheme, AMC, folio, investor…" },
          {
            type: "multi",
            key: "status",
            label: "Status",
            options: [
              { value: "active", label: "Active" },
              { value: "paused", label: "Paused" },
              { value: "stopped", label: "Stopped" },
              { value: "rejected", label: "Rejected" },
              { value: "completed", label: "Completed" },
              { value: "pending", label: "Pending" },
              { value: "expired", label: "Expired" },
            ],
          },
          {
            type: "multi",
            key: "frequency",
            label: "Frequency",
            options: [
              { value: "monthly", label: "Monthly" },
              { value: "quarterly", label: "Quarterly" },
              { value: "weekly", label: "Weekly" },
              { value: "fortnightly", label: "Fortnightly" },
              { value: "yearly", label: "Yearly" },
            ],
          },
          dateRangeFilter("created", "Started"),
        ]}
        rightSlot={
          <div className="flex items-center gap-2">
            <ColumnManager moduleKey="sips" columns={SIPS_COLUMNS} />
            <CustomViews
              viewsKey="views:sips"
              presets={[
                { id: "active", name: "Active SIPs", params: "status=active" },
                { id: "stopped", name: "Stopped / Rejected", params: "status=stopped,rejected" },
                { id: "monthly", name: "Monthly SIPs", params: "frequency=monthly&status=active" },
                { id: "paused", name: "Paused", params: "status=paused" },
              ]}
            />
          </div>
        }
      />

      <div className="card-surface">
        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <TrendingUp className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2 font-medium">No SIPs yet.</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              SIPs flow in from AMC feeds (CAMS / KFintech) once registered. Imports populate from Excel too.
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm" data-table="sips">
              <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
                <tr>
                  <th data-col="investor" className="text-left px-4 py-2 font-medium">Investor</th>
                  <th data-col="folio" className="text-left py-2 font-medium">Folio</th>
                  <th data-col="scheme" className="text-left py-2 font-medium">AMC / Scheme</th>
                  <th data-col="amount" className="text-right py-2 font-medium">Amount</th>
                  <th data-col="frequency" className="text-left py-2 font-medium">Frequency</th>
                  <th data-col="start" className="text-left py-2 font-medium">Start</th>
                  <th data-col="end" className="text-left py-2 font-medium">End</th>
                  <th data-col="next_due" className="text-left py-2 font-medium">Next due</th>
                  <th data-col="mandate" className="text-left py-2 font-medium">Mandate</th>
                  <th data-col="status" className="text-left py-2 font-medium">Status</th>
                  <th data-col="rm" className="text-left py-2 font-medium">RM</th>
                  <th data-col="remarks" className="text-left py-2 font-medium pr-4">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(({ s: sip, investorName, mandateRef, mandateStatus, rmName }) => (
                  <tr key={sip.id} className="border-b last:border-0 hover:bg-secondary/40">
                    <td data-col="investor" className="px-4 py-3 whitespace-nowrap">
                      {investorName ? (
                        <Link href={`/dashboard/investors/${sip.investorId}`} className="hover:underline">
                          {investorName}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td data-col="folio" className="py-3 text-xs font-mono text-muted-foreground whitespace-nowrap">
                      {sip.folioNumber ?? "—"}
                    </td>
                    <td data-col="scheme" className="py-3 max-w-[220px]">
                      <div className="text-sm truncate">{sip.schemeName ?? sip.schemeCode ?? "—"}</div>
                      <div className="text-xs text-muted-foreground truncate">{sip.amcName ?? sip.amcCode ?? "—"}</div>
                    </td>
                    <td data-col="amount" className="py-3 text-right tabular-nums">{formatINR(Number(sip.amount))}</td>
                    <td data-col="frequency" className="py-3 text-xs">
                      {FREQ_LABEL[sip.frequency] ?? sip.frequency}
                      {sip.sipDate && <span className="text-muted-foreground"> · day {sip.sipDate}</span>}
                    </td>
                    <td data-col="start" className="py-3 text-xs text-muted-foreground tabular-nums">
                      {sip.startDate ? formatDate(sip.startDate) : "—"}
                    </td>
                    <td data-col="end" className="py-3 text-xs text-muted-foreground tabular-nums">
                      {sip.endDate ? formatDate(sip.endDate) : "—"}
                    </td>
                    <td data-col="next_due" className="py-3 text-xs tabular-nums">
                      {sip.nextInstallmentAt ? formatDate(sip.nextInstallmentAt) : "—"}
                    </td>
                    <td data-col="mandate" className="py-3 text-xs">
                      {mandateRef ? (
                        <div>
                          <div className="font-mono text-muted-foreground truncate max-w-[100px]">{mandateRef}</div>
                          <span
                            className={`text-[10px] ${mandateStatus === "active" ? "text-emerald-600" : "text-rose-600"
                              }`}
                          >
                            {mandateStatus ?? "—"}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td data-col="status" className="py-3">
                      <span className={`chip ${STATUS_TONE[sip.status] ?? ""}`}>
                        {STATUS_LABEL[sip.status] ?? sip.status}
                      </span>
                    </td>
                    <td data-col="rm" className="py-3 text-xs">{rmName ?? "—"}</td>
                    <td data-col="remarks" className="py-3 pr-4 text-xs text-muted-foreground max-w-[160px] truncate">
                      {sip.remarks ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        {Icon && <Icon className="size-3.5 text-muted-foreground" />}
      </div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
