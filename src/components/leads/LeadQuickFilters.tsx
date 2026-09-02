import Link from "next/link";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Quick-filter chip strip for the Leads page.
 *
 * Each chip is a deep link to the same /dashboard/leads page with the
 * appropriate query params set — so existing filter logic continues to
 * work, and chips light up when they match the current URL.
 *
 * Counts are fetched server-side in a single SQL roundtrip alongside the
 * page render so the chips show live numbers (e.g. "Hot 23").
 *
 * Filter keys consumed by the list page:
 *   - mine=1                 → owner_id = session.userId
 *   - unassigned=1           → owner_id IS NULL
 *   - temperature=hot|cold   → derived from stage + recency
 *   - stuck=1                → aging > 14 days in stage
 *   - followup=today|overdue → next_follow_up_at constraint
 *   - new_week=1             → created_at >= now() - 7 days
 */
const OPEN_STAGES = [
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

const HOT_STAGES = [
  "meeting_scheduled",
  "meeting_done",
  "won_lead",
  "post_meeting_qualified",
  "proposal_shared",
  "proposal_approved",
  "risk_profiled",
  "docs_received",
];

export async function LeadQuickFilters({
  session,
  active,
}: {
  session: SessionUser;
  active: Record<string, string | undefined>;
}) {
  const userId = session.userId;
  const counts = await withTenant(
    session.tenantId,
    async (tx) => {
      const r = await tx.execute(sql`
        SELECT
          COUNT(*) FILTER (
            WHERE owner_id = ${userId}
              AND converted_investor_id IS NULL
              AND stage IN (${sql.join(OPEN_STAGES.map((s) => sql`${s}`), sql`, `)})
          )::int AS mine,
          COUNT(*) FILTER (
            WHERE owner_id IS NULL
              AND converted_investor_id IS NULL
              AND stage IN (${sql.join(OPEN_STAGES.map((s) => sql`${s}`), sql`, `)})
          )::int AS unassigned,
          COUNT(*) FILTER (
            WHERE converted_investor_id IS NULL
              AND stage IN (${sql.join(HOT_STAGES.map((s) => sql`${s}`), sql`, `)})
              AND (last_contact_at IS NULL OR last_contact_at >= now() - interval '7 days')
          )::int AS hot,
          COUNT(*) FILTER (
            WHERE converted_investor_id IS NULL
              AND stage IN (${sql.join(OPEN_STAGES.map((s) => sql`${s}`), sql`, `)})
              AND COALESCE(stage_changed_at, updated_at, created_at) < now() - interval '14 days'
          )::int AS stuck,
          COUNT(*) FILTER (
            WHERE converted_investor_id IS NULL
              AND stage IN (${sql.join(OPEN_STAGES.map((s) => sql`${s}`), sql`, `)})
              AND next_follow_up_at IS NOT NULL
              AND next_follow_up_at::date = current_date
          )::int AS followup_today,
          COUNT(*) FILTER (
            WHERE converted_investor_id IS NULL
              AND stage IN (${sql.join(OPEN_STAGES.map((s) => sql`${s}`), sql`, `)})
              AND next_follow_up_at IS NOT NULL
              AND next_follow_up_at < now()
          )::int AS followup_overdue,
          COUNT(*) FILTER (
            WHERE created_at >= now() - interval '7 days'
              AND converted_investor_id IS NULL
          )::int AS new_week
        FROM leads
      `);
      return r.rows[0] as any;
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const chips = [
    { key: "mine", label: "My leads", count: Number(counts.mine), tone: "violet" },
    { key: "unassigned", label: "Unassigned", count: Number(counts.unassigned), tone: "amber" },
    { key: "hot", label: "🔥 Hot", count: Number(counts.hot), tone: "rose" },
    { key: "stuck", label: "Stuck >14d", count: Number(counts.stuck), tone: "rose" },
    { key: "followup_today", label: "Follow-up today", count: Number(counts.followup_today), tone: "emerald" },
    { key: "followup_overdue", label: "Overdue follow-up", count: Number(counts.followup_overdue), tone: "rose" },
    { key: "new_week", label: "New this week", count: Number(counts.new_week), tone: "cyan" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mr-1">
        Quick filters:
      </span>
      {chips.map((c) => {
        const isActive = active[c.key] === "1";
        const next = new URLSearchParams();
        // Toggle behaviour — preserve other quick-filter flags but clear this one
        for (const [k, v] of Object.entries(active)) {
          if (v && k !== c.key) next.set(k, v);
        }
        if (!isActive) next.set(c.key, "1");
        const href = `/dashboard/leads${next.toString() ? `?${next.toString()}` : ""}`;

        const cls = toneClass(c.tone, isActive);
        return (
          <Link
            key={c.key}
            href={href}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-all ${cls}`}
          >
            <span className="font-medium">{c.label}</span>
            <span className="tabular-nums font-bold opacity-90">{c.count}</span>
          </Link>
        );
      })}
    </div>
  );
}

function toneClass(tone: string, active: boolean): string {
  const base: Record<string, string> = {
    violet: active
      ? "bg-violet-600 text-white border-violet-600 shadow-sm"
      : "bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100",
    amber: active
      ? "bg-amber-600 text-white border-amber-600 shadow-sm"
      : "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100",
    rose: active
      ? "bg-rose-600 text-white border-rose-600 shadow-sm"
      : "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100",
    emerald: active
      ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
      : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100",
    cyan: active
      ? "bg-brand-cyan text-white border-brand-cyan shadow-sm"
      : "bg-brand-cyan-light text-brand-cyan-deep border-brand-cyan/30 hover:bg-brand-cyan-light/80",
  };
  return base[tone] ?? base.cyan;
}
