import Link from "next/link";
import { sql } from "drizzle-orm";
import { Plus, LifeBuoy, FileText, CircleDot, CheckCircle2, AlarmClock } from "lucide-react";
import { ModuleKpis } from "@/components/modules/ModuleKpis";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { investorScopeSql } from "@/lib/investors/access";
import { ServiceRequestsTable } from "@/components/service-requests/ServiceRequestsTable";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { ScopeFilterBar } from "@/components/common/ScopeFilterBar";
import { usersInScopeSql } from "@/lib/auth/data-scope";
import { parseScope, scopeFilterSql, loadScopeUnits, loadScopeMembers, canPickScope } from "@/lib/scope/view-filter";
import { dateRangeCond } from "@/lib/filters/date-range";
import { CustomViews } from "@/components/common/CustomViews";
import { ColumnManager } from "@/components/common/ColumnManager";

const SR_COLUMNS = [
  { key: "ticket", label: "Ticket", required: true },
  { key: "client", label: "Client", required: true },
  { key: "type", label: "Service Type" },
  { key: "raised", label: "Raised on" },
  { key: "assignee", label: "Assigned to" },
  { key: "priority", label: "Priority" },
  { key: "status", label: "Status" },
  { key: "expected", label: "Expected resolution" },
  { key: "closed", label: "Closed on", defaultHidden: true },
  { key: "tat", label: "Age (days)" },
  { key: "remarks", label: "Remarks", defaultHidden: true },
  { key: "attachments", label: "Attachments", defaultHidden: true },
  { key: "actions", label: "Actions", required: true },
];

const TYPE_LABEL: Record<string, string> = {
  nominee_update: "Nominee Update",
  bank_update: "Bank Update",
  mobile_update: "Mobile Update",
  email_update: "Email Update",
  kyc_update: "KYC Update",
  minor_to_major: "Minor to Major",
  capital_gain_report: "Capital Gain Report",
  statement_request: "Statement Request",
  redemption_request: "Redemption Request",
  switch_request: "Switch Request",
  transmission_case: "Transmission Case",
  folio_correction: "Folio Correction",
  other: "Other",
  // Legacy
  complaint: "Complaint",
  redemption_help: "Redemption Request",
  switch_help: "Switch Request",
  transaction_query: "Other",
};

export const dynamic = "force-dynamic";

export default async function ServiceRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = (sp.status ?? "").split(",").filter(Boolean);
  const priority = (sp.priority ?? "").split(",").filter(Boolean);
  const srType = (sp.srtype ?? "").split(",").filter(Boolean);
  const breached = sp.breached === "1";
  const mine = sp.mine === "1";
  const assigneeFilter = (sp.assignee ?? "").split(",").filter(Boolean);

  // Build WHERE conditions
  const scopeSel = parseScope(sp as Record<string, string | undefined>);
  const showScopePicker = canPickScope(session);

  const conds: any[] = [sql`sr.tenant_id = ${session.tenantId}::uuid`];
  // Sub-branch / RM view filter. A ticket sits with whoever is working it;
  // an unassigned one falls back to the client's own RM, so it still appears
  // under the desk that will have to pick it up.
  conds.push(scopeFilterSql(scopeSel, session.tenantId, ["sr.assigned_to_user_id", "i.rm_id"]));
  if (mine) conds.push(sql`sr.assigned_to_user_id = ${session.userId}::uuid`);
  if (assigneeFilter.length)
    conds.push(sql`sr.assigned_to_user_id IN (${sql.join(assigneeFilter.map((v) => sql`${v}::uuid`), sql`, `)})`);
  if (q) {
    conds.push(
      sql`(sr.ticket_no ILIKE ${`%${q}%`} OR sr.subject ILIKE ${`%${q}%`} OR i.name ILIKE ${`%${q}%`} OR u.name ILIKE ${`%${q}%`})`
    );
  }
  if (status.length)
    conds.push(sql`sr.status IN (${sql.join(status.map((v) => sql`${v}`), sql`, `)})`);
  if (priority.length)
    conds.push(sql`sr.priority IN (${sql.join(priority.map((v) => sql`${v}`), sql`, `)})`);
  if (srType.length)
    conds.push(sql`sr.type IN (${sql.join(srType.map((v) => sql`${v}`), sql`, `)})`);
  if (breached) conds.push(sql`sr.status NOT IN ('resolved','closed') AND sr.sla_resolution_at < now()`);
  const dr = dateRangeCond(sp, "created", "sr.created_at");
  if (dr) conds.push(dr);
  const result = await withTenant(session.tenantId, async (tx) => {
    // The client data wall. RLS isolates by TENANT only, so without this every
    // RM saw every client's tickets. A ticket ASSIGNED to this user stays
    // visible whoever the client belongs to — that's their own work queue, and
    // it's how a back-office ticket on another RM's client reaches them.
    // A role with no client-view capability at all falls back to "assigned to
    // me", rather than the page 500-ing.
    const clientScope = await investorScopeSql(tx, session, "i").catch(() => sql`FALSE`);
    conds.push(sql`(${clientScope} OR sr.assigned_to_user_id = ${session.userId}::uuid)`);
    const whereClause = sql`WHERE ${sql.join(conds, sql` AND `)}`;

    const rows = await tx.execute(sql`
      SELECT sr.id, sr.ticket_no, sr.investor_id, sr.type, sr.subject, sr.description,
             sr.status, sr.priority, sr.assigned_to_user_id,
             sr.sla_response_at, sr.sla_resolution_at, sr.responded_at, sr.resolved_at,
             sr.escalated_at, sr.escalated_to_user_id, sr.remarks,
             jsonb_array_length(COALESCE(sr.attachments, '[]'::jsonb)) AS attach_count,
             sr.created_at,
             i.name AS investor_name, i.avatar_url AS investor_avatar_url, u.name AS assignee_name,
             CASE
               WHEN sr.resolved_at IS NOT NULL
                 THEN EXTRACT(DAY FROM sr.resolved_at - sr.created_at)::int
               ELSE EXTRACT(DAY FROM now() - sr.created_at)::int
             END AS tat_days,
             (sr.status NOT IN ('resolved','closed') AND sr.sla_resolution_at < now()) AS breached
      FROM service_requests sr
      LEFT JOIN investors i ON i.id = sr.investor_id
      LEFT JOIN users u ON u.id = sr.assigned_to_user_id
      ${whereClause}
      ORDER BY sr.created_at DESC
      LIMIT 200
    `);

    const rmRows = await tx.execute(sql`
      SELECT id, name FROM users
      WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
        AND ${await usersInScopeSql(tx, session)}
      ORDER BY name ASC
    `);
    const { units: scopeUnits } = showScopePicker ? await loadScopeUnits(tx, session) : { units: [] };
    const scopeMembers = showScopePicker ? await loadScopeMembers(tx, session, scopeSel) : [];
    // Headline counts under the same wall and sub-branch pick, but not the
    // list's own status / search filters.
    const kpiRes = await tx.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE sr.status NOT IN ('resolved', 'closed'))::int AS open,
        COUNT(*) FILTER (WHERE sr.status IN ('resolved', 'closed'))::int AS resolved,
        COUNT(*) FILTER (WHERE sr.status NOT IN ('resolved', 'closed') AND sr.sla_resolution_at < now())::int AS breached
      FROM service_requests sr
      LEFT JOIN investors i ON i.id = sr.investor_id
      WHERE sr.tenant_id = ${session.tenantId}::uuid
        AND (${clientScope} OR sr.assigned_to_user_id = ${session.userId}::uuid)
        AND ${scopeFilterSql(scopeSel, session.tenantId, ["sr.assigned_to_user_id", "i.rm_id"])}
    `);
    const kpi = (kpiRes.rows[0] as { total: number; open: number; resolved: number; breached: number } | undefined) ?? { total: 0, open: 0, resolved: 0, breached: 0 };
    return { rows: rows.rows as any[], rms: rmRows.rows as any[], scopeUnits, scopeMembers, kpi };
  });

  const rmOptions = (result.rms ?? []).map((r: any) => ({ value: String(r.id), label: r.name ?? "—" }));

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <LifeBuoy className="size-6 text-brand-cyan" /> Service Requests
          </h1>
          <p className="text-muted-foreground text-sm">
            Track every client request and complaint with a deadline — overdue tickets escalate automatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/complaints/disclosure" className="btn-secondary text-xs">
            <FileText className="size-3.5" /> Complaint disclosure
          </Link>
          <Link href="/dashboard/service-requests/new" className="btn-primary">
            <Plus className="size-4" /> New ticket
          </Link>
        </div>
      </div>

      <ModuleKpis
        items={[
          { label: "Total requests", value: Number(result.kpi.total), icon: LifeBuoy },
          { label: "Open", value: Number(result.kpi.open), icon: CircleDot },
          { label: "Resolved", value: Number(result.kpi.resolved), icon: CheckCircle2, tone: "emerald" },
          { label: "SLA breached", value: Number(result.kpi.breached), icon: AlarmClock, tone: "rose" },
        ]}
      />

      {showScopePicker && (
        <ScopeFilterBar
          basePath="/dashboard/service-requests"
          units={result.scopeUnits}
          members={result.scopeMembers}
          selectedUnit={scopeSel.unit}
          selectedMember={scopeSel.rm}
        />
      )}

      <CompactFilterBar
        searchPlaceholder="Search ticket #, subject, or client…"
        totalCount={result.rows.length}
        filters={[
          {
            type: "multi",
            key: "status",
            label: "Status",
            options: [
              { value: "open", label: "Open" },
              { value: "in_progress", label: "In progress" },
              { value: "waiting_customer", label: "Waiting customer" },
              { value: "resolved", label: "Resolved" },
              { value: "closed", label: "Closed" },
              { value: "escalated", label: "Escalated" },
            ],
          },
          {
            type: "multi",
            key: "priority",
            label: "Priority",
            options: [
              { value: "urgent", label: "Urgent" },
              { value: "high", label: "High" },
              { value: "normal", label: "Normal" },
              { value: "low", label: "Low" },
            ],
          },
          {
            type: "multi",
            key: "srtype",
            label: "Type",
            options: Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label })),
          },
          {
            type: "multi",
            key: "breached",
            label: "SLA",
            options: [{ value: "1", label: "Breached — past SLA" }],
          },
          {
            type: "multi",
            key: "mine",
            label: "Owner",
            options: [{ value: "1", label: "My tickets" }],
          },
          ...(rmOptions.length
            ? [{ type: "multi" as const, key: "assignee", label: "Assignee", options: rmOptions }]
            : []),
          { type: "date_range" as const, key: "created", label: "Date" },
        ]}
        rightSlot={
          <div className="flex items-center gap-2">
            <ColumnManager moduleKey="service-requests" columns={SR_COLUMNS} />
            <CustomViews
              viewsKey="views:service-requests"
              presets={[
                { id: "open", name: "Open + In-progress", params: "status=open,in_progress" },
                { id: "complaints", name: "Complaints (SEBI register)", params: "srtype=complaint" },
                { id: "mine", name: "My open tickets", params: "mine=1&status=open,in_progress,waiting_customer" },
                { id: "breached", name: "Breached", params: "breached=1" },
                { id: "urgent", name: "Urgent priority", params: "priority=urgent,high" },
              ]}
            />
          </div>
        }
      />

      <ServiceRequestsTable rows={result.rows} />
    </div>
  );
}
