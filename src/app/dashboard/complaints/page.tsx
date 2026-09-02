import Link from "next/link";
import { sql } from "drizzle-orm";
import { AlertOctagon, Clock, AlertTriangle, CheckCircle2, Shield, FileText } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/utils";
import { ResolutionEditor } from "@/components/complaints/ResolutionEditor";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { dateRangeCond, dateRangeFilter } from "@/lib/filters/date-range";
import { CustomViews } from "@/components/common/CustomViews";
import { StatusChip, type Tone } from "@/components/common/StatusChip";

const STATUS_TONE: Record<string, Tone> = {
  open: "info",
  in_progress: "warning",
  waiting_customer: "neutral",
  resolved: "success",
  closed: "neutral",
  escalated: "danger",
};

const PRIORITY_TONE: Record<string, Tone> = {
  urgent: "danger",
  high: "warning",
  normal: "neutral",
  low: "neutral",
};

const CATEGORY_LABEL: Record<string, string> = {
  service: "Service / TAT", mis_selling: "Mis-selling", transaction: "Transaction / order",
  fee: "Fee / commission", kyc: "KYC / documents", communication: "Communication", other: "Other",
};
const SOURCE_LABEL: Record<string, string> = {
  direct: "Direct", scores: "SCORES", amfi: "AMFI", amc: "AMC", email: "Email", phone: "Phone", walk_in: "Walk-in", other: "Other",
};

export const dynamic = "force-dynamic";

export default async function ComplaintsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const statusFilter = (sp.status ?? "").split(",").filter(Boolean);
  const priorityFilter = (sp.priority ?? "").split(",").filter(Boolean);
  const categoryFilter = (sp.category ?? "").split(",").filter(Boolean);
  const sourceFilter = (sp.source ?? "").split(",").filter(Boolean);
  const breachedOnly = sp.breached === "1";

  const data = await withTenant(session.tenantId, async (tx) => {
    const filters: any[] = [sql`sr.type = 'complaint'`, sql`sr.tenant_id = ${session.tenantId}::uuid`];
    if (q) {
      filters.push(
        sql`(sr.ticket_no ILIKE ${`%${q}%`} OR sr.subject ILIKE ${`%${q}%`} OR sr.description ILIKE ${`%${q}%`} OR i.name ILIKE ${`%${q}%`})`
      );
    }
    if (statusFilter.length) {
      filters.push(
        sql`sr.status IN (${sql.join(statusFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (priorityFilter.length) {
      filters.push(
        sql`sr.priority IN (${sql.join(priorityFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (categoryFilter.length) {
      filters.push(
        sql`sr.sebi_category IN (${sql.join(categoryFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (sourceFilter.length) {
      filters.push(
        sql`sr.complaint_source IN (${sql.join(sourceFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (breachedOnly) {
      filters.push(
        sql`(sr.status NOT IN ('resolved','closed') AND sr.sla_resolution_at < now())`
      );
    }
    const dr = dateRangeCond(sp, "created", "sr.created_at");
    if (dr) filters.push(dr);
    const whereSql = sql.join(filters, sql` AND `);

    const stats = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('open', 'in_progress', 'escalated'))::int AS open,
        COUNT(*) FILTER (WHERE status IN ('resolved','closed')
          AND resolved_at >= now() - interval '30 days')::int AS resolved_30d,
        COUNT(*) FILTER (WHERE status IN ('open', 'in_progress')
          AND sla_resolution_at IS NOT NULL
          AND sla_resolution_at < now())::int AS breached,
        COUNT(*) FILTER (WHERE status = 'escalated' OR escalated_at IS NOT NULL)::int AS escalated,
        ROUND(
          AVG(EXTRACT(DAY FROM resolved_at - created_at))
            FILTER (WHERE resolved_at IS NOT NULL)::numeric,
          1
        ) AS avg_resolution_days
      FROM service_requests
      WHERE tenant_id = ${session.tenantId}::uuid AND type = 'complaint'
    `);
    const s = stats.rows[0] as any;

    const rows = await tx.execute(sql`
      SELECT sr.id, sr.ticket_no, sr.investor_id, sr.subject, sr.description,
             sr.sebi_category, sr.sebi_sub_category, sr.complaint_source, sr.scores_ref_no,
             sr.status, sr.priority, sr.assigned_to_user_id,
             sr.sla_resolution_at, sr.resolved_at, sr.escalated_at, sr.escalated_to_user_id,
             sr.resolution_notes,
             jsonb_array_length(COALESCE(sr.attachments, '[]'::jsonb)) AS attach_count,
             sr.created_at,
             i.name AS investor_name, i.pan AS investor_pan,
             u.name AS assignee_name, u2.name AS escalated_to_name,
             (sr.status NOT IN ('resolved','closed') AND sr.sla_resolution_at < now()) AS breached,
             EXTRACT(DAY FROM COALESCE(sr.resolved_at, now()) - sr.created_at)::int AS tat_days
      FROM service_requests sr
      LEFT JOIN investors i ON i.id = sr.investor_id
      LEFT JOIN users u ON u.id = sr.assigned_to_user_id
      LEFT JOIN users u2 ON u2.id = sr.escalated_to_user_id
      WHERE ${whereSql}
      ORDER BY sr.created_at DESC
      LIMIT 200
    `);

    return {
      open: Number(s.open),
      resolved30d: Number(s.resolved_30d),
      breached: Number(s.breached),
      escalated: Number(s.escalated),
      avgResolutionDays: s.avg_resolution_days,
      rows: rows.rows as any[],
    };
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="size-6 text-brand-cyan" /> Complaint Register
          </h1>
          <p className="text-muted-foreground text-sm">
            SEBI-format complaint log · 21-day TAT clock · required for DDQ readiness.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/complaints/disclosure" className="btn-secondary text-xs">
            <FileText className="size-3.5" /> Monthly disclosure
          </Link>
          <Link href="/dashboard/reports/complaint_category" className="btn-secondary text-xs">
            <FileText className="size-3.5" /> Category report
          </Link>
          <Link href="/dashboard/service-requests/new?type=complaint" className="btn-primary">
            Log complaint
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-3">
        <Stat icon={AlertOctagon} label="Open complaints" value={data.open} tone={data.open > 0 ? "amber" : "muted"} />
        <Stat icon={CheckCircle2} label="Resolved (30d)" value={data.resolved30d} tone="emerald" />
        <Stat icon={AlertTriangle} label="SLA breached" value={data.breached} tone={data.breached > 0 ? "rose" : "muted"} />
        <Stat icon={AlertTriangle} label="Escalated" value={data.escalated} tone={data.escalated > 0 ? "rose" : "muted"} />
        <Stat icon={Clock} label="Avg TAT (days)" value={data.avgResolutionDays ?? "—"} tone="emerald" />
      </div>

      <CompactFilterBar
        totalCount={data.rows.length}
        filters={[
          { type: "search", key: "q", placeholder: "Search by ticket no, subject, client…" },
          {
            type: "multi",
            key: "status",
            label: "Status",
            options: [
              { value: "open", label: "Open" },
              { value: "in_progress", label: "In progress" },
              { value: "waiting_customer", label: "Waiting customer" },
              { value: "escalated", label: "Escalated" },
              { value: "resolved", label: "Resolved" },
              { value: "closed", label: "Closed" },
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
            key: "category",
            label: "SEBI category",
            options: [
              { value: "service", label: "Service" },
              { value: "mis_selling", label: "Mis-selling" },
              { value: "transaction", label: "Transaction" },
              { value: "fee", label: "Fee" },
              { value: "kyc", label: "KYC" },
              { value: "communication", label: "Communication" },
              { value: "other", label: "Other" },
            ],
          },
          {
            type: "multi",
            key: "source",
            label: "Source",
            options: [
              { value: "direct", label: "Direct" },
              { value: "scores", label: "SCORES" },
              { value: "amfi", label: "AMFI" },
              { value: "amc", label: "AMC" },
              { value: "email", label: "Email" },
              { value: "phone", label: "Phone" },
              { value: "walk_in", label: "Walk-in" },
            ],
          },
          dateRangeFilter("created", "Logged"),
        ]}
        rightSlot={
          <CustomViews
            viewsKey="views:complaints"
            presets={[
              { id: "open", name: "Open", params: "status=open,in_progress,escalated" },
              { id: "breached", name: "SLA breached", params: "breached=1" },
              { id: "urgent", name: "Urgent priority", params: "priority=urgent,high" },
              { id: "resolved", name: "Resolved", params: "status=resolved,closed" },
            ]}
          />
        }
      />

      <div className="card-surface">
        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <AlertOctagon className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2 font-medium">No complaints logged.</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              The complaint register is required for SEBI inspection. Logged complaints carry a
              21-day resolution SLA.
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Complaint ID</th>
                  <th className="text-left py-2 font-medium">Client</th>
                  <th className="text-left py-2 font-medium">Date</th>
                  <th className="text-left py-2 font-medium">Category</th>
                  <th className="text-left py-2 font-medium">Source</th>
                  <th className="text-left py-2 font-medium">Description</th>
                  <th className="text-left py-2 font-medium">Assigned to</th>
                  <th className="text-left py-2 font-medium">Priority</th>
                  <th className="text-left py-2 font-medium">Due</th>
                  <th className="text-left py-2 font-medium">Status</th>
                  <th className="text-left py-2 font-medium">Closed</th>
                  <th className="text-right py-2 font-medium">TAT (d)</th>
                  <th className="text-left py-2 font-medium">Escalated</th>
                  <th className="text-left py-2 font-medium">Resolution notes</th>
                  <th className="text-right py-2 font-medium pr-4">Docs</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr
                    key={r.id}
                    className={`border-b last:border-0 relative hover:bg-secondary/40 ${
                      r.breached ? "bg-rose-50/30" : ""
                    }`}
                  >
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                      <Link href={`/dashboard/service-requests/${r.id}`} className="hover:underline text-brand-cyan-deep">{r.ticket_no}</Link>
                    </td>
                    <td className="py-3 whitespace-nowrap">
                      {r.investor_id ? (
                        <Link href={`/dashboard/investors/${r.investor_id}`} className="hover:underline font-medium">
                          {r.investor_name}
                        </Link>
                      ) : (
                        r.investor_name ?? "—"
                      )}
                      <div className="text-[11px] text-muted-foreground font-mono">{r.investor_pan}</div>
                    </td>
                    <td className="py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {formatDate(r.created_at)}
                    </td>
                    <td className="py-3 text-xs">
                      <div className="font-medium">{CATEGORY_LABEL[r.sebi_category] ?? r.sebi_category ?? "Other"}</div>
                      {r.sebi_sub_category && (
                        <div className="text-[11px] text-muted-foreground">{r.sebi_sub_category}</div>
                      )}
                    </td>
                    <td className="py-3 text-xs whitespace-nowrap">
                      {SOURCE_LABEL[r.complaint_source] ?? "—"}
                      {r.scores_ref_no && (
                        <div className="text-[10px] text-muted-foreground font-mono">{r.scores_ref_no}</div>
                      )}
                    </td>
                    <td className="py-3 text-xs max-w-[220px]">
                      <div className="font-medium truncate">{r.subject}</div>
                      {r.description && (
                        <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                          {r.description}
                        </div>
                      )}
                    </td>
                    <td className="py-3 text-xs whitespace-nowrap">{r.assignee_name ?? "—"}</td>
                    <td className="py-3">
                      <StatusChip tone={PRIORITY_TONE[r.priority] ?? "neutral"} className="capitalize">
                        {r.priority}
                      </StatusChip>
                    </td>
                    <td className="py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {r.sla_resolution_at ? formatDate(r.sla_resolution_at) : "—"}
                    </td>
                    <td className="py-3">
                      <StatusChip tone={STATUS_TONE[r.status] ?? "neutral"} className="capitalize">
                        {r.status.replace(/_/g, " ")}
                      </StatusChip>
                    </td>
                    <td className="py-3 text-xs whitespace-nowrap">
                      {r.resolved_at ? (
                        <span className="text-emerald-600 font-medium tabular-nums">
                          {formatDate(r.resolved_at)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 text-right tabular-nums">
                      {r.breached ? (
                        <span className="text-rose-600 font-bold">{r.tat_days}</span>
                      ) : r.resolved_at ? (
                        <span className="text-emerald-600 font-medium">{r.tat_days}</span>
                      ) : (
                        <span className="text-muted-foreground">{r.tat_days}</span>
                      )}
                    </td>
                    <td className="py-3 text-xs whitespace-nowrap">
                      {r.escalated_at ? (
                        <div>
                          <StatusChip tone="danger">Yes</StatusChip>
                          {r.escalated_to_name && (
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                              → {r.escalated_to_name}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-3 relative">
                      <ResolutionEditor
                        ticketId={r.id}
                        initialNotes={r.resolution_notes ?? null}
                        isResolved={["resolved", "closed"].includes(r.status)}
                      />
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums text-muted-foreground">
                      {r.attach_count > 0 ? r.attach_count : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  tone?: "rose" | "amber" | "emerald" | "muted";
  icon?: any;
}) {
  const color =
    tone === "rose"
      ? "text-rose-600"
      : tone === "amber"
      ? "text-amber-600"
      : tone === "emerald"
      ? "text-emerald-600"
      : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        {Icon && <Icon className="size-3.5 text-muted-foreground" />}
      </div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
