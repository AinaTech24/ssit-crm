import Link from "next/link";
import { sql } from "drizzle-orm";
import {
  Plus,
  Shield,
  Heart,
  Car,
  Plane,
  Home,
  Activity,
  AlertTriangle,
  IndianRupee,
  FileDown,
  CalendarClock,
} from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { formatDate, formatINR } from "@/lib/utils";
import { RowActions } from "@/components/common/RowActions";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { Avatar } from "@/components/ui/Avatar";
import { Pager } from "@/components/common/Pager";
import { StatusChips, type StatusChip as FilterChip } from "@/components/common/StatusChips";
import { StatusChip, type Tone } from "@/components/common/StatusChip";
import { ModuleTabs, INSURANCE_TABS } from "@/components/common/ModuleTabs";
import { dateRangeCond, dateRangeFilter } from "@/lib/filters/date-range";

const TYPE_LABEL: Record<string, string> = {
  term: "Term Life",
  ulip: "ULIP",
  endowment: "Endowment",
  money_back: "Money-back",
  health: "Health",
  critical_illness: "Critical Illness",
  personal_accident: "Personal Accident",
  motor: "Motor",
  travel: "Travel",
  home: "Home",
  life_other: "Life — Other",
  general_other: "General — Other",
};

const TYPE_ICON: Record<string, any> = {
  term: Shield,
  ulip: Activity,
  endowment: Activity,
  money_back: Activity,
  health: Heart,
  critical_illness: Heart,
  personal_accident: Heart,
  motor: Car,
  travel: Plane,
  home: Home,
  life_other: Shield,
  general_other: Shield,
};

const STATUS_TONE: Record<string, Tone> = {
  proposed: "info",
  in_underwriting: "warning",
  active: "success",
  lapsed: "danger",
  matured: "neutral",
  surrendered: "neutral",
  cancelled: "neutral",
  claim_filed: "warning",
  claim_settled: "info",
};

export const dynamic = "force-dynamic";

export default async function InsurancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  // Policies carry nominee PII, client PAN, premium + commission — require the
  // view capability (the page had NO gate) and scope non-managers to their own
  // book (a client they manage OR a policy they sold).
  requireCap(session.roles, "insurance.view", session.permissions);
  const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const typeFilter = (sp.type ?? "").split(",").filter(Boolean);
  const statusFilter = (sp.status ?? "").split(",").filter(Boolean);
  const freqFilter = (sp.frequency ?? "").split(",").filter(Boolean);
  const dueSoonOnly = sp.due === "1";
  const PAGE_SIZE = 50;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const data = await withTenant(session.tenantId, async (tx) => {
    // Owner slice for non-managers. The joined queries (rows/count) reference
    // the investor alias `i`; the bare aggregates (stats/statusCounts) use a
    // sub-select on investor_id.
    const filters: any[] = [];
    if (!seesAll) filters.push(sql`(p.sold_by_user_id = ${session.userId}::uuid OR i.rm_id = ${session.userId}::uuid)`);
    const bareScope = seesAll
      ? sql``
      : sql` WHERE (sold_by_user_id = ${session.userId}::uuid OR investor_id IN (SELECT id FROM investors WHERE rm_id = ${session.userId}::uuid))`;
    if (q) {
      filters.push(
        sql`(p.policy_number ILIKE ${`%${q}%`} OR p.plan_name ILIKE ${`%${q}%`} OR p.insurer ILIKE ${`%${q}%`} OR i.name ILIKE ${`%${q}%`})`
      );
    }
    if (typeFilter.length) {
      filters.push(
        sql`p.policy_type IN (${sql.join(typeFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (statusFilter.length) {
      filters.push(
        sql`p.status IN (${sql.join(statusFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (freqFilter.length) {
      filters.push(
        sql`p.premium_frequency IN (${sql.join(freqFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (dueSoonOnly) {
      filters.push(
        sql`(p.status = 'active' AND p.next_premium_due_date IS NOT NULL AND p.next_premium_due_date <= current_date + interval '30 days' AND p.next_premium_due_date >= current_date)`
      );
    }
    const dr = dateRangeCond(sp, "created", "p.created_at");
    if (dr) filters.push(dr);
    const whereSql = filters.length ? sql` WHERE ${sql.join(filters, sql` AND `)}` : sql``;

    const rows = await tx.execute(sql`
      SELECT p.id, p.policy_number, p.insurer, p.plan_name, p.policy_type,
             p.sum_assured::numeric AS sum_assured,
             p.annual_premium::numeric AS annual_premium,
             p.premium_frequency, p.policy_term_years,
             p.policy_start_date, p.maturity_date,
             p.next_premium_due_date, p.status,
             p.nominee_name, p.nominee_relation,
             p.lives_covered,
             i.name AS investor_name, i.pan AS investor_pan,
             i.id AS investor_id, i.avatar_url AS investor_avatar_url,
             p.created_at
      FROM insurance_policies p
      LEFT JOIN investors i ON i.id = p.investor_id
      ${whereSql}
      ORDER BY p.created_at DESC
      LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}
    `);
    // True count of the filtered set (drives the pager + accurate header count).
    const filtered = await tx.execute(sql`
      SELECT COUNT(*)::int AS c
      FROM insurance_policies p
      LEFT JOIN investors i ON i.id = p.investor_id
      ${whereSql}
    `);
    const stats = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active')::int AS active_count,
        COALESCE(
          SUM(sum_assured::numeric) FILTER (WHERE status = 'active'), 0
        )::numeric AS total_sum_assured,
        COALESCE(
          SUM(annual_premium::numeric) FILTER (WHERE status = 'active'), 0
        )::numeric AS annual_premium_book,
        COUNT(*) FILTER (
          WHERE status = 'active'
            AND next_premium_due_date IS NOT NULL
            AND next_premium_due_date <= current_date + interval '30 days'
            AND next_premium_due_date >= current_date
        )::int AS due_30d,
        COUNT(*) FILTER (WHERE status = 'lapsed')::int AS lapsed_count,
        COUNT(*) FILTER (WHERE policy_type = 'health')::int AS health_count,
        COUNT(*) FILTER (
          WHERE policy_type IN ('term', 'ulip', 'endowment', 'money_back', 'life_other')
        )::int AS life_count
      FROM insurance_policies${bareScope}
    `);
    const statusCounts = await tx.execute(sql`
      SELECT status, COUNT(*)::int AS c FROM insurance_policies${bareScope} GROUP BY status
    `);
    return {
      rows: rows.rows as any[],
      s: stats.rows[0] as any,
      filteredTotal: Number((filtered.rows[0] as any)?.c ?? 0),
      statusCounts: statusCounts.rows as Array<{ status: string; c: number }>,
    };
  });

  const countOf = (st: string) => data.statusCounts.find((r) => r.status === st)?.c ?? 0;
  const totalPolicies = data.statusCounts.reduce((a, r) => a + Number(r.c), 0);
  const STATUS_CHIP_TONE: Record<string, FilterChip["tone"]> = {
    active: "emerald", lapsed: "rose", proposed: "sky", in_underwriting: "amber",
    claim_filed: "amber", claim_settled: "sky", matured: "slate", surrendered: "slate", cancelled: "slate",
  };
  const statusChips: FilterChip[] = [
    { value: "", label: "All", count: totalPolicies, tone: "slate" },
    ...["active", "in_underwriting", "proposed", "lapsed", "claim_filed", "claim_settled", "matured", "surrendered", "cancelled"]
      .map((st) => ({ value: st, label: st.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()), count: countOf(st), tone: STATUS_CHIP_TONE[st] }))
      .filter((c) => c.count > 0 || c.value === "active"),
  ];

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">
            <Shield className="size-6 text-brand-cyan" /> Insurance Policies
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/insurance/import" className="btn-secondary"><FileDown className="size-4" /> Import</Link>
          <Link href="/dashboard/insurance/new" className="btn-primary">
            <Plus className="size-4" /> New policy
          </Link>
        </div>
      </div>

      <ModuleTabs tabs={INSURANCE_TABS} />

      <StatusChips basePath="/dashboard/insurance" paramKey="status" current={sp.status ?? ""} params={sp} chips={statusChips} />

      <CompactFilterBar
        totalCount={data.filteredTotal}
        filters={[
          { type: "search", key: "q", placeholder: "Search by policy no, plan, insurer, client…" },
          dateRangeFilter("created", "Added"),
          {
            type: "multi",
            key: "type",
            label: "Policy type",
            options: [
              { value: "term", label: "Term Life" },
              { value: "ulip", label: "ULIP" },
              { value: "endowment", label: "Endowment" },
              { value: "money_back", label: "Money-back" },
              { value: "health", label: "Health" },
              { value: "critical_illness", label: "Critical Illness" },
              { value: "personal_accident", label: "Personal Accident" },
              { value: "motor", label: "Motor" },
              { value: "travel", label: "Travel" },
              { value: "home", label: "Home" },
            ],
          },
          {
            type: "multi",
            key: "status",
            label: "Status",
            options: [
              { value: "proposed", label: "Proposed" },
              { value: "in_underwriting", label: "In underwriting" },
              { value: "active", label: "Active" },
              { value: "lapsed", label: "Lapsed" },
              { value: "matured", label: "Matured" },
              { value: "surrendered", label: "Surrendered" },
              { value: "cancelled", label: "Cancelled" },
              { value: "claim_filed", label: "Claim filed" },
              { value: "claim_settled", label: "Claim settled" },
            ],
          },
          {
            type: "multi",
            key: "frequency",
            label: "Frequency",
            options: [
              { value: "annual", label: "Annual" },
              { value: "semi_annual", label: "Semi-annual" },
              { value: "quarterly", label: "Quarterly" },
              { value: "monthly", label: "Monthly" },
              { value: "single", label: "Single-pay" },
            ],
          },
        ]}
        rightSlot={
          <CustomViews
            viewsKey="views:insurance"
            presets={[
              { id: "active", name: "Active policies", params: "status=active" },
              { id: "due-soon", name: "Premium due (30d)", params: "due=1" },
              { id: "lapsed", name: "Lapsed", params: "status=lapsed" },
              { id: "life", name: "Life policies", params: "type=term,ulip,endowment,money_back" },
              { id: "health", name: "Health policies", params: "type=health,critical_illness,personal_accident" },
            ]}
          />
        }
      />

      <div className="card-surface">
        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <Shield className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2 font-medium">No policies in the register yet.</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              Click <strong>New policy</strong> to record a Term / ULIP / Health / Motor policy that
              the client already owns. The register tracks sum assured, premium dates, and nominee
              details.
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Plan / Insurer</th>
                  <th className="text-left py-2 font-medium">Type</th>
                  <th className="text-left py-2 font-medium">Client</th>
                  <th className="text-right py-2 font-medium">Sum assured</th>
                  <th className="text-right py-2 font-medium">Premium</th>
                  <th className="text-left py-2 font-medium">Frequency</th>
                  <th className="text-left py-2 font-medium">Started</th>
                  <th className="text-left py-2 font-medium">Maturity</th>
                  <th className="text-left py-2 font-medium">Next due</th>
                  <th className="text-left py-2 font-medium">Nominee</th>
                  <th className="text-left py-2 font-medium">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((p) => {
                  const Icon = TYPE_ICON[p.policy_type] ?? Shield;
                  const dueSoon =
                    p.status === "active" &&
                    p.next_premium_due_date &&
                    new Date(p.next_premium_due_date).getTime() <
                    Date.now() + 30 * 24 * 60 * 60 * 1000;
                  return (
                    <tr
                      key={p.id}
                      className={`border-b last:border-0 hover:bg-secondary/40 ${dueSoon ? "bg-amber-50/30" : ""
                        }`}
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/dashboard/insurance/${p.id}`}
                          className="font-medium hover:underline"
                        >
                          {p.plan_name}
                        </Link>
                        <div className="text-[11px] text-muted-foreground">
                          {p.insurer}
                          {p.policy_number && (
                            <>
                              {" "}
                              · <span className="font-mono">{p.policy_number}</span>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-1.5 text-xs">
                          <Icon className="size-3.5 text-muted-foreground" />
                          <span>{TYPE_LABEL[p.policy_type] ?? p.policy_type}</span>
                        </div>
                        {p.lives_covered > 1 && (
                          <div className="text-[10px] text-muted-foreground">
                            {p.lives_covered} lives
                          </div>
                        )}
                      </td>
                      <td className="py-3 text-xs whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Avatar src={p.investor_avatar_url ? `/api/investors/${p.investor_id}/avatar` : null} name={p.investor_name} size={26} />
                          <div>
                            <div className="font-medium">{p.investor_name}</div>
                            <div className="text-[10px] text-muted-foreground font-mono">
                              {p.investor_pan}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {p.sum_assured ? formatINR(Number(p.sum_assured)) : "—"}
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {p.annual_premium ? formatINR(Number(p.annual_premium)) : "—"}
                      </td>
                      <td className="py-3 text-xs capitalize">
                        {String(p.premium_frequency).replace(/_/g, " ")}
                      </td>
                      <td className="py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                        {p.policy_start_date ? formatDate(p.policy_start_date) : "—"}
                      </td>
                      <td className="py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                        {p.maturity_date ? formatDate(p.maturity_date) : "—"}
                      </td>
                      <td className="py-3 text-xs whitespace-nowrap">
                        {p.next_premium_due_date ? (
                          <span
                            className={
                              dueSoon ? "text-amber-700 font-semibold" : "text-muted-foreground"
                            }
                          >
                            {formatDate(p.next_premium_due_date)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-3 text-xs whitespace-nowrap">
                        {p.nominee_name ? (
                          <div>
                            <div>{p.nominee_name}</div>
                            <div className="text-[10px] text-muted-foreground capitalize">
                              {p.nominee_relation ?? "—"}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-3">
                        <StatusChip tone={STATUS_TONE[p.status] ?? "neutral"} className="capitalize">
                          {p.status.replace(/_/g, " ")}
                        </StatusChip>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <RowActions
                          editHref={`/dashboard/insurance/new?edit=${p.id}`}
                          deleteUrl={`/api/insurance/${p.id}`}
                          itemLabel="policy"
                          itemName={p.plan_name}
                          verb="Cancel"
                        />
                      </td>
                    </tr>
                  );
                })}
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
  accent,
  icon: Icon,
}: {
  label: string;
  value: string;
  accent?: "rose" | "amber" | "emerald" | "muted" | "cyan";
  icon?: any;
}) {
  const color =
    accent === "rose"
      ? "text-rose-600"
      : accent === "amber"
        ? "text-amber-600"
        : accent === "emerald"
          ? "text-emerald-600"
          : "text-foreground";
  const bg: Record<string, string> = {
    cyan: "bg-brand-cyan-light text-brand-cyan-deep",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    rose: "bg-rose-50 text-rose-600",
    muted: "bg-secondary text-foreground",
  };
  return (
    <div className="kpi-card">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
          {label}
        </span>
        {Icon && (
          <div className={`size-7 rounded-lg grid place-items-center ${bg[accent ?? "muted"]}`}>
            <Icon className="size-3.5" />
          </div>
        )}
      </div>
      <div className={`text-2xl font-bold mt-2 tabular-nums tracking-tight ${color}`}>{value}</div>
    </div>
  );
}
