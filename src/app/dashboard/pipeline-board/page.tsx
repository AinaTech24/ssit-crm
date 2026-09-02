import Link from "next/link";
import { sql } from "drizzle-orm";
import { Columns3 } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { formatINR } from "@/lib/utils";
import { PIPELINES, PIPELINE_KEYS, firstStage, isPipeline, type PipelineKey } from "@/lib/pipelines/config";
import { StageMover } from "@/components/pipelines/StageMover";
import { WorkSwitcher } from "@/components/layout/WorkSwitcher";

export const dynamic = "force-dynamic";

const PIPELINE_VIEWS = [
  { value: "/dashboard/leads", label: "Leads" },
  { value: "/dashboard/pipeline-board", label: "Pipeline Board" },
  { value: "/dashboard/lifecycle", label: "Lifecycle" },
];

const AMT = (col: string) => sql.raw(`NULLIF(regexp_replace(COALESCE(${col},''),'[^0-9.]','','g'),'')::numeric`);

export default async function PipelineBoardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const firmWide = can(session.roles, "dashboard.view.owner", (session as any).permissions);
  const sp = await searchParams;
  const p: PipelineKey = isPipeline(sp.p) ? sp.p : "mf";
  const mine = sp.mine === "1" || !firmWide;
  const stages = PIPELINES[p].stages;
  const fs = firstStage(p);

  const rows = await withTenant(
    session.tenantId,
    async (tx) => {
      const own = mine ? sql` AND l.owner_id = ${session.userId}::uuid` : sql``;
      return (await tx.execute(sql`
        SELECT l.id, l.name, l.pipeline, COALESCE(l.pipeline_stage, ${fs}) AS pstage, u.name AS owner,
               COALESCE(${AMT("l.intended_amount")}, 0) AS amt
        FROM leads l LEFT JOIN users u ON u.id = l.owner_id
        WHERE l.tenant_id = ${session.tenantId}::uuid AND l.pipeline = ${p}
          AND l.converted_investor_id IS NULL${own}
        ORDER BY amt DESC NULLS LAST LIMIT 500
      `)).rows as any[];
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const byStage: Record<string, any[]> = {};
  for (const s of stages) byStage[s.key] = [];
  for (const r of rows) (byStage[r.pstage] ?? (byStage[r.pstage] = [])).push(r);
  const valOf = (k: string) => (byStage[k] ?? []).reduce((a, r) => a + Number(r.amt || 0), 0);

  return (
    <div className="space-y-5 max-w-full">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Columns3 className="size-6 text-brand-cyan" /> Pipeline Board</h1>
          <p className="text-muted-foreground text-sm">Separate stage flows for each sales process. {mine ? "Your leads." : "Firm-wide."}</p>
        </div>
        <div className="flex items-center gap-2">
          <WorkSwitcher current="/dashboard/pipeline-board" options={PIPELINE_VIEWS} label="Module" />
          {firmWide && (
            <div className="inline-flex rounded-lg border bg-secondary/40 p-0.5 gap-0.5 text-xs">
              <Link href={`/dashboard/pipeline-board?p=${p}`} className={`px-2.5 py-1 rounded-md font-medium ${!mine ? "bg-card shadow-sm" : "text-muted-foreground"}`}>Firm</Link>
              <Link href={`/dashboard/pipeline-board?p=${p}&mine=1`} className={`px-2.5 py-1 rounded-md font-medium ${mine ? "bg-card shadow-sm" : "text-muted-foreground"}`}>Mine</Link>
            </div>
          )}
          <div className="inline-flex rounded-lg border bg-secondary/40 p-0.5 gap-0.5 text-xs">
            {PIPELINE_KEYS.map((k) => (
              <Link key={k} href={`/dashboard/pipeline-board?p=${k}${mine ? "&mine=1" : ""}`} className={`px-2.5 py-1 rounded-md font-medium ${p === k ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"}`}>{PIPELINES[k].label}</Link>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {stages.map((s) => (
          <div key={s.key} className="w-64 shrink-0">
            <div className={`rounded-t-lg px-3 py-2 text-sm font-semibold flex items-center justify-between ${s.won ? "bg-emerald-50 text-emerald-700" : s.lost ? "bg-rose-50 text-rose-700" : "bg-secondary"}`}>
              <span>{s.label} <span className="opacity-60">{(byStage[s.key] ?? []).length}</span></span>
              <span className="text-[11px] font-normal text-muted-foreground">{valOf(s.key) > 0 ? formatINR(valOf(s.key)) : ""}</span>
            </div>
            <div className="border border-t-0 rounded-b-lg bg-card/50 p-2 space-y-2 min-h-[120px]">
              {(byStage[s.key] ?? []).length === 0 ? (
                <div className="text-[11px] text-muted-foreground text-center py-6">—</div>
              ) : (byStage[s.key] ?? []).map((r) => (
                <div key={r.id} className="rounded-lg border bg-card p-2.5 shadow-sm">
                  <Link href={`/dashboard/leads/${r.id}`} className="font-medium text-sm hover:underline block truncate">{r.name}</Link>
                  <div className="text-[11px] text-muted-foreground">{Number(r.amt) > 0 ? formatINR(Number(r.amt)) : "—"}{r.owner ? ` · ${r.owner}` : ""}</div>
                  <StageMover leadId={r.id} pipeline={p} stage={r.pstage} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground italic">Move a card&apos;s stage, or switch its pipeline (e.g. send an MF lead into the Insurance flow). The 30-stage onboarding blueprint is unaffected.</p>
    </div>
  );
}
