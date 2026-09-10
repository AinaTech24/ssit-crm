import Link from "next/link";
import { eq, sql, inArray, isNull } from "drizzle-orm";
import {
  Plus,
  Sparkles,
  UserPlus,
  FileDown,
  Filter,
  LayoutGrid,
  List,
  CalendarPlus,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { withTenant } from "@/db/client";
import { leads, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { requireLeadView, leadScopeSql } from "@/lib/leads/access";
import { WorkSwitcher } from "@/components/layout/WorkSwitcher";

const PIPELINE_VIEWS = [
  { value: "/dashboard/leads", label: "Leads" },
  { value: "/dashboard/pipeline-board", label: "Pipeline Board" },
  { value: "/dashboard/lifecycle", label: "Lifecycle" },
];
import { LeadsKanban } from "@/components/leads/LeadsKanban";
import { LeadsTable } from "@/components/leads/LeadsTable";
import { LeadsViewPersist } from "@/components/leads/LeadsViewPersist";
// import { LeadQuickFilters } from "@/components/leads/LeadQuickFilters";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { Pager } from "@/components/common/Pager";
import { dateRangeCond, dateRangeFilter } from "@/lib/filters/date-range";
import { CustomViews } from "@/components/common/CustomViews";
import { EmptyState } from "@/components/common/EmptyState";
import { RowActions } from "@/components/common/RowActions";
import { ColumnManager } from "@/components/common/ColumnManager";

/**
 * Pipeline columns — exact mirror of the 12 lead-phase blueprint stages
 * (stages 1-12 of LEAD_TO_CLIENT_STAGES, before the Convert-to-Client
 * boundary). The platform now speaks a single vocabulary: stage ===
 * blueprint stage. Drag-drop here calls the blueprint advance engine.
 *
 * Aliases fold legacy stage values from before the unification onto the
 * canonical blueprint key.
 */
/**
 * Kanban columns — 10 lead-phase blueprint stages. Aliases fold legacy
 * stage values onto the canonical key so historic leads land in the
 * right column.
 */
const STAGES = [
  { key: "new", label: "New", tone: "blue", aliases: [] as string[] },
  { key: "call_done", label: "Call Done", tone: "cyan", aliases: ["contacted", "first_call_pending"] },
  { key: "call_back_later", label: "Call Back Later", tone: "cyan", aliases: [] },
  { key: "call_not_connected", label: "Call Not Connected", tone: "slate", aliases: [] },
  { key: "contact_in_future", label: "Contact in Future", tone: "slate", aliases: ["follow_up"] },
  { key: "meeting_scheduled", label: "Meeting Scheduled", tone: "amber", aliases: ["appointment_scheduled", "qualified"] },
  { key: "meeting_pending", label: "Meeting Pending", tone: "amber", aliases: [] },
  { key: "meeting_done", label: "Meeting Done", tone: "indigo", aliases: ["meeting_done"] },
  { key: "won_lead", label: "Won Lead", tone: "emerald", aliases: ["converted", "post_meeting_qualified"] },
  { key: "not_qualified", label: "Not Qualified", tone: "rose", aliases: ["lost", "not_interested", "cold"] },
] as const;

const LEAD_PHASE_STAGES = [
  "new",
  "call_done", "contacted", "first_call_pending",
  "call_back_later",
  "call_not_connected",
  "contact_in_future", "follow_up",
  "meeting_scheduled", "appointment_scheduled", "qualified",
  "meeting_pending",
  "meeting_done",
  "won_lead", "converted", "post_meeting_qualified",
  "not_qualified", "lost", "not_interested", "cold"
];

const LEADS_COLUMNS = [
  { key: "score", label: "Score" },
  { key: "name", label: "Name", required: true },
  { key: "stage", label: "Stage" },
  { key: "intendedAmount", label: "Intended Amount" },
  { key: "source", label: "Source" },
  { key: "nextFollowUpAt", label: "Next Follow-Up" },
  { key: "lastContactAt", label: "Last Contacted" },
  { key: "owner", label: "Owner (RM)" },
  { key: "createdAt", label: "Created At" },
  { key: "actions", label: "Actions", required: true },
];

export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  // Authorization: a role with no lead visibility is blocked here (defense in
  // depth — the sidebar already hides the module).
  requireLeadView(session);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const stageFilter = (sp.stage ?? "").split(",").filter(Boolean);
  const sourceFilter = (sp.source ?? "").split(",").filter(Boolean);
  // The event a lead came from. Stored in source_campaign — the same field the
  // {{lead.event_name}} merge field reads, so the filter and the template agree.
  const eventFilter = (sp.event ?? "").split(",").filter(Boolean);
  const ownerFilter = (sp.owner ?? "").split(",").filter(Boolean);
  // The RM / branch of the REFERRING CLIENT — not the lead owner. The referrals
  // module credits a referral to the relationship it came out of, so its
  // drill-downs have to filter on the same thing or the count and the list
  // disagree (they did: an RM row said 2 and opened 0).
  const referrerRm = (sp.referrerRm ?? "").trim();
  const referrerBranch = (sp.referrerBranch ?? "").trim();
  // One entry of the interest_products array. The free-text search covers name,
  // phone and email only, so it could never find these.
  const productFilter = (sp.product ?? "").trim();
  // Describes the active narrowing so the empty state can name it.
  const activeFilterLabel = [
    q ? `matching “${q}”` : "",
    ...stageFilter.map((s) => s.replace(/_/g, " ")),
    ...sourceFilter.map((s) => s.replace(/_/g, " ")),
  ]
    .filter(Boolean)
    .join(" · ");
  const view = sp.view === "table" ? "table" : "kanban";
  // Table sort: "score" (default — hottest first) or "recent". Both default to
  // descending; an explicit `dir` (set by re-clicking the column header) flips
  // to ascending so the user can see coldest leads / oldest-created first.
  const sortKey = sp.sort === "recent" ? "recent" : "score";
  const dir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";
  // Pagination (table view). The kanban shows a bounded top-N slice.
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const PAGE_SIZE = 50;
  const KANBAN_CAP = 400;

  // Quick-filter chip params (from LeadQuickFilters)
  const qf = {
    mine: sp.mine === "1",
    referred: sp.referred === "1",
    unassigned: sp.unassigned === "1",
    hot: sp.hot === "1",
    stuck: sp.stuck === "1",
    followup_today: sp.followup_today === "1",
    followup_overdue: sp.followup_overdue === "1",
    new_week: sp.new_week === "1",
  };
  const userId = session.userId;

  const data = await withTenant(session.tenantId, async (tx) => {
    const conds: any[] = [
      inArray(leads.stage, LEAD_PHASE_STAGES as any),
      isNull(leads.convertedInvestorId),
      // Hide soft-deleted (archived) leads — they carry the __deleted__ sentinel.
      sql`leads.lost_reason IS DISTINCT FROM '__deleted__'`,
      // Role scope: RMs see only their own leads, branch heads only their
      // branch, owner/managers the whole book. RLS isolates by TENANT only, so
      // this owner/branch slice MUST be applied in the query (the API enforces
      // the same via leadScopeCondition — the page used to skip it, exposing the
      // whole firm's pipeline to every RM).
      leadScopeSql(session, "leads"),
    ];
    if (q) {
      conds.push(
        sql`(leads.name ILIKE ${`%${q}%`} OR leads.phone ILIKE ${`%${q}%`} OR leads.email ILIKE ${`%${q}%`} OR users.name ILIKE ${`%${q}%`})`
      );
    }
    if (stageFilter.length) {
      conds.push(sql`leads.stage IN (${sql.join(stageFilter.map((v) => sql`${v}`), sql`, `)})`);
    }
    if (sourceFilter.length)
      conds.push(sql`leads.source IN (${sql.join(sourceFilter.map((v) => sql`${v}`), sql`, `)})`);
    if (eventFilter.length)
      conds.push(sql`leads.source_campaign IN (${sql.join(eventFilter.map((v) => sql`${v}`), sql`, `)})`);
    if (ownerFilter.length)
      conds.push(sql`leads.owner_id IN (${sql.join(ownerFilter.map((v) => sql`${v}::uuid`), sql`, `)})`);

    // Quick-filter conditions — each adds a constraint; AND-combined.
    // A lead LINKED to a referring client. Deliberately not the same as
    // source='referral': that is a free-text-ish label anyone can set, while this
    // is the actual relationship the referrals module counts. The two gave
    // different totals, so the referral tiles link here instead.
    if (qf.referred) conds.push(sql`leads.referred_by_investor_id IS NOT NULL`);
    if (productFilter)
      conds.push(sql`leads.interest_products @> ${JSON.stringify([productFilter])}::jsonb`);
    if (referrerRm)
      conds.push(sql`EXISTS (SELECT 1 FROM investors ri WHERE ri.id = leads.referred_by_investor_id AND ri.rm_id = ${referrerRm}::uuid)`);
    if (referrerBranch)
      conds.push(sql`EXISTS (
        SELECT 1 FROM investors ri
          JOIN users ru ON ru.id = ri.rm_id
         WHERE ri.id = leads.referred_by_investor_id AND ru.branch_id = ${referrerBranch}::uuid
      )`);
    if (qf.mine) conds.push(sql`leads.owner_id = ${userId}`);
    if (qf.unassigned) conds.push(sql`leads.owner_id IS NULL`);
    // "Hot" now means a high deterministic score (persisted), not just a
    // late-funnel stage — so a fresh referral with a scheduled meeting ranks
    // hot even before it advances.
    if (qf.hot) {
      conds.push(sql`leads.score_band = 'hot'`);
    }
    if (qf.stuck) {
      conds.push(
        sql`COALESCE(leads.stage_changed_at, leads.updated_at, leads.created_at) < now() - interval '14 days'`
      );
    }
    if (qf.followup_today) {
      conds.push(sql`leads.next_follow_up_at::date = current_date`);
    }
    if (qf.followup_overdue) {
      conds.push(sql`leads.next_follow_up_at IS NOT NULL AND leads.next_follow_up_at < now()`);
    }
    if (qf.new_week) {
      conds.push(sql`leads.created_at >= now() - interval '7 days'`);
    }
    const dr = dateRangeCond(sp, "created", "leads.created_at");
    if (dr) conds.push(dr);

    const whereClause: any = sql.join(conds, sql` AND `);

    const baseQuery = tx
      .select({ lead: leads, owner: users.name })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.ownerId));
    // Default ordering: hottest (highest persisted score) first, recency as
    // tiebreaker. Index-backed via leads_score_idx (tenant_id, lead_score DESC).
    const dirSql = sql.raw(dir === "asc" ? "ASC" : "DESC");
    const orderBy =
      sortKey === "recent"
        ? sql`leads.updated_at ${dirSql}`
        : sql`leads.lead_score ${dirSql}, leads.updated_at DESC`;
    const isTable = view === "table";
    // Total matching count (for the table pager) — same predicate + join.
    const totalRes = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.ownerId))
      .where(whereClause as any);
    const total = Number(totalRes[0]?.c ?? 0);
    const rows = await baseQuery
      .where(whereClause as any)
      .orderBy(orderBy as any)
      .limit(isTable ? PAGE_SIZE : KANBAN_CAP)
      .offset(isTable ? (page - 1) * PAGE_SIZE : 0);
    // Roster for the "Owner (RM)" filter — so owners/managers can slice the
    // pipeline by the RM who owns each lead.
    const rmRows = await tx.execute(sql`
      SELECT id, name FROM users
      WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
      ORDER BY name ASC
    `);
    // Headline counts. Deliberately NOT filtered by the list's stage/search
    // filters — "total leads" has to mean the book, not the current view — but
    // scoped by the same leadScopeSql, so an RM's cards match their own list.
    // Converted and lost live OUTSIDE the list (it shows live pipeline only),
    // which is exactly why they need surfacing here.
    const eventRes = await tx.execute(sql`
      SELECT DISTINCT leads.source_campaign AS name
        FROM leads
       WHERE leads.tenant_id = ${session.tenantId}::uuid
         AND leads.source_campaign IS NOT NULL
         AND btrim(leads.source_campaign) <> ''
         AND leads.lost_reason IS DISTINCT FROM '__deleted__'
       ORDER BY name ASC
       LIMIT 200
    `);

    const kpiRes = await tx.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE leads.created_at::date = CURRENT_DATE)::int AS created_today,
        -- Either signal counts: the link is set when a lead is converted through
        -- the app, but a lead moved to the converted STAGE by hand has no link
        -- and would otherwise be invisible here.
        COUNT(*) FILTER (
          WHERE leads.converted_investor_id IS NOT NULL OR leads.stage = $$converted$$
        )::int AS converted,
        COUNT(*) FILTER (WHERE leads.stage IN ('lost', 'not_interested'))::int AS lost
      FROM leads
      WHERE leads.tenant_id = ${session.tenantId}::uuid
        AND leads.lost_reason IS DISTINCT FROM '__deleted__'
        AND ${leadScopeSql(session, "leads")}
    `);
    const kpi = (kpiRes.rows[0] as any) ?? { total: 0, created_today: 0, converted: 0, lost: 0 };

    return {
      rows,
      rms: rmRows.rows as any[],
      total,
      kpi,
      events: eventRes.rows as unknown as { name: string }[],
    };
  });

  const rmOptions = (data.rms ?? []).map((r: any) => ({ value: String(r.id), label: r.name ?? "—" }));
  // Hidden entirely when the firm has run no events — an empty dropdown is
  // worse than no dropdown.
  const eventOptions = (data.events ?? []).map((e) => ({ value: String(e.name), label: String(e.name) }));

  // Enrich rows for the table view with a deterministic priority score, and
  // sort hottest-first by default (or most-recent when ?sort=recent).
  const toIso = (v: any) => (v ? new Date(v as any).toISOString() : null);
  const tableRows = data.rows.map((r) => {
    const l = r.lead as any;
    const stageObj = STAGES.find(
      (s) => s.key === l.stage || (s.aliases as readonly string[]).includes(l.stage)
    );
    return {
      id: l.id,
      name: l.name,
      avatarUrl: l.avatarUrl ?? null,
      phone: l.phone ?? null,
      email: l.email ?? null,
      stage: l.stage,
      // A lead with a client behind it reads as "Converted", not "Won" — the
      // alias that folds converted into won_lead is a pipeline rule, not a
      // labelling one.
      stageLabel: l.convertedInvestorId || l.stage === "converted" ? "Converted" : (stageObj?.label ?? l.stage),
      stageTone: stageObj?.tone ?? "slate",
      source: l.source,
      intendedAmount: l.intendedAmount ?? null,
      nextFollowUpAt: toIso(l.nextFollowUpAt),
      lastContactAt: toIso(l.lastContactAt),
      createdAt: toIso(l.createdAt),
      owner: r.owner ?? null,
      // Persisted deterministic score (src/lib/leads/score.ts) — written on
      // create + every stage transition, backfilled for historic rows.
      score: l.leadScore ?? 0,
    };
  });
  if (sortKey === "score") tableRows.sort((a, b) => (dir === "asc" ? a.score - b.score : b.score - a.score));

  return (
    <div className="space-y-6">
      {/* Restores the last-used view (kanban/list) when arriving with no ?view param. */}
      <LeadsViewPersist explicitView={sp.view ?? null} />
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">
            <UserPlus className="size-6 text-brand-cyan" /> Leads
          </h1>
        </div>
        <div className="flex gap-2 items-center">
          <WorkSwitcher current="/dashboard/leads" options={PIPELINE_VIEWS} label="Module" />
          {/* View toggle — Kanban vs List */}
          <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-0.5 gap-0.5 mr-1">
            <Link
              href="/dashboard/leads?view=kanban"
              className={`px-2.5 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${view === "kanban"
                ? "bg-card shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
                }`}
            >
              <LayoutGrid className="size-3.5" /> Kanban
            </Link>
            <Link
              href="/dashboard/leads?view=table"
              className={`px-2.5 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${view === "table"
                ? "bg-card shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
                }`}
            >
              <List className="size-3.5" /> List
            </Link>
          </div>

          {/* Columns + Views moved into the filter toolbar (right side), so every
              list module carries the same compact icon row as Tasks. */}
          <Link href="/dashboard/leads/import" className="btn-secondary text-xs">
            <FileDown className="size-3.5" /> Import Excel
          </Link>
          <Link href="/dashboard/leads/new" className="btn-primary">
            <Plus className="size-4" /> New lead
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <LeadKpi label="Total leads" value={data.kpi.total} icon={UserPlus} />
        <LeadKpi label="Created today" value={data.kpi.created_today} icon={CalendarPlus} />
        <LeadKpi label="Converted" value={data.kpi.converted} icon={CheckCircle2} tone="emerald" />
        <LeadKpi label="Lost" value={data.kpi.lost} icon={XCircle} tone="rose" />
      </div>

      {/* Quick-filter chip strip — server-side counts, deep links into same page */}
      {/* <div className="card-surface p-3">
        <LeadQuickFilters session={session} active={sp as Record<string, string | undefined>} />
      </div> */}

      <CompactFilterBar
        totalCount={data.total}
        searchPlaceholder="Search lead by name, phone, email…"
        filters={[
          {
            type: "multi",
            key: "stage",
            label: "Stage",
            options: STAGES.map((s) => ({ value: s.key, label: s.label })),
          },
          ...(eventOptions.length
            ? [{ type: "multi" as const, key: "event", label: "Event", options: eventOptions }]
            : []),
          {
            type: "multi",
            key: "source",
            label: "Source",
            options: [
              { value: "referral", label: "Client Referral" },
              { value: "existing_client", label: "Existing Client Reference" },
              { value: "website", label: "Website" },
              { value: "social_media", label: "Social Media" },
              { value: "webinar", label: "Webinar" },
              { value: "seminar", label: "Seminar" },
              { value: "walk_in", label: "Walk-in" },
              { value: "google", label: "Google" },
              { value: "cold_call", label: "Cold Call" },
              { value: "manual", label: "Manual entry" },
              { value: "other", label: "Other" },
            ],
          },
          ...(rmOptions.length
            ? [{ type: "multi" as const, key: "owner", label: "Owner (RM)", options: rmOptions }]
            : []),
          dateRangeFilter("created", "Created"),
        ]}
        rightSlot={
          <div className="flex items-center gap-2">
            {view === "table" && (
              <ColumnManager compact moduleKey="leads" columns={LEADS_COLUMNS} />
            )}
            <CustomViews
              compact
              viewsKey="views:leads"
              presets={[
                {
                  id: "open",
                  name: "All open",
                  params: "stage=new,call_done,call_back_later,call_not_connected,contact_in_future,meeting_scheduled,meeting_pending,meeting_done,won_lead",
                },
                { id: "referrals", name: "Referrals only", params: "source=referral,existing_client" },
                { id: "won", name: "Won leads", params: "stage=won_lead,converted" },
                { id: "lost", name: "Not qualified / lost", params: "stage=not_qualified,lost,not_interested" },
              ]}
            />
          </div>
        }
      />

      {/* Kanban — drag-and-drop enabled. Show a friendly empty-state when
          there are no leads yet AND no filters are active, so a brand-new
          tenant sees a clear "Add your first lead" path. */}
      {data.rows.length === 0 && !q && stageFilter.length === 0 && sourceFilter.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No leads yet — let's add the first one"
          description="A lead is anyone who's shown interest in your services but hasn't invested yet. The CRM tracks them through 8 stages from First Contact to Converted."
          tip="Click + at the top right to add manually, or import an Excel file of leads in seconds."
          primary={{ href: "/dashboard/leads/new", label: "+ Add first lead" }}
          secondary={{ href: "/dashboard/leads/import", label: "Import from Excel" }}
        />
      ) : view === "kanban" ? (
        <div className="card-surface p-3">
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Filter className="size-3.5" />
              <span className="font-medium">Pipeline view</span>
              <span>·</span>
              <span>
                {data.total} total leads{data.total > data.rows.length ? ` · showing top ${data.rows.length}` : ""}
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground">
              Drag a card to move it between stages
            </span>
          </div>
          <LeadsKanban
            stages={STAGES.map((s) => ({ ...s, aliases: [...s.aliases] }))}
            initialRows={data.rows.map((r) => ({
              lead: {
                id: r.lead.id,
                name: r.lead.name,
                phone: (r.lead as any).phone ?? null,
                stage: r.lead.stage,
                source: r.lead.source,
                updatedAt: r.lead.updatedAt,
                stageChangedAt: r.lead.stageChangedAt
                  ? new Date(r.lead.stageChangedAt as any).toISOString()
                  : null,
                createdAt: r.lead.createdAt
                  ? new Date(r.lead.createdAt as any).toISOString()
                  : null,
                lastContactAt: r.lead.lastContactAt
                  ? new Date(r.lead.lastContactAt as any).toISOString()
                  : null,
                lastFollowUpAt: r.lead.lastFollowUpAt
                  ? new Date(r.lead.lastFollowUpAt as any).toISOString()
                  : null,
                nextFollowUpAt: r.lead.nextFollowUpAt
                  ? new Date(r.lead.nextFollowUpAt as any).toISOString()
                  : null,
                intendedAmount: r.lead.intendedAmount ?? null,
                convertedInvestorId: r.lead.convertedInvestorId ?? null,
                utmParams: r.lead.utmParams ?? null,
              },
              owner: r.owner ?? null,
            }))}
          />
        </div>
      ) : data.rows.length === 0 ? (
        <div className="card-surface p-12 text-center text-sm text-muted-foreground">
          {/* Name what was filtered on, so an empty result reads as "this filter
              found nothing" rather than "the list is broken". */}
          {activeFilterLabel ? (
            <>
              No <span className="font-medium text-foreground">{activeFilterLabel}</span> leads.{" "}
              <Link href="/dashboard/leads" className="text-brand-cyan-deep hover:underline">
                Clear filters
              </Link>
            </>
          ) : (
            <>
              No leads match these filters.{" "}
              <Link href="/dashboard/leads/new" className="text-brand-cyan-deep hover:underline">
                Add one manually
              </Link>
            </>
          )}
          .
        </div>
      ) : (
        <div>
          <LeadsTable rows={tableRows} sort={sortKey} dir={dir} />
          <Pager page={page} totalPages={Math.ceil(data.total / PAGE_SIZE)} total={data.total} pageSize={PAGE_SIZE} />
        </div>
      )}

    </div>
  );
}

/** Headline count tile for the leads header strip. */
function LeadKpi({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: any;
  tone?: "emerald" | "rose";
}) {
  const toneC =
    tone === "emerald" ? "text-emerald-600" : tone === "rose" ? "text-rose-600" : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <Icon className="size-3.5" />
      </div>
      <div className={`text-xl font-bold mt-1 tabular-nums ${toneC}`}>{value}</div>
    </div>
  );
}
