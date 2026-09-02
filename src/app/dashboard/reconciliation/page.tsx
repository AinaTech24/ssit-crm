import Link from "next/link";
import { sql } from "drizzle-orm";
import { Scale } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatINR } from "@/lib/utils";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { RunReconButton } from "@/components/reconciliation/ReconActions";
import { ReconTable } from "@/components/reconciliation/ReconTable";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const statusFilter = (sp.status ?? "open,investigating").split(",").filter(Boolean);
  const sevFilter = (sp.severity ?? "").split(",").filter(Boolean);
  const typeFilter = (sp.type ?? "").split(",").filter(Boolean);
  const page = Math.max(1, Number(sp.page ?? "1") || 1);

  const data = await withTenant(session.tenantId, async (tx) => {
    const conds: any[] = [sql`e.tenant_id = ${session.tenantId}::uuid`];
    if (statusFilter.length)
      conds.push(sql`e.status IN (${sql.join(statusFilter.map((v) => sql`${v}`), sql`, `)})`);
    if (sevFilter.length)
      conds.push(sql`e.severity IN (${sql.join(sevFilter.map((v) => sql`${v}`), sql`, `)})`);
    if (typeFilter.length)
      conds.push(sql`e.exception_type IN (${sql.join(typeFilter.map((v) => sql`${v}`), sql`, `)})`);
    const whereSql = sql.join(conds, sql` AND `);

    const totalRes = await tx.execute(sql`
      SELECT COUNT(*)::int AS c FROM reconciliation_exceptions e WHERE ${whereSql}
    `);
    const total = Number((totalRes.rows[0] as any)?.c ?? 0);

    const rows = await tx.execute(sql`
      SELECT e.id, e.investor_id, i.name AS investor_name, e.scheme_code, e.scheme_name, e.folio_number,
             e.exception_type, e.severity, e.status,
             e.crm_units, e.feed_units, e.delta_units, e.delta_value, e.detected_at
      FROM reconciliation_exceptions e
      LEFT JOIN investors i ON i.id = e.investor_id
      WHERE ${whereSql}
      ORDER BY (e.severity = 'high') DESC, ABS(COALESCE(e.delta_value,0)) DESC, e.detected_at DESC
      LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}
    `);

    const stats = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('open','investigating'))::int AS open,
        COUNT(*) FILTER (WHERE status IN ('open','investigating') AND severity = 'high')::int AS high,
        COALESCE(SUM(ABS(delta_value)) FILTER (WHERE status IN ('open','investigating')), 0)::numeric AS exposure,
        COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved
      FROM reconciliation_exceptions WHERE tenant_id = ${session.tenantId}::uuid
    `);
    const lastRun = await tx.execute(sql`
      SELECT run_at, exceptions_found FROM reconciliation_runs
      WHERE tenant_id = ${session.tenantId}::uuid ORDER BY run_at DESC LIMIT 1
    `);

    return { rows: rows.rows as any[], total, stats: stats.rows[0] as any, lastRun: lastRun.rows[0] as any };
  });

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const pageHref = (p: number) => {
    const params = new URLSearchParams(
      Object.entries(sp).filter(([k, v]) => typeof v === "string" && v && k !== "page") as [string, string][]
    );
    params.set("page", String(p));
    return `?${params.toString()}`;
  };

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Scale className="size-6 text-brand-cyan" /> Reconciliation
          </h1>
          <p className="text-muted-foreground text-sm">
            {data.lastRun?.run_at && (
              <> Last run {new Date(data.lastRun.run_at).toLocaleString("en-IN")}.</>
            )}
          </p>
        </div>
        <RunReconButton />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Open breaks" value={data.stats?.open ?? 0} />
        <Kpi label="High severity" value={data.stats?.high ?? 0} tone="rose" />
        <Kpi label="Exposure (₹ |Δ value|)" value={formatINR(Number(data.stats?.exposure ?? 0))} />
        <Kpi label="Resolved" value={data.stats?.resolved ?? 0} tone="emerald" />
      </div>

      <CompactFilterBar
        totalCount={data.total}
        rightSlot={<CustomViews viewsKey="views:reconciliation" />}
        filters={[
          {
            type: "multi",
            key: "status",
            label: "Status",
            options: [
              { value: "open", label: "Open" },
              { value: "investigating", label: "Investigating" },
              { value: "resolved", label: "Resolved" },
              { value: "ignored", label: "Ignored" },
            ],
          },
          {
            type: "multi",
            key: "severity",
            label: "Severity",
            options: [
              { value: "high", label: "High" },
              { value: "medium", label: "Medium" },
              { value: "low", label: "Low" },
            ],
          },
          {
            type: "multi",
            key: "type",
            label: "Type",
            options: [
              { value: "unit_mismatch", label: "Unit mismatch" },
              { value: "missing_in_crm", label: "Missing in CRM" },
              { value: "missing_in_feed", label: "Missing in feed" },
            ],
          },
        ]}
      />

      <ReconTable rows={data.rows} />

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Page {page} of {totalPages} · {data.total} break{data.total === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-2">
            {page > 1 && (
              <Link href={pageHref(page - 1)} className="rounded-md border bg-background px-3 py-1.5 font-medium hover:bg-accent">
                ← Prev
              </Link>
            )}
            {page < totalPages && (
              <Link href={pageHref(page + 1)} className="rounded-md border bg-background px-3 py-1.5 font-medium hover:bg-accent">
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: "rose" | "emerald" }) {
  const color = tone === "rose" ? "text-rose-600" : tone === "emerald" ? "text-emerald-600" : "";
  return (
    <div className="card-surface p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
    </div>
  );
}
