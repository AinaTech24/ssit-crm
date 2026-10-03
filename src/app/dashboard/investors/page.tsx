import Link from "next/link";
import { Plus, FileDown, LayoutGrid, List, FileUp, Cake, CalendarPlus, CheckCircle2, CalendarClock } from "lucide-react";
import { and, asc, desc, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { investors } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { investorScopeCondition, investorScopeSql, requireInvestorView } from "@/lib/investors/access";
import { ModuleKpis } from "@/components/modules/ModuleKpis";
import { RecomputeTiersButton } from "@/components/investors/RecomputeTiersButton";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { ScopeFilterBar } from "@/components/common/ScopeFilterBar";
import { usersInScopeSql } from "@/lib/auth/data-scope";
import { parseScope, scopeFilterSql, loadScopeUnits, loadScopeMembers, canPickScope } from "@/lib/scope/view-filter";
import { dateRangeFilter } from "@/lib/filters/date-range";
import { CustomViews } from "@/components/common/CustomViews";
import { EmptyState } from "@/components/common/EmptyState";
import { Users } from "lucide-react";
import { InvestorsKanban, type InvestorRow } from "@/components/investors/InvestorsKanban";
import { ColumnManager } from "@/components/common/ColumnManager";
import { loadTenantLicense } from "@/lib/auth/license";
import { isFieldAllowed } from "@/lib/auth/field-gate";
// import { InvestorQuickFilters } from "@/components/investors/InvestorQuickFilters"; // hidden for now
import { dormancyDays, type HealthBand } from "@/lib/investors/health";
import { InvestorsTable, type InvestorTableRow } from "@/components/investors/InvestorsTable";
import { InvestorSortSelect } from "@/components/investors/InvestorSortSelect";
import { buildInvestorWhere } from "@/lib/investors/list-filters";
import { Pager } from "@/components/common/Pager";
import { countPossibleDuplicates } from "@/lib/investors/duplicates";
import { clientCompleteness } from "@/lib/investors/completeness";
import { CopyPlus } from "lucide-react";
import { DownloadButton } from "@/components/common/SecureLinkButtons";

const INVESTORS_COLUMNS = [
  { key: "name", label: "Name", required: true },
  { key: "pan", label: "PAN" },
  { key: "category", label: "Category" },
  { key: "tier", label: "Tier" },
  { key: "segment", label: "Segment" },
  { key: "aum", label: "AUM" },
  { key: "sip", label: "Monthly SIP" },
  { key: "kyc", label: "KYC" },
  { key: "health", label: "Health" },
  { key: "complete", label: "Profile %" },
  { key: "status", label: "Status" },
  { key: "actions", label: "Actions", required: true },
];

export const dynamic = "force-dynamic";

export default async function InvestorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const license = await loadTenantLicense(session.tenantId, session.roles);
  const showPan = isFieldAllowed(license, "investor", "pan");
  const showAum = isFieldAllowed(license, "investor", "aum");
  const showSip = isFieldAllowed(license, "investor", "active_sip_amount") || isFieldAllowed(license, "investor", "sip");
  const showKyc = isFieldAllowed(license, "investor", "kyc_status") || isFieldAllowed(license, "investor", "kyc");
  const showStatus = isFieldAllowed(license, "investor", "status");
  const showTier = isFieldAllowed(license, "investor", "service_tier") || isFieldAllowed(license, "investor", "tier");
  const showSegment = isFieldAllowed(license, "investor", "segment_tag") || isFieldAllowed(license, "investor", "segment");

  const allowedColumns = INVESTORS_COLUMNS.filter((col) => {
    if (col.key === "pan") return showPan;
    if (col.key === "aum") return showAum;
    if (col.key === "sip") return showSip;
    if (col.key === "kyc") return showKyc;
    if (col.key === "status") return showStatus;
    if (col.key === "tier") return showTier;
    if (col.key === "segment") return showSegment;
    // health column is always allowed — it's a derived score, no PII
    return true;
  });

  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const segment = (sp.segment ?? "").split(",").filter(Boolean);
  const tier = (sp.tier ?? "").split(",").filter(Boolean);
  const status = (sp.status ?? "").split(",").filter(Boolean);
  const kyc = (sp.kyc ?? "").split(",").filter(Boolean);
  // Describes the active narrowing so the empty state can name it.
  const activeFilterLabel = [
    q ? `matching “${q}”` : "",
    ...segment,
    ...tier.map((t) => `tier ${t}`),
    ...status,
    ...kyc.map((k) => `KYC ${k}`),
  ]
    .filter(Boolean)
    .join(" · ");
  const view = sp.view === "kanban" ? "kanban" : "table";
  const userId = session.userId;
  // Only firm-wide viewers (owner / branch_head) get the "RM" book-slice filter.
  // Client data is capability-gated: marketing / team members with no
  // investor capability never reach the list (same rule the API enforces).
  requireInvestorView(session);
  const canViewAll = can(session.roles, "investor.view.all", session.permissions);

  // Query string for the Excel export link — carries the current filters so the
  // download matches exactly what's on screen (the export endpoint reuses the
  // same buildInvestorWhere helper). Drop view/sort — they don't affect rows.
  const exportQs = new URLSearchParams(
    Object.entries(sp).filter(
      ([k, v]) => v != null && v !== "" && k !== "view" && k !== "sort" && k !== "dir"
    ) as [string, string][]
  ).toString();

  // Sort key drives both the DB ordering and the table header arrows. AUM is
  // the default (largest books first). "health" is a derived score computed in
  // JS, so it can't be ordered in SQL — the page sorts the fetched rows
  // locally (worst health first, to triage at-risk clients on the visible page).
  // Default to newest-first so a just-created client appears in the first row.
  const sortKey = ["name", "sip", "review", "health", "created", "aum"].includes(sp.sort ?? "")
    ? (sp.sort as string)
    : "created";

  // Sort direction. Each column has a sensible default (largest AUM/SIP first,
  // A→Z names, soonest review, worst health for triage); an explicit `dir`
  // query param (set by clicking the column header again) overrides it so the
  // user can flip ascending ↔ descending on any column.
  const DEFAULT_DIR: Record<string, "asc" | "desc"> = {
    name: "asc",
    aum: "desc",
    sip: "desc",
    review: "asc",
    health: "asc",
    created: "desc",
  };
  const dir: "asc" | "desc" =
    sp.dir === "asc" || sp.dir === "desc" ? sp.dir : DEFAULT_DIR[sortKey] ?? "desc";

  // Opened from the header birthday widget's "View all <Month> birthdays".
  // The page otherwise looks like the ordinary client list with rows missing,
  // so this turns on a Birthday column, date ordering and a banner that says
  // what is being shown.
  const birthdayView = sp.birthday_month === "1";
  const monthLabel = new Date().toLocaleDateString("en-IN", { month: "long" });

  // Table pagination — 50/page. Kanban shows a larger single window (it's a
  // pipeline board, not a paged list). `page` is 1-based.
  const PAGE_SIZE = 50;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const scopeSel = parseScope(sp as Record<string, string | undefined>);
  const showScopePicker = canPickScope(session);

  const { rows, total, kanbanRows, rms, allIds, dupCount, scopeUnits, scopeMembers, kpi } = await withTenant(session.tenantId, async (tx) => {
    // Filters live in one shared helper so the page and the Excel export apply
    // identical WHERE logic. Tenant isolation is handled by RLS.
    // Row scope: an RM sees only their own book, a branch head only their
    // branch. RLS isolates by TENANT only, so without this every RM saw the
    // whole firm’s client list (and could export it) — the JSON API scoped
    // correctly but this page did not.
    const scope = await investorScopeCondition(tx, session);
    const filters = buildInvestorWhere(sp, userId);
    // "Show me one sub-branch / one RM" — a VIEW filter on top of the wall,
    // never instead of it, so picking a desk can only ever narrow what this
    // session was already allowed to see. Owner is BOTH the relationship RM
    // and the servicing RM: a client serviced by someone on the desk belongs
    // to that desk's view even when the relationship sits elsewhere.
    const viewScope = scopeFilterSql(scopeSel, session.tenantId, [
      "investors.rm_id",
      "investors.service_rm_id",
    ]);
    const where = and(filters, scope, viewScope);

    // Project only the columns the table + kanban actually read — the table
    // never needs the heavy/sensitive jsonb (kycData, nominees, crossSell,
    // address), so don't pull them into the server component for every page.
    const r = await tx
      .select({
        id: investors.id,
        name: investors.name,
        avatarUrl: investors.avatarUrl,
        pan: investors.pan,
        clientCategory: investors.clientCategory,
        serviceTier: investors.serviceTier,
        segmentTag: investors.segmentTag,
        aum: investors.aum,
        activeSipAmount: investors.activeSipAmount,
        kycStatus: investors.kycStatus,
        status: investors.status,
        healthScore: investors.healthScore,
        healthBand: investors.healthBand,
        lastTransactionAt: investors.lastTransactionAt,
        updatedAt: investors.updatedAt,
        // Lightweight fields for the profile-completeness column (scalar +
        // small address jsonb; the heavy nominees/bank jsonb use the cheap
        // legacy mirror columns instead).
        dob: investors.dob,
        gender: investors.gender,
        email: investors.email,
        phone: investors.phone,
        occupation: investors.occupation,
        riskProfile: investors.riskProfile,
        panAadhaarLinkStatus: investors.panAadhaarLinkStatus,
        rmId: investors.rmId,
        nomineeName: investors.nomineeName,
        bankName: investors.bankName,
        address: investors.address,
      })
      .from(investors)
      .where(where as any)
      .orderBy(
        // The birthday view reads by DATE — 1st of the month first — so the
        // ones already past sit at the top and the rest are a plan for the
        // month. Ordered in SQL, not after the fetch: page 1 of a 200-client
        // month has to be the 1st–Nth, not an arbitrary 50 sorted among
        // themselves. An explicit column click still wins.
        birthdayView && !sp.sort
          ? sql`EXTRACT(DAY FROM ${investors.dob}) ASC`
          : sortKey === "name"
          ? (dir === "asc" ? asc(investors.name) : desc(investors.name))
          : sortKey === "sip"
            ? (dir === "asc" ? asc(investors.activeSipAmount) : desc(investors.activeSipAmount))
            : sortKey === "review"
              ? sql`${investors.nextReviewAt} ${sql.raw(dir)} nulls last`
              : sortKey === "health"
                ? (dir === "asc" ? asc(investors.healthScore) : desc(investors.healthScore))
                : sortKey === "created"
                  ? (dir === "asc" ? asc(investors.createdAt) : desc(investors.createdAt))
                  : (dir === "asc" ? asc(investors.aum) : desc(investors.aum))
      )
      .limit(view === "kanban" ? 300 : PAGE_SIZE)
      .offset(view === "kanban" ? 0 : (page - 1) * PAGE_SIZE);

    const c = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(investors)
      .where(where as any);

    // Every matching id (not just this page) — powers "Select all N clients"
    // for bulk actions across the whole filtered book. Capped for safety.
    const allIdRows = await tx
      .select({ id: investors.id })
      .from(investors)
      .where(where as any)
      .limit(20000);
    const allIds = allIdRows.map((x) => x.id);

    // For the Kanban, also fetch each investor's blueprint stage. We join
    // through the source lead (leads.converted_investor_id = investor.id)
    // to lead_blueprint_instances. Direct-import investors get a NULL
    // leadId and fall back to "add_in_review_sheet" (Active Client).
    let kanbanRows: InvestorRow[] = [];
    if (view === "kanban") {
      const ids = r.map((i) => i.id);
      const stageMap: Record<string, { leadId: string; stageKey: string }> = {};
      if (ids.length > 0) {
        // Drizzle's sql template expands a JS array into $1, $2, …, $N — so
        // `${ids}::uuid[]` produces `($1,$2,…)::uuid[]` which is invalid SQL.
        // Build an explicit IN list with per-value uuid casts via sql.join.
        const idParams = sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `
        );
        const stageRows = await tx.execute(sql`
          SELECT l.id AS lead_id, l.converted_investor_id AS investor_id,
                 lbi.current_stage_key AS stage_key
          FROM leads l
          INNER JOIN lead_blueprint_instances lbi ON lbi.lead_id = l.id
          WHERE l.converted_investor_id IN (${idParams})
        `);
        for (const row of stageRows.rows as any[]) {
          stageMap[row.investor_id] = { leadId: row.lead_id, stageKey: row.stage_key };
        }
      }
      kanbanRows = r.map((i) => {
        const linked = stageMap[i.id];
        return {
          investor: {
            id: i.id,
            name: i.name,
            pan: showPan ? i.pan : "—",
            segmentTag: showSegment ? i.segmentTag : null,
            serviceTier: showTier ? i.serviceTier : null,
            aum: showAum ? (i.aum != null ? String(i.aum) : null) : null,
            activeSipAmount: showSip ? (i.activeSipAmount != null ? String(i.activeSipAmount) : null) : null,
            kycStatus: showKyc ? i.kycStatus : null,
            status: showStatus ? i.status : "—",
            updatedAt: i.updatedAt,
          },
          leadId: linked?.leadId ?? null,
          stageKey: linked?.stageKey ?? "add_in_review_sheet",
        };
      });
    }

    // Roster for the "RM" book-slice filter (owners/branch-heads only).
    let rms: any[] = [];
    if (canViewAll) {
      const rmRes = await tx.execute(sql`
        SELECT id, name FROM users
        WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
        AND ${await usersInScopeSql(tx, session)}
        ORDER BY name ASC
      `);
      rms = rmRes.rows as any[];
    }

    // Possible-duplicate count (same PAN / mobile) — surfaced as a banner.
    const dupCount = await countPossibleDuplicates(tx as any, session.tenantId);

    // Options for the sub-branch / RM picker. Loaded only for sessions that
    // get the picker — an RM sees their own book whatever it said.
    const { units: scopeUnits } = showScopePicker
      ? await loadScopeUnits(tx, session)
      : { units: [] };
    const scopeMembers = showScopePicker ? await loadScopeMembers(tx, session, scopeSel) : [];

    // Headline counts — the whole visible book, not the list's search / filter
    // state, under the same wall and sub-branch pick as the list.
    const kpiRes = await tx.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE investors.created_at::date = CURRENT_DATE)::int AS added_today,
        COUNT(*) FILTER (WHERE investors.status = 'active')::int AS active,
        COUNT(*) FILTER (WHERE investors.next_review_at IS NOT NULL AND investors.next_review_at < now())::int AS review_due
      FROM investors
      WHERE investors.tenant_id = ${session.tenantId}::uuid
        AND investors.deleted_at IS NULL
        AND ${await investorScopeSql(tx, session, "investors")}
        AND ${viewScope}
    `);
    const kpi = (kpiRes.rows[0] as { total: number; added_today: number; active: number; review_due: number } | undefined) ?? { total: 0, added_today: 0, active: 0, review_due: 0 };

    return { rows: r, total: Number(c[0]?.c ?? 0), kanbanRows, rms, allIds, dupCount, scopeUnits, scopeMembers, kpi };
  }, { userId: session.userId, branchId: session.branchId, roles: session.roles });

  const rmOptions = (rms ?? []).map((r: any) => ({ value: String(r.id), label: r.name ?? "—" }));

  // Table rows read the PERSISTED health score (written on create/update +
  // refreshed nightly) so the displayed value matches the DB-level sort and
  // pagination exactly. `dormDays` stays live (cheap, derived).
  const tableRows: InvestorTableRow[] = rows.map((i) => ({
    id: i.id,
    name: i.name,
    avatarUrl: i.avatarUrl ?? null,
    pan: showPan ? i.pan : null,
    clientCategory: i.clientCategory ?? null,
    serviceTier: showTier ? i.serviceTier : null,
    segmentTag: showSegment ? i.segmentTag : null,
    aum: showAum ? Number(i.aum ?? 0) : 0,
    sip: showSip ? Number(i.activeSipAmount ?? 0) : 0,
    kycStatus: showKyc ? i.kycStatus : null,
    status: showStatus ? i.status : null,
    healthScore: i.healthScore ?? 100,
    healthBand: (i.healthBand as HealthBand) ?? "green",
    dormDays: dormancyDays(i as any),
    completeness: clientCompleteness(i as any).score,
    dob: birthdayView ? (i.dob as any) ?? null : null,
  }));

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clients</h1>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {/* View toggle — Table vs Kanban. Mirrors the leads page pattern.
              `view=kanban` query param drives the server-side query (loads
              blueprint stages too) and which component renders below. */}
          <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-0.5 gap-0.5 mr-1">
            <Link
              href="/dashboard/investors"
              className={`px-2.5 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${view === "table"
                ? "bg-card shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
                }`}
            >
              <List className="size-3.5" /> Table
            </Link>
            <Link
              href="/dashboard/investors?view=kanban"
              className={`px-2.5 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${view === "kanban"
                ? "bg-card shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
                }`}
            >
              <LayoutGrid className="size-3.5" /> Kanban
            </Link>
          </div>
          <span className="hidden sm:block"><RecomputeTiersButton /></span>
          <DownloadButton
            url={`/api/investors/export${exportQs ? `?${exportQs}` : ""}`}
            className="hidden sm:flex rounded-md border px-3 py-1.5 text-sm items-center gap-1.5 hover:bg-accent"
            title="Download the current (filtered) book as an Excel file"
          >
            <FileUp className="size-4" /> Export
          </DownloadButton>
          <Link
            href="/dashboard/investors/import"
            className="hidden sm:flex rounded-md border px-3 py-1.5 text-sm items-center gap-1.5"
          >
            <FileDown className="size-4" /> Import
          </Link>
          <Link
            href="/dashboard/investors/new"
            className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
          >
            <Plus className="size-4" /> Add client
          </Link>
        </div>
      </div>

      {/* Says what the list is, and how to get out of it. Landing on a silently
          filtered client table reads as "the filter didn't work". */}
      {birthdayView && (
        <div className="card-surface p-3 flex items-center gap-3 flex-wrap border-l-4 border-l-rose-400">
          <Cake className="size-5 text-rose-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">Birthdays in {monthLabel}</div>
            <div className="text-xs text-muted-foreground">
              {total} client{total === 1 ? "" : "s"} with a birthday this month, earliest first.
            </div>
          </div>
          <Link href="/dashboard/investors" className="btn-secondary text-xs shrink-0">
            Show all clients
          </Link>
        </div>
      )}

      {/* Possible-duplicate nudge — managers can merge from the duplicates tool.
          Especially relevant now the importer allows duplicate PANs on purpose. */}
      {canViewAll && (dupCount ?? 0) > 0 && (
        <Link
          href="/dashboard/duplicates"
          className="flex items-center gap-2.5 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/30 px-4 py-2.5 text-sm hover:bg-amber-100/70 transition-colors"
        >
          <CopyPlus className="size-4 text-amber-600 shrink-0" />
          <span className="text-amber-800 dark:text-amber-200">
            <strong>{dupCount}</strong> client{dupCount === 1 ? "" : "s"} look like possible duplicates (same PAN or mobile).
          </span>
          <span className="ml-auto text-xs font-medium text-amber-700 dark:text-amber-300">Review &amp; merge →</span>
        </Link>
      )}

      {/* Quick-filter chips — hidden for now (re-enable later). */}
      {/* <div className="card-surface p-3">
        <InvestorQuickFilters
          session={session}
          active={sp as Record<string, string | undefined>}
        />
      </div> */}

      <ModuleKpis
        items={[
          { label: "Total clients", value: Number(kpi.total), icon: Users },
          { label: "Added today", value: Number(kpi.added_today), icon: CalendarPlus },
          { label: "Active", value: Number(kpi.active), icon: CheckCircle2, tone: "emerald" },
          { label: "Review overdue", value: Number(kpi.review_due), icon: CalendarClock, tone: "rose" },
        ]}
      />

      {showScopePicker && (
        <ScopeFilterBar
          basePath="/dashboard/investors"
          units={scopeUnits}
          members={scopeMembers}
          selectedUnit={scopeSel.unit}
          selectedMember={scopeSel.rm}
        />
      )}

      <CompactFilterBar
        totalCount={total}
        searchPlaceholder="Search by name, PAN, phone…"
        filters={[
          {
            type: "multi",
            key: "segment",
            label: "Segment",
            options: [
              { value: "HNI", label: "HNI" },
              { value: "Affluent", label: "Affluent" },
              { value: "Retail", label: "Retail" },
              { value: "NRI", label: "NRI" },
              { value: "Corporate", label: "Corporate" },
            ],
          },
          {
            type: "multi",
            key: "category",
            label: "Client Category",
            options: [
              { value: "A", label: "Category A" },
              { value: "B", label: "Category B" },
              { value: "C", label: "Category C" },
              { value: "D", label: "Category D" },
            ],
          },
          {
            type: "multi",
            key: "tier",
            label: "Service tier",
            options: [
              { value: "A", label: "A — Quarterly" },
              { value: "B", label: "B — Half-yearly" },
              { value: "C", label: "C — Annual" },
            ],
          },
          {
            type: "multi",
            key: "kyc",
            label: "KYC",
            options: [
              { value: "verified", label: "Verified" },
              { value: "pending", label: "Pending" },
              { value: "expired", label: "Expired" },
              { value: "rejected", label: "Rejected" },
            ],
          },
          {
            type: "multi",
            key: "status",
            label: "Status",
            options: [
              { value: "active", label: "Active" },
              { value: "dormant", label: "Dormant" },
              { value: "inactive", label: "Inactive" },
              { value: "deceased", label: "Deceased" },
              { value: "closed", label: "Closed" },
            ],
          },
          ...(canViewAll && rmOptions.length
            ? [{ type: "multi" as const, key: "rm", label: "RM", options: rmOptions }]
            : []),
          dateRangeFilter("created", "Added"),
        ]}
        rightSlot={
          <div className="flex items-center gap-2">
            {view === "table" && <InvestorSortSelect sort={sortKey} dir={dir} />}
            {view === "table" && (
              <ColumnManager compact moduleKey="investors" columns={allowedColumns} />
            )}
            <CustomViews
              compact
              viewsKey="views:investors"
              presets={[
                { id: "hni", name: "HNI clients", params: "segment=HNI" },
                { id: "kyc-pending", name: "KYC pending", params: "kyc=pending,expired" },
                { id: "tier-a", name: "Tier A (quarterly)", params: "tier=A" },
              ]}
            />
          </div>
        }
      />

      {view === "kanban" ? (
        <div className="card-surface p-3">
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <LayoutGrid className="size-3.5" />
              <span className="font-medium">Client onboarding pipeline</span>
              <span>·</span>
              <span>{kanbanRows.length} clients</span>
            </div>
            <span className="text-[11px] text-muted-foreground">
              Drag a card to move stages (works for clients converted from a lead)
            </span>
          </div>
          {kanbanRows.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              No clients yet — add some or convert a lead to populate the pipeline.
            </div>
          ) : (
            <InvestorsKanban initialRows={kanbanRows} />
          )}
        </div>
      ) : rows.length === 0 ? (
        // Brand-new tenant with zero investors AND no active filter → big friendly EmptyState.
        // Otherwise just a short "no matches" line so the filter UI stays in context.
        <div className="card-surface overflow-hidden">
          {total === 0 && !q && !segment.length && !tier.length && !status.length && !kyc.length ? (
            <div className="p-6">
              <EmptyState
                icon={Users}
                title="No clients yet — let's add the first one"
                description="A client is anyone whose money you manage. Add them one at a time, or save hours by importing your existing book from Excel."
                tip="Already have a list in Excel? Use Import — the wizard maps columns automatically and warns you about KYC gaps."
                primary={{ href: "/dashboard/investors/new", label: "+ Add first client" }}
                secondary={{ href: "/dashboard/investors/import", label: "Import from Excel" }}
                learnMoreAnchor="kyc"
              />
            </div>
          ) : (
            <div className="p-12 text-center text-sm text-muted-foreground">
              {/* Name what was filtered on, so an empty result reads as "this
                  filter found nothing" rather than "the list is broken". */}
              {activeFilterLabel ? (
                <>
                  No <span className="font-medium text-foreground">{activeFilterLabel}</span> clients.{" "}
                  <Link href="/dashboard/investors" className="text-brand-cyan-deep hover:underline">
                    Clear filters
                  </Link>
                </>
              ) : (
                <>
                  No investors match these filters.{" "}
                  <Link href="/dashboard/investors/new" className="text-brand-cyan-deep hover:underline">
                    Add one manually
                  </Link>
                </>
              )}
              .
            </div>
          )}
        </div>
      ) : (
        <div>
          <InvestorsTable
            rows={tableRows}
            sort={sortKey}
            dir={dir}
            allIds={allIds}
            total={total}
            flags={{ showPan, showCategory: true, showTier, showSegment, showAum, showSip, showKyc, showStatus, showBirthday: birthdayView }}
          />
          <Pager
            page={page}
            totalPages={Math.ceil(total / PAGE_SIZE)}
            total={total}
            pageSize={PAGE_SIZE}
          />
        </div>
      )}
    </div>
  );
}
