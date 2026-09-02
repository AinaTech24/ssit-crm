import Link from "next/link";
import { sql } from "drizzle-orm";
import { CalendarClock, AlertTriangle, IndianRupee, ShieldAlert, Shield } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { formatDate, formatINR } from "@/lib/utils";
import { StatusChips, type StatusChip } from "@/components/common/StatusChips";
import { ContactQuickActions } from "@/components/common/ContactQuickActions";
import { RenewAction } from "@/components/insurance/RenewAction";
import { ModuleTabs, INSURANCE_TABS } from "@/components/common/ModuleTabs";

export const dynamic = "force-dynamic";

const BUCKETS = ["overdue", "this_week", "next_30", "lapsing"] as const;
type Bucket = (typeof BUCKETS)[number];
const BUCKET_SQL: Record<Bucket, ReturnType<typeof sql>> = {
  overdue: sql`p.next_premium_due_date < current_date AND p.next_premium_due_date >= current_date - COALESCE(p.grace_period_days, 30)`,
  this_week: sql`p.next_premium_due_date BETWEEN current_date AND current_date + 7`,
  next_30: sql`p.next_premium_due_date BETWEEN current_date + 8 AND current_date + 30`,
  lapsing: sql`p.next_premium_due_date < current_date - COALESCE(p.grace_period_days, 30)`,
};
const BUCKET_LABEL: Record<Bucket, string> = { overdue: "Overdue (in grace)", this_week: "Due this week", next_30: "Due in 30 days", lapsing: "Lapsing (past grace)" };

export default async function RenewalsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  requireCap(session.roles, "insurance.view", session.permissions);
  const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);
  // Marking a policy renewed is a write — gate it honestly (was `… || true`,
  // which made everyone a "manager").
  const canManage = can(session.roles, "insurance.write", session.permissions);
  const sp = await searchParams;
  const bucket = (BUCKETS as readonly string[]).includes(sp.bucket ?? "") ? (sp.bucket as Bucket) : "this_week";

  const data = await withTenant(session.tenantId, async (tx) => {
    // Own-book slice for non-managers. The counts query has no investor join
    // (sub-select on investor_id); the rows query joins investors as `i`.
    const countScope = seesAll
      ? sql``
      : sql` AND (p.sold_by_user_id = ${session.userId}::uuid OR p.investor_id IN (SELECT id FROM investors WHERE rm_id = ${session.userId}::uuid))`;
    const rowScope = seesAll
      ? sql``
      : sql` AND (p.sold_by_user_id = ${session.userId}::uuid OR i.rm_id = ${session.userId}::uuid)`;
    const counts = (await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE ${BUCKET_SQL.overdue})::int AS overdue,
        COUNT(*) FILTER (WHERE ${BUCKET_SQL.this_week})::int AS this_week,
        COUNT(*) FILTER (WHERE ${BUCKET_SQL.next_30})::int AS next_30,
        COUNT(*) FILTER (WHERE ${BUCKET_SQL.lapsing})::int AS lapsing,
        COALESCE(SUM(p.annual_premium::numeric) FILTER (WHERE ${BUCKET_SQL.overdue} OR ${BUCKET_SQL.this_week} OR ${BUCKET_SQL.next_30}), 0)::numeric AS due_premium
      FROM insurance_policies p
      WHERE p.tenant_id = ${session.tenantId}::uuid AND p.status = 'active' AND p.next_premium_due_date IS NOT NULL${countScope}
    `)).rows[0] as any;

    const rows = (await tx.execute(sql`
      SELECT p.id, p.plan_name, p.insurer, p.policy_number, p.next_premium_due_date, p.annual_premium::numeric AS annual_premium,
             p.premium_frequency, p.grace_period_days, i.name AS client, i.phone, i.whatsapp_phone, i.email
      FROM insurance_policies p LEFT JOIN investors i ON i.id = p.investor_id
      WHERE p.tenant_id = ${session.tenantId}::uuid AND p.status = 'active' AND p.next_premium_due_date IS NOT NULL AND (${BUCKET_SQL[bucket]})${rowScope}
      ORDER BY p.next_premium_due_date ASC
      LIMIT 300
    `)).rows as any[];
    return { counts, rows };
  });

  const c = data.counts ?? {};
  const chips: StatusChip[] = [
    { value: "overdue", label: BUCKET_LABEL.overdue, count: Number(c.overdue ?? 0), tone: "rose" },
    { value: "this_week", label: BUCKET_LABEL.this_week, count: Number(c.this_week ?? 0), tone: "amber" },
    { value: "next_30", label: BUCKET_LABEL.next_30, count: Number(c.next_30 ?? 0), tone: "sky" },
    { value: "lapsing", label: BUCKET_LABEL.lapsing, count: Number(c.lapsing ?? 0), tone: "rose" },
  ];

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><CalendarClock className="size-6 text-brand-cyan" /> Insurance Renewals</h1>
        </div>
      </div>

      <ModuleTabs tabs={INSURANCE_TABS} />

      <StatusChips basePath="/dashboard/insurance/renewals" paramKey="bucket" current={bucket} params={sp} chips={chips} />

      <div className="card-surface table-scroll">
        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">No policies in “{BUCKET_LABEL[bucket]}”. 🎉</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Client</th>
                <th className="text-left py-2 font-medium">Policy</th>
                <th className="text-left py-2 font-medium">Due date</th>
                <th className="text-right py-2 font-medium">Premium</th>
                <th className="text-left py-2 font-medium pl-3">Freq</th>
                <th className="text-right py-2 font-medium pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((p) => {
                const overdue = p.next_premium_due_date && new Date(p.next_premium_due_date).getTime() < Date.now();
                const first = String(p.client ?? "").split(" ")[0];
                return (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-secondary/40">
                    <td className="px-4 py-2.5 font-medium">{p.client ?? "—"}</td>
                    <td className="py-2.5 text-xs"><div>{p.plan_name}</div><div className="text-[11px] text-muted-foreground">{p.insurer}{p.policy_number ? ` · ${p.policy_number}` : ""}</div></td>
                    <td className={`py-2.5 text-xs whitespace-nowrap ${overdue ? "text-rose-700 font-semibold" : ""}`}>{p.next_premium_due_date ? formatDate(p.next_premium_due_date) : "—"}</td>
                    <td className="py-2.5 text-right tabular-nums">{p.annual_premium ? formatINR(Number(p.annual_premium)) : "—"}</td>
                    <td className="py-2.5 text-xs capitalize pl-3">{String(p.premium_frequency).replace(/_/g, " ")}</td>
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <ContactQuickActions phone={p.whatsapp_phone || p.phone} email={p.email} message={`Dear ${first}, a gentle reminder that your ${p.insurer} policy premium is due on ${p.next_premium_due_date ? formatDate(p.next_premium_due_date) : "soon"}. Happy to help you pay it on time.`} subject="Premium renewal reminder" show={["whatsapp", "call"]} />
                        <RenewAction policyId={p.id} frequency={p.premium_frequency} nextDue={p.next_premium_due_date} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone?: "rose" | "amber" | "emerald" }) {
  const color = tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : tone === "emerald" ? "text-emerald-600" : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{label}</span><Icon className="size-3.5 text-muted-foreground" /></div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
