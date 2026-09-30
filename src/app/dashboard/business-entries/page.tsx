import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { Plus, Briefcase, LayoutDashboard, Droplets } from "lucide-react";
import { withTenant } from "@/db/client";
import { businessEntries, users, investors } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { formatINR } from "@/lib/utils";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { BusinessEntriesTable } from "@/components/business-entries/BusinessEntriesTable";
import { PRODUCT_TYPES, BUSINESS_ENTRY_STATUSES } from "@/db/schema/business_entries";

export const dynamic = "force-dynamic";

const MANAGE_ROLES = ["owner", "branch_head", "rm", "back_office", "ops"];

const PRODUCT_LABEL: Record<string, string> = {
  mutual_fund: "Mutual Fund", pms: "PMS", aif: "AIF", sif: "SIF", bond: "Bond", ncd: "NCD", other: "Other",
};
function fyStartISO(now = new Date()): string {
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; // FY = Apr–Mar
  return `${y}-04-01`;
}

export default async function BusinessEntriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  if (!session.roles.some((r) => MANAGE_ROLES.includes(r))) redirect("/dashboard");
  // RMs see only their own bookings + their own revenue KPIs; managers/ops see
  // the whole firm.
  const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "reports.business", session.permissions);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const statusFilter = (sp.status ?? "").split(",").filter(Boolean);
  const productFilter = (sp.productType ?? "").split(",").filter(Boolean);
  const rmFilter = (sp.rm ?? "").split(",").filter(Boolean);
  const from = sp.from;
  const to = sp.to;

  const { rows, kpi, rms } = await withTenant(session.tenantId, async (tx) => {
    const conds: any[] = [eq(businessEntries.tenantId, session.tenantId)];
    if (!seesAll) conds.push(eq(businessEntries.rmId, session.userId));
    if (q) conds.push(or(ilike(businessEntries.clientName, `%${q}%`), ilike(businessEntries.amcName, `%${q}%`))!);
    if (statusFilter.length) conds.push(inArray(businessEntries.status, statusFilter as any));
    if (productFilter.length) conds.push(inArray(businessEntries.productType, productFilter as any));
    if (rmFilter.length) conds.push(inArray(businessEntries.rmId, rmFilter as any));
    if (from) conds.push(gte(businessEntries.businessDate, from));
    if (to) conds.push(lte(businessEntries.businessDate, to));

    const rows = await tx
      .select({
        id: businessEntries.id,
        clientName: businessEntries.clientName,
        investorId: businessEntries.investorId,
        avatarUrl: investors.avatarUrl,
        // Surfaced in the list because booking business against a client whose
        // KYC has lapsed is exactly what gets caught at the AMC, after the fact.
        kycStatus: investors.kycStatus,
        productType: businessEntries.productType,
        businessDate: businessEntries.businessDate,
        status: businessEntries.status,
        totalAmount: businessEntries.totalAmount,
        rmName: users.name,
        lineCount: sql<number>`(SELECT count(*)::int FROM business_entry_lines l WHERE l.entry_id = ${businessEntries.id})`,
      })
      .from(businessEntries)
      .leftJoin(users, eq(users.id, businessEntries.rmId))
      .leftJoin(investors, eq(investors.id, businessEntries.investorId))
      .where(and(...conds))
      .orderBy(desc(businessEntries.businessDate), desc(businessEntries.createdAt))
      .limit(150);

    const kpiRes = await tx.execute(sql`
      SELECT
        COUNT(*)::int AS entries,
        COALESCE(SUM(total_amount) FILTER (WHERE business_date >= ${fyStartISO()}::date), 0)::numeric AS fy_gross,
        COALESCE(SUM(total_amount) FILTER (WHERE date_trunc('month', business_date) = date_trunc('month', current_date)), 0)::numeric AS mtd_gross
      FROM business_entries
      WHERE tenant_id = ${session.tenantId}::uuid AND status <> 'cancelled'${seesAll ? sql`` : sql` AND rm_id = ${session.userId}::uuid`}
    `);
    const kpi = (kpiRes.rows[0] as any) ?? { entries: 0, fy_gross: 0, mtd_gross: 0 };

    const rmRes = await tx.execute(sql`SELECT id, name FROM users WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' ORDER BY name ASC`);
    return { rows, kpi, rms: rmRes.rows as any[] };
  });

  const rmOptions = rms.map((r) => ({ value: String(r.id), label: r.name ?? "—" }));

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Briefcase className="size-6 text-brand-cyan" /> Transactions
          </h1>
          <p className="text-muted-foreground text-sm">
            Log booked business (MF / PMS / AIF / SIF…), email clients, and report.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/business-entries/dashboard" className="btn-secondary text-sm inline-flex items-center gap-1.5">
            <LayoutDashboard className="size-4" /> Dashboard
          </Link>
          <Link href="/dashboard/business-entries/liquid" className="btn-secondary text-sm inline-flex items-center gap-1.5">
            <Droplets className="size-4" /> Liquid report
          </Link>
          <Link href="/dashboard/business-entries/new" className="btn-primary text-sm inline-flex items-center gap-1.5">
            <Plus className="size-4" /> New entry
          </Link>
        </div>
      </div>

      <CompactFilterBar
        totalCount={rows.length}
        rightSlot={<CustomViews viewsKey="views:business-entries" />}
        filters={[
          { type: "search", key: "q", placeholder: "Search by client or AMC…" },
          { type: "multi", key: "status", label: "Status", options: BUSINESS_ENTRY_STATUSES.map((s) => ({ value: s, label: s })) },
          { type: "multi", key: "productType", label: "Product", options: PRODUCT_TYPES.map((p) => ({ value: p, label: PRODUCT_LABEL[p] ?? p })) },
          ...(rmOptions.length ? [{ type: "multi" as const, key: "rm", label: "RM", options: rmOptions }] : []),
        ]}
      />

      {rows.length === 0 ? (
        <div className="card-surface p-12 text-center text-sm text-muted-foreground">
          <Briefcase className="size-8 mx-auto text-muted-foreground/40" />
          <div className="mt-2 font-medium">No transactions yet.</div>
          <Link href="/dashboard/business-entries/new" className="text-brand-cyan hover:underline mt-2 inline-block">
            Log your first closing →
          </Link>
        </div>
      ) : (
        <div className="card-surface">
          <BusinessEntriesTable rows={rows as any} rmOptions={rmOptions} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "cyan" }) {
  return (
    <div className={`card-surface p-4 ${tone === "cyan" ? "bg-brand-cyan-light/30" : ""}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold mt-1 tabular-nums">{value}</div>
    </div>
  );
}
