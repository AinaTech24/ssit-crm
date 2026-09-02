import Link from "next/link";
import { sql } from "drizzle-orm";
import { LifeBuoy } from "lucide-react";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatRelative } from "@/lib/utils";
import { SupportTicketFilters } from "@/components/super-admin/SupportTicketFilters";

const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-50 text-blue-700",
  in_progress: "bg-amber-50 text-amber-700",
  waiting_customer: "bg-slate-50 text-slate-700",
  resolved: "bg-emerald-50 text-emerald-700",
  closed: "bg-gray-50 text-gray-700",
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "text-rose-600",
  high: "text-amber-600",
  normal: "text-foreground",
  low: "text-muted-foreground",
};

const CATEGORY_COLORS: Record<string, string> = {
  bug: "bg-rose-50 text-rose-700",
  feature_request: "bg-blue-50 text-blue-700",
  billing: "bg-emerald-50 text-emerald-700",
  training: "bg-amber-50 text-amber-700",
  integration: "bg-purple-50 text-purple-700",
  data_help: "bg-teal-50 text-teal-700",
  other: "bg-gray-50 text-gray-700",
};

export const dynamic = "force-dynamic";

export default async function SupportTicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; category?: string; priority?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;

  const data = await withPlatformAdmin(session.userId, async (tx) => {
    const filters: string[] = [];
    if (sp.status) filters.push(`st.status = '${sp.status.replace(/'/g, "")}'`);
    if (sp.category) filters.push(`st.category = '${sp.category.replace(/'/g, "")}'`);
    if (sp.priority) filters.push(`st.priority = '${sp.priority.replace(/'/g, "")}'`);
    const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const stats = await tx.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'open')::int AS open_n,
        COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress_n,
        COUNT(*) FILTER (WHERE status IN ('resolved', 'closed'))::int AS closed_n,
        COUNT(*) FILTER (WHERE priority = 'urgent' AND status NOT IN ('resolved', 'closed'))::int AS urgent_open,
        ROUND(AVG(EXTRACT(epoch FROM (resolved_at - created_at)) / 3600)
          FILTER (WHERE resolved_at IS NOT NULL))::int AS avg_resolution_hrs
      FROM support_tickets
    `);
    const s = stats.rows[0] as any;

    const rows = await tx.execute(sql.raw(`
      SELECT st.id, st.tenant_id, st.subject, st.description, st.category, st.priority,
             st.status, st.created_at, st.resolved_at,
             t.legal_name, t.arn,
             u.name AS raised_by_name
      FROM support_tickets st
      LEFT JOIN tenants t ON t.id = st.tenant_id
      LEFT JOIN users u ON u.id = st.raised_by_user_id
      ${whereSql}
      ORDER BY
        CASE st.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        st.created_at DESC
      LIMIT 200
    `));

    return { stats: s, rows: rows.rows as any[] };
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Support tickets</h1>
        <p className="text-muted-foreground text-sm">
          All MFD-raised tickets across the platform.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi label="Total" value={data.stats.total} />
        <Kpi label="Open" value={data.stats.open_n} tone={data.stats.open_n > 0 ? "amber" : "muted"} />
        <Kpi label="In progress" value={data.stats.in_progress_n} tone="blue" />
        <Kpi label="Urgent open" value={data.stats.urgent_open} tone={data.stats.urgent_open > 0 ? "rose" : "muted"} />
        <Kpi label="Avg resolution" value={`${Math.round((data.stats.avg_resolution_hrs ?? 0) / 24)}d`} />
      </div>

      <div className="border rounded-lg bg-card">
        <SupportTicketFilters status={sp.status} category={sp.category} priority={sp.priority} />

        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <LifeBuoy className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2">No support tickets yet.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Subject</th>
                <th className="text-left py-2 font-medium">From</th>
                <th className="text-left py-2 font-medium">Category</th>
                <th className="text-left py-2 font-medium">Priority</th>
                <th className="text-left py-2 font-medium">Status</th>
                <th className="text-left py-2 font-medium pl-3">When</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-accent/40">
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.subject}</div>
                    {r.description && (
                      <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5 max-w-md">
                        {r.description}
                      </div>
                    )}
                  </td>
                  <td className="py-3 text-xs">
                    <Link
                      href={`/super-admin/tenants/${r.tenant_id}`}
                      className="font-medium hover:underline"
                    >
                      {r.legal_name}
                    </Link>
                    <div className="text-muted-foreground">{r.raised_by_name ?? "—"}</div>
                  </td>
                  <td className="py-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        CATEGORY_COLORS[r.category] ?? CATEGORY_COLORS.other
                      }`}
                    >
                      {r.category.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className={`py-3 text-xs uppercase ${PRIORITY_COLORS[r.priority]}`}>{r.priority}</td>
                  <td className="py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status] ?? ""}`}>
                      {r.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="py-3 pl-3 text-xs text-muted-foreground">{formatRelative(r.created_at)}</td>
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

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "rose" | "amber" | "emerald" | "blue" | "muted";
}) {
  const color = {
    rose: "text-rose-600",
    amber: "text-amber-600",
    emerald: "text-emerald-600",
    blue: "text-blue-600",
    muted: "text-muted-foreground",
  }[tone ?? "muted"];
  return (
    <div className="border rounded-lg p-5 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${value && value !== 0 ? color : ""}`}>{value}</div>
    </div>
  );
}
