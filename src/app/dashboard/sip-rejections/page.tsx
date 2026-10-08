import Link from "next/link";
import { sql } from "drizzle-orm";
import { clientBookSql } from "@/lib/investors/access";
import { XOctagon, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatINR } from "@/lib/utils";
import { SipRejectionsTable } from "@/components/sip-rejections/SipRejectionsTable";
import { NewSipRejectionButton } from "@/components/sip-rejections/NewSipRejectionButton";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { dateRangeCond, dateRangeFilter } from "@/lib/filters/date-range";
import { CustomViews } from "@/components/common/CustomViews";
import { ColumnManager } from "@/components/common/ColumnManager";
import { ModuleTabs, SIP_TABS } from "@/components/common/ModuleTabs";

const SIP_REJ_COLUMNS = [
  { key: "rejected_on", label: "Rejected on", required: true },
  { key: "investor", label: "Investor", required: true },
  { key: "sip", label: "SIP details" },
  { key: "amount", label: "Amount" },
  { key: "reason", label: "Reason" },
  { key: "rm", label: "RM", defaultHidden: true },
  { key: "follow_up", label: "Follow-up" },
  { key: "recovery_date", label: "Recovery date", defaultHidden: true },
  { key: "recovery_status", label: "Recovery status" },
  { key: "remarks", label: "Remarks" },
];

export const dynamic = "force-dynamic";

export default async function SipRejectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const recoveryFilter = (sp.recovery ?? "").split(",").filter(Boolean);
  const reasonCat = (sp.reason_cat ?? "").trim();
  const overdueOnly = sp.overdue === "1";
  const mtdOnly = sp.mtd === "1";

  const data = await withTenant(session.tenantId, async (tx) => {
    const filters: any[] = [];
    if (q) {
      filters.push(
        sql`(i.name ILIKE ${`%${q}%`} OR r.scheme_name ILIKE ${`%${q}%`} OR r.amc_name ILIKE ${`%${q}%`} OR r.folio_number ILIKE ${`%${q}%`} OR r.rejection_reason ILIKE ${`%${q}%`})`
      );
    }
    if (recoveryFilter.length) {
      filters.push(
        sql`r.recovery_status IN (${sql.join(recoveryFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (reasonCat) {
      filters.push(sql`r.reason_category = ${reasonCat}`);
    }
    if (overdueOnly) {
      filters.push(
        sql`((now() - r.status_changed_at) > interval '2 days' AND r.recovery_status IN ('pending','client_contacted','bank_issue','mandate_issue'))`
      );
    }
    if (mtdOnly) {
      filters.push(sql`r.rejection_date >= date_trunc('month', now())`);
    }
    const dr = dateRangeCond(sp, "rej", "r.rejection_date");
    if (dr) filters.push(dr);
    // Limited to the user's client books, when they have any.
    filters.push(await clientBookSql(tx, session, "r.investor_id"));
    const whereSql = filters.length ? sql` WHERE ${sql.join(filters, sql` AND `)}` : sql``;

    const rows = await tx.execute(sql`
      SELECT r.id, r.investor_id, r.rejection_date, r.rejection_amount,
             r.rejection_reason, r.reason_category, r.scheme_name, r.folio_number, r.amc_name,
             r.assigned_rm_id, r.follow_up_date, r.recovery_date,
             r.recovery_status, r.status_changed_at, r.remarks, r.created_at,
             i.name AS investor_name, i.pan AS investor_pan,
             u.name AS rm_name,
             ((now() - r.status_changed_at) > interval '2 days'
               AND r.recovery_status IN ('pending','client_contacted','bank_issue','mandate_issue'))
               AS escalation_overdue
      FROM sip_rejections r
      LEFT JOIN investors i ON i.id = r.investor_id
      LEFT JOIN users u ON u.id = r.assigned_rm_id
      ${whereSql}
      ORDER BY r.rejection_date DESC, r.created_at DESC
      LIMIT 200
    `);

    const stats = await tx.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE recovery_status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE recovery_status IN ('client_contacted','bank_issue','mandate_issue','reprocessed'))::int AS in_progress,
        COUNT(*) FILTER (WHERE recovery_status = 'recovered')::int AS recovered,
        COUNT(*) FILTER (WHERE recovery_status = 'not_recoverable')::int AS lost,
        COUNT(*) FILTER (WHERE (now() - status_changed_at) > interval '2 days'
          AND recovery_status IN ('pending','client_contacted','bank_issue','mandate_issue'))::int AS overdue,
        COUNT(*) FILTER (WHERE rejection_date >= date_trunc('month', now()))::int AS rejected_mtd,
        COALESCE(SUM(CASE WHEN rejection_date >= date_trunc('month', now())
          THEN rejection_amount::numeric ELSE 0 END), 0)::numeric AS rejected_amt_mtd,
        COALESCE(SUM(CASE WHEN recovery_status = 'recovered'
          AND recovery_date >= date_trunc('month', now())
          THEN rejection_amount::numeric ELSE 0 END), 0)::numeric AS recovered_amt_mtd,
        -- Reason mix (open items only — what's actionable right now)
        COUNT(*) FILTER (WHERE reason_category = 'insufficient_balance'
          AND recovery_status IN ('pending','client_contacted','bank_issue','mandate_issue'))::int AS rc_balance,
        COUNT(*) FILTER (WHERE reason_category = 'mandate_expired'
          AND recovery_status IN ('pending','client_contacted','bank_issue','mandate_issue'))::int AS rc_mandate,
        COUNT(*) FILTER (WHERE reason_category = 'technical'
          AND recovery_status IN ('pending','client_contacted','bank_issue','mandate_issue'))::int AS rc_technical,
        -- Aging buckets (open items, by how long since the status last moved)
        COUNT(*) FILTER (WHERE recovery_status IN ('pending','client_contacted','bank_issue','mandate_issue')
          AND (now() - status_changed_at) <= interval '2 days')::int AS age_0_2,
        COUNT(*) FILTER (WHERE recovery_status IN ('pending','client_contacted','bank_issue','mandate_issue')
          AND (now() - status_changed_at) > interval '2 days'
          AND (now() - status_changed_at) <= interval '7 days')::int AS age_3_7,
        COUNT(*) FILTER (WHERE recovery_status IN ('pending','client_contacted','bank_issue','mandate_issue')
          AND (now() - status_changed_at) > interval '7 days')::int AS age_7p
      FROM sip_rejections
      WHERE tenant_id = ${session.tenantId}::uuid
        AND ${await clientBookSql(tx, session, "sip_rejections.investor_id")}
    `);
    const s = stats.rows[0] as any;

    // Per-RM accountability — who's sitting on open / overdue recoveries.
    const byRm = await tx.execute(sql`
      SELECT COALESCE(u.name, '— Unassigned —') AS rm_name,
             COUNT(*)::int AS open_count,
             COUNT(*) FILTER (WHERE (now() - r.status_changed_at) > interval '2 days')::int AS overdue_count,
             COALESCE(SUM(r.rejection_amount::numeric), 0)::numeric AS open_amt
      FROM sip_rejections r
      LEFT JOIN users u ON u.id = r.assigned_rm_id
      WHERE r.tenant_id = ${session.tenantId}::uuid
        AND ${await clientBookSql(tx, session, "r.investor_id")}
        AND r.recovery_status IN ('pending','client_contacted','bank_issue','mandate_issue')
      GROUP BY COALESCE(u.name, '— Unassigned —')
      ORDER BY overdue_count DESC, open_count DESC
      LIMIT 12
    `);
    const recoveryRate =
      Number(s.rejected_amt_mtd) > 0
        ? (Number(s.recovered_amt_mtd) / Number(s.rejected_amt_mtd)) * 100
        : 0;

    return {
      total: Number(s.total),
      pending: Number(s.pending),
      inProgress: Number(s.in_progress),
      recovered: Number(s.recovered),
      lost: Number(s.lost),
      overdue: Number(s.overdue),
      rejectedMtd: Number(s.rejected_mtd),
      rejectedAmtMtd: Number(s.rejected_amt_mtd),
      recoveredAmtMtd: Number(s.recovered_amt_mtd),
      recoveryRate,
      reasonMix: {
        insufficient_balance: Number(s.rc_balance),
        mandate_expired: Number(s.rc_mandate),
        technical: Number(s.rc_technical),
      },
      aging: { a0_2: Number(s.age_0_2), a3_7: Number(s.age_3_7), a7p: Number(s.age_7p) },
      byRm: byRm.rows as any[],
      rows: rows.rows as any[],
    };
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <XOctagon className="size-6 text-brand-cyan" /> SIP Rejections
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <NewSipRejectionButton />
          <Link href="/dashboard/reports/sip_recovery_monthly" className="btn-secondary text-xs">
            Monthly recovery report →
          </Link>
        </div>
      </div>

      <ModuleTabs tabs={SIP_TABS} />

      <div className="grid grid-cols-6 gap-3">
        <Stat icon={AlertTriangle} label="Total" value={data.total} />
        <Stat icon={Clock} label="Pending" value={data.pending} tone={data.pending > 0 ? "amber" : "muted"} />
        <Stat icon={Clock} label="In progress" value={data.inProgress} />
        <Stat
          icon={AlertTriangle}
          label="SLA breached (>2d)"
          value={data.overdue}
          tone={data.overdue > 0 ? "rose" : "muted"}
        />
        <Stat icon={CheckCircle2} label="Recovered" value={data.recovered} tone="emerald" />
        <Stat
          label="Recovery rate MTD"
          value={`${data.recoveryRate.toFixed(0)}%`}
          tone={data.recoveryRate >= 60 ? "emerald" : data.recoveryRate >= 30 ? "amber" : "rose"}
        />
      </div>

      <div className="card-surface p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Recovery summary — this month</h3>
          <span className="text-xs text-muted-foreground">
            {data.rejectedMtd} rejections · {formatINR(data.rejectedAmtMtd)} value
          </span>
        </div>
        <div className="h-3 bg-rose-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${Math.min(100, data.recoveryRate)}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="text-emerald-700 font-medium">
            Recovered {formatINR(data.recoveredAmtMtd)}
          </span>
          <span className="text-rose-700">
            Outstanding {formatINR(data.rejectedAmtMtd - data.recoveredAmtMtd)}
          </span>
        </div>
      </div>

      {/* Reason mix · aging · per-RM accountability */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="card-surface p-5">
          <h3 className="font-semibold text-sm mb-3">Why SIPs are bouncing <span className="text-xs font-normal text-muted-foreground">(open)</span></h3>
          <div className="space-y-1.5">
            <ReasonRow label="Mandate expired" hint="Re-register NACH" value={data.reasonMix.mandate_expired} cat="mandate_expired" active={reasonCat} tone="orange" />
            <ReasonRow label="Insufficient balance" hint="Nudge the client" value={data.reasonMix.insufficient_balance} cat="insufficient_balance" active={reasonCat} tone="amber" />
            <ReasonRow label="Technical" hint="Auto-retry next cycle" value={data.reasonMix.technical} cat="technical" active={reasonCat} tone="slate" />
          </div>
          {reasonCat && (
            <Link href="/dashboard/sip-rejections" className="text-[11px] text-brand-cyan hover:underline mt-2 inline-block">
              Clear reason filter
            </Link>
          )}
        </div>

        <div className="card-surface p-5">
          <h3 className="font-semibold text-sm mb-3">Recovery aging <span className="text-xs font-normal text-muted-foreground">(open items)</span></h3>
          <div className="grid grid-cols-3 gap-2 text-center">
            <AgeBucket label="0–2 days" value={data.aging.a0_2} tone="emerald" />
            <AgeBucket label="3–7 days" value={data.aging.a3_7} tone="amber" />
            <AgeBucket label="> 7 days" value={data.aging.a7p} tone="rose" />
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">
            Past 2 days breaches SLA — the daily scanner pings the RM &amp; branch head and bumps the task to urgent.
          </p>
        </div>

        <div className="card-surface p-5">
          <h3 className="font-semibold text-sm mb-3">Open recoveries by RM</h3>
          {data.byRm.length === 0 ? (
            <p className="text-xs text-muted-foreground">No open recoveries. ✓</p>
          ) : (
            <ul className="space-y-1.5 text-sm max-h-44 overflow-y-auto pr-1">
              {data.byRm.map((r: any) => (
                <li key={r.rm_name} className="flex items-center justify-between gap-2">
                  <span className="truncate">{r.rm_name}</span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {Number(r.overdue_count) > 0 && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700">
                        {r.overdue_count} overdue
                      </span>
                    )}
                    <span className="text-xs font-bold tabular-nums px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground min-w-[1.6rem] text-center">
                      {r.open_count}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <CompactFilterBar
        totalCount={data.rows.length}
        filters={[
          { type: "search", key: "q", placeholder: "Search by investor, scheme, AMC, reason…" },
          {
            type: "multi",
            key: "recovery",
            label: "Recovery status",
            options: [
              { value: "pending", label: "Pending" },
              { value: "client_contacted", label: "Client contacted" },
              { value: "bank_issue", label: "Bank issue" },
              { value: "mandate_issue", label: "Mandate issue" },
              { value: "reprocessed", label: "Reprocessed" },
              { value: "recovered", label: "Recovered" },
              { value: "not_recoverable", label: "Not recoverable" },
            ],
          },
          dateRangeFilter("rej", "Rejected"),
        ]}
        rightSlot={
          <div className="flex items-center gap-2">
            <ColumnManager moduleKey="sip-rejections" columns={SIP_REJ_COLUMNS} />
            <CustomViews
              viewsKey="views:sip-rejections"
              presets={[
                { id: "open", name: "Open (recovery pending)", params: "recovery=pending,client_contacted,bank_issue,mandate_issue" },
                { id: "breached", name: "SLA breached (>2d)", params: "overdue=1" },
                { id: "recovered", name: "Recovered", params: "recovery=recovered" },
                { id: "this-month", name: "Rejected this month", params: "mtd=1" },
              ]}
            />
          </div>
        }
      />

      <SipRejectionsTable rows={data.rows as any} />
    </div>
  );
}

function ReasonRow({
  label,
  hint,
  value,
  cat,
  active,
  tone,
}: {
  label: string;
  hint: string;
  value: number;
  cat: string;
  active: string;
  tone: "orange" | "amber" | "slate";
}) {
  const dot =
    tone === "orange" ? "bg-brand-cyan" : tone === "amber" ? "bg-amber-500" : "bg-slate-400";
  const isActive = active === cat;
  return (
    <Link
      href={`/dashboard/sip-rejections?reason_cat=${cat}`}
      className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors ${isActive ? "border-brand-cyan bg-brand-cyan-light/40" : "border-transparent hover:bg-secondary/60"
        }`}
    >
      <span className="flex items-center gap-2 min-w-0">
        <span className={`size-2 rounded-full shrink-0 ${dot}`} />
        <span className="truncate">{label}</span>
        <span className="text-[11px] text-muted-foreground truncate hidden sm:inline">· {hint}</span>
      </span>
      <span className="text-sm font-bold tabular-nums shrink-0">{value}</span>
    </Link>
  );
}

function AgeBucket({ label, value, tone }: { label: string; value: number; tone: "emerald" | "amber" | "rose" }) {
  const color =
    tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-rose-600";
  return (
    <div className="rounded-md bg-secondary/40 py-2">
      <div className={`text-xl font-bold tabular-nums ${value > 0 ? color : "text-muted-foreground"}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
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
  value: number | string;
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
