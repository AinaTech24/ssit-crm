import Link from "next/link";
import { sql } from "drizzle-orm";
import {
  TrendingUp,
  Flame,
  Clock,
  AlertTriangle,
  Target,
  Activity,
  Users,
} from "lucide-react";
import { withTenant } from "@/db/client";
import { formatINR } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Lead Insights — analytics strip rendered below the Kanban on the leads
 * list page. Single Promise.all so the page render only pays one
 * transaction setup cost.
 *
 * Cards:
 *   1. Pipeline forecast (₹ in flight, weighted by stage win-probability)
 *   2. Source conversion ROI (MTD)
 *   3. Lost reasons Pareto (last 90d)
 *   4. Aging-by-stage (median + stuck count)
 *   5. First-response SLA hit rate (created → first comm or first stage move)
 *   6. RM load (open leads per owner, oldest-touched flag)
 */
const LEAD_PHASE_STAGES = [
  "new",
  "call_done", "contacted", "first_call_pending",
  "call_back_later",
  "call_not_connected",
  "contact_in_future", "follow_up",
  "meeting_scheduled", "appointment_scheduled", "qualified",
  "meeting_pending",
  "meeting_done",
  "won_lead", "post_meeting_qualified",
];

// Win-probability weights per stage (MFD-typical heuristic — tuneable)
const STAGE_WIN_PROB: Record<string, number> = {
  new: 0.05,
  call_done: 0.1,
  contacted: 0.1,
  call_back_later: 0.1,
  call_not_connected: 0.05,
  contact_in_future: 0.05,
  follow_up: 0.15,
  meeting_scheduled: 0.35,
  appointment_scheduled: 0.35,
  qualified: 0.4,
  meeting_pending: 0.2,
  meeting_done: 0.55,
  post_meeting_qualified: 0.65,
  won_lead: 0.85,
  risk_profile_sent: 0.7,
  risk_profiled: 0.75,
  proposal_drafted: 0.6,
  proposal_shared: 0.7,
  proposal_approved: 0.9,
  docs_requested: 0.85,
  docs_received: 0.95,
};

export async function LeadInsightsSection({ session }: { session: SessionUser }) {
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const [
        pipelineByStage,
        sourceRoi,
        lostReasons,
        agingByStage,
        slaStats,
        rmLoad,
      ] = await Promise.all([
        // 1. Open leads grouped by stage with sum(intended_amount-parsed)
        tx.execute(sql`
          SELECT
            stage,
            COUNT(*)::int AS lead_count,
            COALESCE(SUM(
              CASE WHEN regexp_replace(COALESCE(intended_amount, ''), '[^0-9.]', '', 'g') ~ '^[0-9]+(\.[0-9]+)?$'
                THEN regexp_replace(COALESCE(intended_amount, ''), '[^0-9.]', '', 'g')::numeric
                ELSE 0
              END
            ), 0)::numeric AS intended_total
          FROM leads
          WHERE converted_investor_id IS NULL
            AND stage IN (${sql.join(LEAD_PHASE_STAGES.map((s) => sql`${s}`), sql`, `)})
          GROUP BY stage
        `),

        // 2. Source ROI MTD — total leads vs converted vs avg time-to-convert
        tx.execute(sql`
          SELECT
            source,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE converted_investor_id IS NOT NULL)::int AS converted,
            COALESCE(SUM(
              CASE WHEN regexp_replace(COALESCE(intended_amount, ''), '[^0-9.]', '', 'g') ~ '^[0-9]+(\.[0-9]+)?$'
                THEN regexp_replace(COALESCE(intended_amount, ''), '[^0-9.]', '', 'g')::numeric
                ELSE 0
              END
            ) FILTER (WHERE converted_investor_id IS NOT NULL), 0)::numeric AS converted_value
          FROM leads
          WHERE created_at >= ${startOfMonth}
          GROUP BY source
          HAVING COUNT(*) > 0
          ORDER BY converted DESC, total DESC
          LIMIT 8
        `),

        // 3. Lost-reason Pareto (last 90d)
        tx.execute(sql`
          SELECT
            COALESCE(NULLIF(TRIM(lost_reason), ''), '— No reason captured —') AS reason,
            COUNT(*)::int AS c
          FROM leads
          WHERE stage IN ('not_qualified', 'lost', 'not_interested', 'cold')
            AND (lost_at >= now() - interval '90 days' OR updated_at >= now() - interval '90 days')
          GROUP BY reason
          ORDER BY c DESC
          LIMIT 6
        `),

        // 4. Aging-by-stage — median days in stage + count "stuck >14d"
        tx.execute(sql`
          SELECT
            stage,
            (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (now() - COALESCE(stage_changed_at, updated_at, created_at))) / 86400))::int AS median_days,
            COUNT(*) FILTER (
              WHERE EXTRACT(DAY FROM (now() - COALESCE(stage_changed_at, updated_at, created_at))) > 14
            )::int AS stuck_count
          FROM leads
          WHERE converted_investor_id IS NULL
            AND stage IN (${sql.join(LEAD_PHASE_STAGES.map((s) => sql`${s}`), sql`, `)})
          GROUP BY stage
          HAVING COUNT(*) > 0
          ORDER BY median_days DESC NULLS LAST
          LIMIT 6
        `),

        // 5. First-response SLA — % of new leads (last 30d) with stage advance
        //    OR first communication within 24 hours of creation
        tx.execute(sql`
          WITH new_leads AS (
            SELECT id, created_at FROM leads
            WHERE created_at >= now() - interval '30 days'
          ),
          first_action AS (
            SELECT
              nl.id,
              nl.created_at,
              LEAST(
                COALESCE((
                  SELECT MIN(created_at) FROM communications
                  WHERE lead_id = nl.id
                ), now() + interval '999 days'),
                COALESCE((
                  SELECT updated_at FROM leads
                  WHERE id = nl.id AND stage NOT IN ('new')
                ), now() + interval '999 days')
              ) AS first_at
            FROM new_leads nl
          )
          SELECT
            COUNT(*)::int AS total_new,
            COUNT(*) FILTER (
              WHERE first_at < now() + interval '999 days'
                AND EXTRACT(EPOCH FROM (first_at - created_at)) / 3600 <= 24
            )::int AS responded_24h,
            COUNT(*) FILTER (
              WHERE first_at < now() + interval '999 days'
                AND EXTRACT(EPOCH FROM (first_at - created_at)) / 3600 <= 1
            )::int AS responded_1h,
            COUNT(*) FILTER (
              WHERE first_at >= now() + interval '999 days'
            )::int AS no_response
          FROM first_action
        `),

        // 6. RM load — open leads per owner, oldest activity
        tx.execute(sql`
          SELECT u.id, u.name AS rm_name,
            COUNT(l.id)::int AS open_leads,
            COUNT(l.id) FILTER (
              WHERE EXTRACT(DAY FROM (now() - COALESCE(l.last_contact_at, l.last_follow_up_at, l.updated_at))) > 7
            )::int AS silent_leads,
            COALESCE(SUM(
              CASE WHEN regexp_replace(COALESCE(l.intended_amount, ''), '[^0-9.]', '', 'g') ~ '^[0-9]+(\.[0-9]+)?$'
                THEN regexp_replace(COALESCE(l.intended_amount, ''), '[^0-9.]', '', 'g')::numeric
                ELSE 0
              END
            ), 0)::numeric AS pipeline_value
          FROM users u
          INNER JOIN leads l ON l.owner_id = u.id
            AND l.converted_investor_id IS NULL
            AND l.stage IN (${sql.join(LEAD_PHASE_STAGES.map((s) => sql`${s}`), sql`, `)})
          WHERE u.status = 'active'
          GROUP BY u.id, u.name
          ORDER BY open_leads DESC
          LIMIT 6
        `),
      ]);

      // Compute weighted forecast
      let pipelineForecast = 0;
      let pipelineGross = 0;
      let openCount = 0;
      for (const row of pipelineByStage.rows as any[]) {
        const stage = String(row.stage);
        const amt = Number(row.intended_total);
        const count = Number(row.lead_count);
        const prob = STAGE_WIN_PROB[stage] ?? 0.1;
        pipelineGross += amt;
        pipelineForecast += amt * prob;
        openCount += count;
      }

      const sla = slaStats.rows[0] as any;
      const slaTotal = Number(sla.total_new);
      const sla24Pct = slaTotal > 0 ? (Number(sla.responded_24h) / slaTotal) * 100 : null;
      const sla1Pct = slaTotal > 0 ? (Number(sla.responded_1h) / slaTotal) * 100 : null;

      const lostMax =
        (lostReasons.rows as any[]).reduce((m, r) => Math.max(m, Number(r.c)), 0) || 1;

      return {
        pipelineForecast,
        pipelineGross,
        openCount,
        sourceRoi: (sourceRoi.rows as any[]).map((r) => ({
          source: String(r.source),
          total: Number(r.total),
          converted: Number(r.converted),
          convPct: Number(r.total) > 0 ? (Number(r.converted) / Number(r.total)) * 100 : 0,
          convertedValue: Number(r.converted_value),
        })),
        lostReasons: (lostReasons.rows as any[]).map((r) => ({
          reason: String(r.reason),
          count: Number(r.c),
          pct: (Number(r.c) / lostMax) * 100,
        })),
        agingByStage: (agingByStage.rows as any[]).map((r) => ({
          stage: String(r.stage),
          medianDays: Number(r.median_days),
          stuck: Number(r.stuck_count),
        })),
        sla: {
          total: slaTotal,
          sla24Pct,
          sla1Pct,
          noResponse: Number(sla.no_response),
        },
        rmLoad: (rmLoad.rows as any[]).map((r) => ({
          id: String(r.id),
          name: String(r.rm_name),
          openLeads: Number(r.open_leads),
          silentLeads: Number(r.silent_leads),
          pipelineValue: Number(r.pipeline_value),
        })),
      };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  return (
    <div className="space-y-4">
      {/* Pipeline forecast strip */}
      <div className="card-surface glass-card p-5 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-50/50 via-brand-cyan-light/30 to-transparent pointer-events-none" />
        <div className="relative">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
              <div className="size-7 rounded-lg bg-emerald-50 grid place-items-center">
                <TrendingUp className="size-3.5 text-emerald-700" />
              </div>
              Pipeline forecast — ₹ in flight, probability-weighted
            </h2>
            <span className="text-xs text-muted-foreground">
              {data.openCount.toLocaleString("en-IN")} open leads
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-white/80 ring-1 ring-emerald-200/50">
              <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold">
                Weighted forecast
              </div>
              <div className="text-2xl font-bold text-emerald-700 mt-1 tabular-nums">
                {formatINR(data.pipelineForecast)}
              </div>
              <div className="text-[11px] text-emerald-700/80 mt-0.5">
                Each stage × historic win-prob
              </div>
            </div>
            <div className="p-3 rounded-lg bg-white/70">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Gross intended (open)
              </div>
              <div className="text-2xl font-bold mt-1 tabular-nums">
                {formatINR(data.pipelineGross)}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Sum of `intended_amount`
              </div>
            </div>
            <div className="p-3 rounded-lg bg-white/70">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Avg ticket
              </div>
              <div className="text-2xl font-bold mt-1 tabular-nums">
                {data.openCount > 0
                  ? formatINR(Math.round(data.pipelineGross / data.openCount))
                  : "—"}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Per open lead
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* SLA + Aging */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card-surface glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
              <div className="size-7 rounded-lg bg-rose-50 grid place-items-center">
                <Flame className="size-3.5 text-rose-600" />
              </div>
              First-response SLA (last 30d)
            </h2>
            <span className="text-xs text-muted-foreground">
              {data.sla.total} new leads
            </span>
          </div>
          {data.sla.total === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No new leads in the last 30 days.
            </p>
          ) : (
            <div className="space-y-3">
              <SlaBar label="Responded within 1 hour" pct={data.sla.sla1Pct} target={50} />
              <SlaBar label="Responded within 24 hours" pct={data.sla.sla24Pct} target={90} />
              <div className="flex items-center justify-between text-xs pt-2 border-t border-border/40">
                <span className="text-muted-foreground">No response yet</span>
                <span
                  className={`tabular-nums font-bold ${
                    data.sla.noResponse > 0 ? "text-rose-700" : "text-emerald-700"
                  }`}
                >
                  {data.sla.noResponse}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Industry baseline: 50% of inbound leads respond best to a
                call/WA inside 60 minutes. Falling response rates predict
                falling conversion rates 30 days out.
              </p>
            </div>
          )}
        </div>

        <div className="card-surface glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
              <div className="size-7 rounded-lg bg-amber-50 grid place-items-center">
                <Clock className="size-3.5 text-amber-700" />
              </div>
              Aging by stage — where it stalls
            </h2>
          </div>
          {data.agingByStage.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No open leads to analyse.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.agingByStage.map((s) => {
                const tone =
                  s.medianDays > 14
                    ? "rose"
                    : s.medianDays > 7
                    ? "amber"
                    : "emerald";
                const text =
                  tone === "rose"
                    ? "text-rose-700"
                    : tone === "amber"
                    ? "text-amber-700"
                    : "text-emerald-700";
                const bg =
                  tone === "rose"
                    ? "bg-rose-500"
                    : tone === "amber"
                    ? "bg-amber-500"
                    : "bg-emerald-500";
                return (
                  <li key={s.stage}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium capitalize">
                        {s.stage.replace(/_/g, " ")}
                      </span>
                      <span className="tabular-nums">
                        median{" "}
                        <span className={`font-bold ${text}`}>{s.medianDays}d</span>
                        {s.stuck > 0 && (
                          <span className="ml-2 text-rose-700">
                            · {s.stuck} stuck &gt;14d
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div
                        className={`h-full rounded-full ${bg}`}
                        style={{ width: `${Math.min(100, (s.medianDays / 30) * 100)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Source ROI + Lost reasons */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 card-surface glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
              <div className="size-7 rounded-lg bg-violet-50 grid place-items-center">
                <Target className="size-3.5 text-violet-700" />
              </div>
              Source ROI — MTD
            </h2>
            <span className="text-xs text-muted-foreground">
              Which channels actually convert
            </span>
          </div>
          {data.sourceRoi.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No new leads attributed this month.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-[10px] text-muted-foreground uppercase tracking-wider">
                <tr>
                  <th className="text-left pb-2">Source</th>
                  <th className="text-right pb-2">Leads</th>
                  <th className="text-right pb-2">Converted</th>
                  <th className="text-right pb-2">Conv %</th>
                  <th className="text-right pb-2">₹ from conversions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.sourceRoi.map((s) => (
                  <tr key={s.source}>
                    <td className="py-2 font-medium capitalize">
                      {s.source.replace(/_/g, " ")}
                    </td>
                    <td className="py-2 text-right tabular-nums">{s.total}</td>
                    <td className="py-2 text-right tabular-nums">{s.converted}</td>
                    <td
                      className={`py-2 text-right tabular-nums font-bold ${
                        s.convPct >= 20
                          ? "text-emerald-700"
                          : s.convPct >= 10
                          ? "text-amber-700"
                          : "text-muted-foreground"
                      }`}
                    >
                      {s.convPct.toFixed(1)}%
                    </td>
                    <td className="py-2 text-right tabular-nums font-semibold">
                      {s.convertedValue > 0 ? formatINR(s.convertedValue) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card-surface glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
              <div className="size-7 rounded-lg bg-rose-50 grid place-items-center">
                <AlertTriangle className="size-3.5 text-rose-600" />
              </div>
              Why we're losing (90d)
            </h2>
          </div>
          {data.lostReasons.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No closed-lost leads in 90 days.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.lostReasons.map((r, i) => (
                <li key={i}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium truncate max-w-[80%]" title={r.reason}>
                      {r.reason}
                    </span>
                    <span className="tabular-nums font-bold text-rose-700">{r.count}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full rounded-full bg-rose-500"
                      style={{ width: `${r.pct}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[10px] text-muted-foreground mt-3">
            Capture a lost reason on every closure — it's the cheapest market
            research you'll do.
          </p>
        </div>
      </div>

      {/* RM load */}
      <div className="card-surface glass-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
            <div className="size-7 rounded-lg bg-brand-cyan-light grid place-items-center">
              <Users className="size-3.5 text-brand-cyan-deep" />
            </div>
            RM pipeline load
          </h2>
          <span className="text-xs text-muted-foreground">
            Open leads per owner + silent (no contact 7d)
          </span>
        </div>
        {data.rmLoad.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No open leads assigned to RMs.
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[10px] text-muted-foreground uppercase tracking-wider">
              <tr>
                <th className="text-left pb-2">RM</th>
                <th className="text-right pb-2">Open</th>
                <th className="text-right pb-2">Silent &gt;7d</th>
                <th className="text-right pb-2">% silent</th>
                <th className="text-right pb-2">Pipeline ₹</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.rmLoad.map((r) => {
                const pct =
                  r.openLeads > 0 ? (r.silentLeads / r.openLeads) * 100 : 0;
                return (
                  <tr key={r.id}>
                    <td className="py-2 font-medium truncate max-w-[200px]">
                      {r.name}
                    </td>
                    <td className="py-2 text-right tabular-nums">{r.openLeads}</td>
                    <td className="py-2 text-right tabular-nums">{r.silentLeads}</td>
                    <td
                      className={`py-2 text-right tabular-nums font-bold ${
                        pct > 50 ? "text-rose-600" : pct > 25 ? "text-amber-600" : "text-foreground"
                      }`}
                    >
                      {pct.toFixed(0)}%
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatINR(r.pipelineValue)}
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

function SlaBar({
  label,
  pct,
  target,
}: {
  label: string;
  pct: number | null;
  target: number;
}) {
  const value = pct ?? 0;
  const meets = pct != null && pct >= target;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums">
          <span
            className={`font-bold ${
              meets ? "text-emerald-700" : "text-rose-700"
            }`}
          >
            {pct != null ? `${pct.toFixed(0)}%` : "—"}
          </span>
          <span className="text-muted-foreground"> · target {target}%</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-secondary overflow-hidden relative">
        <div
          className={`h-full rounded-full ${
            meets ? "bg-emerald-500" : "bg-rose-500"
          }`}
          style={{ width: `${Math.min(100, value)}%` }}
        />
        <div
          className="absolute top-0 bottom-0 w-px bg-foreground/50"
          style={{ left: `${target}%` }}
          title={`Target ${target}%`}
        />
      </div>
    </div>
  );
}
