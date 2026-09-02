import Link from "next/link";
import { sql } from "drizzle-orm";
import {
  Clock,
  Target,
  Sparkles,
  ArrowUpRight,
  PhoneCall,
  Mail,
  CalendarHeart,
  Repeat,
  Layers,
} from "lucide-react";
import { withTenant } from "@/db/client";
import { formatINR, formatDate, formatRelative } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";

/**
 * RM Insights — second-level section appended to RmDashboard.
 *
 * Service-first additions:
 *   1. Days-since-contact leaderboard (silent clients, weighted by tier)
 *   2. Goal proximity alerts (12–24 month horizon)
 *   3. Folio lifecycle nudges (exit-load expiring, lock-in completing)
 *   4. Cross-sell opportunities (equity-only HNI, lumpsum-only no SIP)
 *   5. Life-event watch (recent inbound mentions of marriage/job/child)
 *   6. AI-prioritised "next 5 actions" (heuristic scoring)
 *   7. Extended birthday/anniversary horizon (30 days)
 */
export async function RmInsightsSection({
  session,
  targetUserId,
}: {
  session: SessionUser;
  /** When an owner views another member's dashboard, scope insights to them. */
  targetUserId?: string;
}) {
  const userId = targetUserId ?? session.userId;
  const last90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const next18m = new Date(Date.now() + 540 * 24 * 60 * 60 * 1000).toISOString();
  const next30d = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const [
        silentClients,
        goalProximity,
        folioLifecycle,
        crossSell,
        lifeEvents,
        next5Actions,
        upcomingTouchpoints,
      ] = await Promise.all([
        // 1. Silent clients sorted by tier weight (A=3, B=2, C=1) × days silent
        await tx.execute(sql`
          SELECT i.id, i.name, i.segment_tag, i.service_tier, i.aum,
            i.last_contact_at,
            EXTRACT(DAY FROM (now() - COALESCE(i.last_contact_at, i.onboarded_at, now() - interval '999 days')))::int AS days_silent
          FROM investors i
          WHERE i.rm_id = ${userId} AND i.status = 'active' AND i.deleted_at IS NULL
            AND (i.last_contact_at IS NULL OR i.last_contact_at < ${last90})
          ORDER BY
            CASE i.service_tier WHEN 'A' THEN 3 WHEN 'B' THEN 2 WHEN 'C' THEN 1 ELSE 0 END DESC,
            i.aum::numeric DESC NULLS LAST
          LIMIT 8
        `),

        // 2. Goal proximity — goals due within 18 months
        await tx.execute(sql`
          SELECT g.id, g.name, g.category, g.target_date, g.progress_pct, g.status,
            g.target_amount, g.current_value, g.gap_amount,
            i.id AS investor_id, i.name AS investor_name
          FROM goals g
          INNER JOIN investors i ON i.id = g.investor_id
          WHERE i.rm_id = ${userId}
            AND i.status = 'active'
            AND i.deleted_at IS NULL
            AND g.status NOT IN ('achieved', 'abandoned')
            AND g.target_date BETWEEN current_date AND ${next18m}
          ORDER BY g.target_date ASC
          LIMIT 6
        `),

        // 3. Folio lifecycle — equity folios opened 11+ months ago (exit-load 1y) + ELSS folios near 3yr lock-in
        await tx.execute(sql`
          SELECT f.id, f.folio_number, f.amc_name, f.opened_at, f.aum,
            i.id AS investor_id, i.name AS investor_name,
            CASE
              WHEN f.opened_at < current_date - interval '36 months' THEN 'elss_unlock'
              WHEN f.opened_at < current_date - interval '11 months'
                AND f.opened_at > current_date - interval '13 months' THEN 'exit_load_expiring'
              ELSE 'other'
            END AS event_kind
          FROM folios f
          INNER JOIN investors i ON i.id = f.investor_id
          WHERE i.rm_id = ${userId}
            AND i.status = 'active'
            AND i.deleted_at IS NULL
            AND f.closed_at IS NULL
            AND (
              (f.opened_at < current_date - interval '11 months'
                 AND f.opened_at > current_date - interval '13 months')
              OR f.opened_at < current_date - interval '36 months'
            )
          ORDER BY f.aum::numeric DESC NULLS LAST
          LIMIT 6
        `),

        // 4. Cross-sell: HNI clients with non-zero AUM but no active SIP
        await tx.execute(sql`
          SELECT i.id, i.name, i.segment_tag, i.aum, i.active_sip_amount
          FROM investors i
          WHERE i.rm_id = ${userId}
            AND i.status = 'active'
            AND i.deleted_at IS NULL
            AND i.segment_tag IN ('HNI', 'Affluent')
            AND i.aum::numeric > 100000
            AND (i.active_sip_amount IS NULL OR i.active_sip_amount::numeric = 0)
          ORDER BY i.aum::numeric DESC NULLS LAST
          LIMIT 5
        `),

        // 5. Life-event watch — recent inbound communications with keywords
        await tx.execute(sql`
          SELECT c.id, c.investor_id, c.channel, c.created_at, c.inbound_content,
            i.name AS investor_name
          FROM communications c
          INNER JOIN investors i ON i.id = c.investor_id
          WHERE c.direction = 'inbound'
            AND c.created_at >= now() - interval '30 days'
            AND i.rm_id = ${userId}
            AND i.status = 'active'
            AND i.deleted_at IS NULL
            AND (
              LOWER(c.inbound_content::text) LIKE '%marriage%'
              OR LOWER(c.inbound_content::text) LIKE '%wedding%'
              OR LOWER(c.inbound_content::text) LIKE '%new job%'
              OR LOWER(c.inbound_content::text) LIKE '%promotion%'
              OR LOWER(c.inbound_content::text) LIKE '%baby%'
              OR LOWER(c.inbound_content::text) LIKE '%child%'
              OR LOWER(c.inbound_content::text) LIKE '%retired%'
              OR LOWER(c.inbound_content::text) LIKE '%retirement%'
              OR LOWER(c.inbound_content::text) LIKE '%bonus%'
              OR LOWER(c.inbound_content::text) LIKE '%moved%'
              OR LOWER(c.inbound_content::text) LIKE '%house%'
            )
          ORDER BY c.created_at DESC
          LIMIT 5
        `),

        // 6. Next 5 actions — heuristic over open leads (HOT), today tasks, SR breaches
        await tx.execute(sql`
          (
            SELECT 'lead' AS kind, l.id::text AS id, l.name AS title,
              ('Stage: ' || COALESCE(l.stage, 'new')) AS subtitle,
              COALESCE(NULLIF(regexp_replace(COALESCE(l.intended_amount, ''), '[^0-9.]', '', 'g'), '')::numeric, 0) AS impact_value,
              CASE WHEN l.next_follow_up_at <= now() THEN 100
                   WHEN l.next_follow_up_at <= now() + interval '2 days' THEN 80
                   ELSE 50 END AS urgency,
              l.next_follow_up_at AS when_at
            FROM leads l
            WHERE l.owner_id = ${userId}
              AND l.converted_investor_id IS NULL
              AND l.stage NOT IN ('lost', 'cold', 'not_interested', 'won_lead', 'converted')
              AND l.next_follow_up_at IS NOT NULL
              AND l.next_follow_up_at <= ${next30d}
          )
          UNION ALL
          (
            SELECT 'sr' AS kind, sr.id::text AS id, sr.subject AS title,
              ('Ticket ' || sr.ticket_no) AS subtitle,
              0 AS impact_value,
              CASE WHEN sr.sla_resolution_at < now() THEN 100
                   WHEN sr.sla_resolution_at < now() + interval '24 hours' THEN 85
                   ELSE 40 END AS urgency,
              sr.sla_resolution_at AS when_at
            FROM service_requests sr
            INNER JOIN investors i ON i.id = sr.investor_id
            WHERE i.rm_id = ${userId}
              AND i.deleted_at IS NULL
              AND sr.status IN ('open', 'in_progress')
          )
          UNION ALL
          (
            SELECT 'task' AS kind, t.id::text AS id, t.title,
              t.type AS subtitle,
              0 AS impact_value,
              CASE WHEN t.due_at < now() THEN 100
                   WHEN t.priority = 'urgent' THEN 90
                   WHEN t.priority = 'high' THEN 70
                   ELSE 40 END AS urgency,
              t.due_at AS when_at
            FROM tasks t
            WHERE t.assignee_id = ${userId}
              AND t.status = 'open'
          )
          ORDER BY urgency DESC, impact_value DESC NULLS LAST, when_at ASC NULLS LAST
          LIMIT 5
        `),

        // 7. Upcoming touchpoints — birthdays + anniversaries in next 30 days
        await tx.execute(sql`
          (
            SELECT 'birthday' AS kind, id, name, dob AS event_date, segment_tag,
              to_char(dob, 'MM-DD') AS md
            FROM investors
            WHERE rm_id = ${userId} AND status = 'active' AND deleted_at IS NULL AND dob IS NOT NULL
              AND to_char(dob, 'MM-DD') BETWEEN to_char(current_date, 'MM-DD')
                                            AND to_char(current_date + interval '30 days', 'MM-DD')
          )
          UNION ALL
          (
            SELECT 'anniversary' AS kind, id, name, onboarded_at::date AS event_date, segment_tag,
              to_char(onboarded_at, 'MM-DD') AS md
            FROM investors
            WHERE rm_id = ${userId} AND status = 'active' AND deleted_at IS NULL AND onboarded_at IS NOT NULL
              AND to_char(onboarded_at, 'MM-DD') BETWEEN to_char(current_date, 'MM-DD')
                                                    AND to_char(current_date + interval '30 days', 'MM-DD')
          )
          ORDER BY md ASC
          LIMIT 12
        `),
      ]);

      return {
        silentClients: silentClients.rows as any[],
        goalProximity: goalProximity.rows as any[],
        folioLifecycle: folioLifecycle.rows as any[],
        crossSell: crossSell.rows as any[],
        lifeEvents: lifeEvents.rows as any[],
        next5Actions: next5Actions.rows as any[],
        upcomingTouchpoints: upcomingTouchpoints.rows as any[],
      };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  return (
    <div className="space-y-6">
      {/* ---------- Next 5 actions ---------- */}
      <div className="card-surface glass-card p-5 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-violet-50/50 via-brand-cyan-light/30 to-transparent pointer-events-none" />
        <div className="relative">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
              <div className="size-7 rounded-lg bg-violet-100 grid place-items-center">
                <Sparkles className="size-3.5 text-violet-700" />
              </div>
              Your next 5 actions — highest impact first
            </h2>
            <span className="text-xs text-muted-foreground">
              Ranked by urgency × revenue × time-to-act
            </span>
          </div>
          {data.next5Actions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Nothing on the priority queue. Beautiful. ✓
            </p>
          ) : (
            <ol className="space-y-2">
              {data.next5Actions.map((a: any, idx: number) => {
                const href =
                  a.kind === "lead"
                    ? `/dashboard/leads/${a.id}`
                    : a.kind === "sr"
                    ? `/dashboard/service-requests`
                    : `/dashboard/tasks`;
                const kindBg =
                  a.kind === "lead"
                    ? "bg-blue-50 text-blue-700"
                    : a.kind === "sr"
                    ? "bg-rose-50 text-rose-700"
                    : "bg-amber-50 text-amber-700";
                const urgent = Number(a.urgency) >= 90;
                return (
                  <li key={`${a.kind}-${a.id}`}>
                    <Link
                      href={href}
                      className={`flex items-center gap-3 p-2.5 rounded-lg bg-white/80 hover:bg-white border ${
                        urgent ? "border-rose-200" : "border-border/40"
                      } transition-all group`}
                    >
                      <div
                        className={`size-7 rounded-md grid place-items-center font-bold text-xs ${
                          urgent ? "bg-rose-600 text-white" : "bg-brand-cyan/15 text-brand-cyan-deep"
                        }`}
                      >
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{a.title}</div>
                        <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                          <span className={`chip text-[10px] py-0.5 px-1.5 ${kindBg}`}>
                            {a.kind}
                          </span>
                          <span className="truncate">{a.subtitle}</span>
                          {Number(a.impact_value) > 0 && (
                            <span className="text-emerald-700 font-semibold">
                              · {formatINR(Number(a.impact_value))}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        {a.when_at && (
                          <div className={`text-[11px] ${urgent ? "text-rose-600 font-semibold" : "text-muted-foreground"}`}>
                            {formatRelative(a.when_at)}
                          </div>
                        )}
                        <ArrowUpRight className="size-3 text-muted-foreground inline group-hover:text-foreground transition-colors" />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>

      {/* ---------- Silent clients + Goal proximity ---------- */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card-surface glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
              <div className="size-7 rounded-lg bg-rose-50 grid place-items-center">
                <Clock className="size-3.5 text-rose-600" />
              </div>
              Silent clients (90d+)
            </h2>
            <span className="text-xs text-muted-foreground">
              Top tier first
            </span>
          </div>
          {data.silentClients.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              All clients contacted recently. ✓
            </p>
          ) : (
            <ul className="divide-y">
              {data.silentClients.map((c: any) => (
                <li key={c.id} className="py-2 flex items-center justify-between text-sm">
                  <Link
                    href={`/dashboard/investors/${c.id}`}
                    className="hover:underline flex-1"
                  >
                    <div className="font-medium">{c.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {c.service_tier && (
                        <span className="chip bg-violet-50 text-violet-700 text-[10px] py-0.5 px-1.5 mr-1">
                          Tier {c.service_tier}
                        </span>
                      )}
                      {c.segment_tag} · {formatINR(Number(c.aum))}
                    </div>
                  </Link>
                  <div className="text-right">
                    <div className="text-xs text-rose-600 font-semibold tabular-nums">
                      {c.days_silent}d
                    </div>
                    <div className="text-[10px] text-muted-foreground">silent</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card-surface glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
              <div className="size-7 rounded-lg bg-emerald-50 grid place-items-center">
                <Target className="size-3.5 text-emerald-600" />
              </div>
              Goals near maturity (≤18 mo)
            </h2>
            <span className="text-xs text-muted-foreground">Plan glide-path</span>
          </div>
          {data.goalProximity.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No goals maturing soon.
            </p>
          ) : (
            <ul className="divide-y">
              {data.goalProximity.map((g: any) => {
                const pct = Number(g.progress_pct ?? 0);
                const offTrack = g.status === "behind_track" || pct < 75;
                return (
                  <li key={g.id} className="py-2 text-sm">
                    <Link
                      href={`/dashboard/investors/${g.investor_id}`}
                      className="block hover:bg-secondary/30 -mx-2 px-2 py-1 rounded"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium truncate max-w-[60%]">
                          {g.name}
                        </span>
                        <span
                          className={`text-[10px] font-semibold ${
                            offTrack ? "text-rose-600" : "text-emerald-700"
                          }`}
                        >
                          {pct.toFixed(0)}%
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center justify-between">
                        <span className="truncate">{g.investor_name}</span>
                        <span>due {formatDate(g.target_date)}</span>
                      </div>
                      <div className="h-1 rounded-full bg-secondary overflow-hidden mt-1">
                        <div
                          className={`h-full rounded-full ${
                            offTrack ? "bg-rose-500" : "bg-emerald-500"
                          }`}
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ---------- Folio lifecycle + Cross-sell ---------- */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card-surface glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
              <div className="size-7 rounded-lg bg-amber-50 grid place-items-center">
                <Layers className="size-3.5 text-amber-700" />
              </div>
              Folio lifecycle nudges
            </h2>
            <span className="text-xs text-muted-foreground">Exit-load · ELSS lock-in</span>
          </div>
          {data.folioLifecycle.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No folio events nearby.
            </p>
          ) : (
            <ul className="divide-y">
              {data.folioLifecycle.map((f: any) => (
                <li key={f.id} className="py-2 flex items-center justify-between text-sm">
                  <Link
                    href={`/dashboard/investors/${f.investor_id}`}
                    className="hover:underline flex-1"
                  >
                    <div className="font-medium truncate">{f.investor_name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {f.amc_name} · folio {f.folio_number}
                    </div>
                  </Link>
                  <div className="text-right">
                    <span
                      className={`chip text-[10px] py-0.5 px-1.5 ${
                        f.event_kind === "elss_unlock"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {f.event_kind === "elss_unlock" ? "Lock-in done" : "Exit-load 1y"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card-surface glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
              <div className="size-7 rounded-lg bg-violet-50 grid place-items-center">
                <Repeat className="size-3.5 text-violet-600" />
              </div>
              Cross-sell — HNI without SIP
            </h2>
            <span className="text-xs text-muted-foreground">Convert lumpsum → SIP</span>
          </div>
          {data.crossSell.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No obvious cross-sell candidates.
            </p>
          ) : (
            <ul className="divide-y">
              {data.crossSell.map((c: any) => (
                <li key={c.id} className="py-2 flex items-center justify-between text-sm">
                  <Link
                    href={`/dashboard/investors/${c.id}`}
                    className="hover:underline"
                  >
                    <div className="font-medium">{c.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {c.segment_tag} · AUM {formatINR(Number(c.aum))}
                    </div>
                  </Link>
                  <span className="chip bg-violet-50 text-violet-700 text-[10px] py-0.5 px-1.5">
                    Pitch SIP
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ---------- Life events + Upcoming touchpoints ---------- */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card-surface glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
              <div className="size-7 rounded-lg bg-rose-50 grid place-items-center">
                <CalendarHeart className="size-3.5 text-rose-600" />
              </div>
              Life-event watch (30d inbound)
            </h2>
            <span className="text-xs text-muted-foreground">Marriage · job · child · move</span>
          </div>
          {data.lifeEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No life-event signals in recent messages.
            </p>
          ) : (
            <ul className="divide-y">
              {data.lifeEvents.map((e: any) => (
                <li key={e.id} className="py-2 text-sm">
                  <Link
                    href={`/dashboard/investors/${e.investor_id}`}
                    className="hover:underline"
                  >
                    <div className="font-medium">{e.investor_name}</div>
                    <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                      {e.channel === "whatsapp" ? (
                        <PhoneCall className="size-3 text-emerald-600" />
                      ) : (
                        <Mail className="size-3 text-blue-600" />
                      )}
                      <span>{formatRelative(e.created_at)} · via {e.channel}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card-surface glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
              <div className="size-7 rounded-lg bg-emerald-50 grid place-items-center">
                <CalendarHeart className="size-3.5 text-emerald-600" />
              </div>
              Birthdays & anniversaries (30d)
            </h2>
            <span className="text-xs text-muted-foreground">Plan ahead</span>
          </div>
          {data.upcomingTouchpoints.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Nothing in the next 30 days.
            </p>
          ) : (
            <ul className="divide-y">
              {data.upcomingTouchpoints.map((t: any) => (
                <li key={`${t.kind}-${t.id}`} className="py-2 flex items-center justify-between text-sm">
                  <Link
                    href={`/dashboard/investors/${t.id}`}
                    className="hover:underline flex-1"
                  >
                    <div className="font-medium">{t.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      <span
                        className={`chip text-[10px] py-0.5 px-1.5 mr-1 ${
                          t.kind === "birthday"
                            ? "bg-rose-50 text-rose-700"
                            : "bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {t.kind}
                      </span>
                      {t.segment_tag}
                    </div>
                  </Link>
                  <span className="text-xs text-muted-foreground">{t.md}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
