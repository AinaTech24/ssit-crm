import { sql } from "drizzle-orm";
import { Boxes, Star, CheckCircle2, Layers } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { SchemesCatalog } from "@/components/schemes/SchemesCatalog";
import { SyncSchemesButton } from "@/components/schemes/SyncSchemesButton";
import { Pager } from "@/components/common/Pager";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

const COARSE_OPTS = [
  { value: "equity", label: "Equity" }, { value: "hybrid", label: "Hybrid" }, { value: "debt", label: "Debt" },
  { value: "liquid", label: "Liquid" }, { value: "commodity", label: "Commodity" }, { value: "international", label: "International" }, { value: "other", label: "Other" },
];
const RISK_OPTS = ["very_low", "low", "moderate", "high", "very_high"].map((v) => ({ value: v, label: v.replace(/_/g, " ") }));

export default async function SchemesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const canManage = can(session.roles, "compliance.edit", (session as any).permissions);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const amc = (sp.amc ?? "").split(",").filter(Boolean);
  const coarse = (sp.coarse ?? "").split(",").filter(Boolean);
  const risk = (sp.risk ?? "").split(",").filter(Boolean);
  const shortlisted = sp.shortlisted === "1";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const data = await withTenant(session.tenantId, async (tx) => {
    const conds: any[] = [sql`s.tenant_id = ${session.tenantId}::uuid`];
    if (q) conds.push(sql`(s.scheme_name ILIKE ${`%${q}%`} OR s.scheme_code ILIKE ${`%${q}%`})`);
    if (amc.length) conds.push(sql`s.amc_code IN (${sql.join(amc.map((v) => sql`${v}`), sql`, `)})`);
    if (coarse.length) conds.push(sql`s.coarse_category IN (${sql.join(coarse.map((v) => sql`${v}`), sql`, `)})`);
    if (risk.length) conds.push(sql`s.risk_category IN (${sql.join(risk.map((v) => sql`${v}`), sql`, `)})`);
    if (shortlisted) conds.push(sql`s.is_shortlisted = true`);
    const whereSql = sql`WHERE ${sql.join(conds, sql` AND `)}`;

    // Whole (filtered) catalog is reachable via pagination — the old hard
    // LIMIT 300 made ~13.7k synced schemes invisible past the first page.
    const rows = await tx.execute(sql`
      SELECT s.id, s.amc_code, s.scheme_code, s.scheme_name, s.category, s.sub_category, s.coarse_category,
             s.plan, s.option, s.exit_load, s.risk_category, s.min_sip, s.min_investment,
             s.is_active, s.is_closed, s.is_shortlisted, s.shortlist_rationale, s.evaluation,
             am.name AS amc_name
      FROM scheme_master s
      LEFT JOIN amc_master am ON am.tenant_id = s.tenant_id AND am.code = s.amc_code
      ${whereSql}
      ORDER BY s.is_shortlisted DESC, s.scheme_name ASC
      LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}
    `);
    const filtered = await tx.execute(sql`SELECT COUNT(*)::int AS c FROM scheme_master s ${whereSql}`);

    const stats = await tx.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE is_shortlisted)::int AS shortlisted,
        COUNT(*) FILTER (WHERE is_active AND NOT COALESCE(is_closed, false))::int AS active,
        COUNT(*) FILTER (WHERE (evaluation->>'verdict') IS NOT NULL)::int AS evaluated
      FROM scheme_master WHERE tenant_id = ${session.tenantId}::uuid
    `);

    const amcs = await tx.execute(sql`SELECT code, name FROM amc_master WHERE tenant_id = ${session.tenantId}::uuid ORDER BY name`);
    return {
      rows: rows.rows as any[],
      stats: stats.rows[0] as any,
      amcs: amcs.rows as Array<{ code: string; name: string }>,
      filteredTotal: Number((filtered.rows[0] as any)?.c ?? 0),
    };
  });

  const s = data.stats;

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Boxes className="size-6 text-brand-cyan" /> Scheme Master
          </h1>
        </div>
        {canManage && <SyncSchemesButton />}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={Boxes} label="Schemes (total)" value={s.total ?? 0} />
        <Stat icon={Star} label="Shortlisted (buy-list)" value={s.shortlisted ?? 0} tone="amber" />
        <Stat icon={CheckCircle2} label="Active / open" value={s.active ?? 0} tone="emerald" />
        <Stat icon={Layers} label="IC-evaluated" value={s.evaluated ?? 0} />
      </div>

      <CompactFilterBar
        totalCount={data.filteredTotal}
        filters={[
          { type: "search", key: "q", placeholder: "Search by scheme name or code…" },
          { type: "multi", key: "amc", label: "AMC", options: data.amcs.map((a) => ({ value: a.code, label: a.name })) },
          { type: "multi", key: "coarse", label: "Category", options: COARSE_OPTS },
          { type: "multi", key: "risk", label: "Risk", options: RISK_OPTS },
          { type: "select", key: "shortlisted", label: "Shortlist", options: [{ value: "1", label: "Shortlisted only" }] },
        ]}
        rightSlot={
          <CustomViews
            viewsKey="views:schemes"
            presets={[
              { id: "shortlisted", name: "Shortlisted (buy-list)", params: "shortlisted=1" },
              { id: "equity", name: "Equity", params: "coarse=equity" },
              { id: "debt", name: "Debt", params: "coarse=debt" },
            ]}
          />
        }
      />

      <SchemesCatalog rows={data.rows} amcs={data.amcs} canManage={canManage} />

      <Pager
        page={page}
        totalPages={Math.ceil(data.filteredTotal / PAGE_SIZE)}
        total={data.filteredTotal}
        pageSize={PAGE_SIZE}
      />
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone?: "amber" | "emerald" }) {
  const color = tone === "amber" ? "text-amber-600" : tone === "emerald" ? "text-emerald-600" : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{label}</span><Icon className="size-3.5 text-muted-foreground" /></div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
