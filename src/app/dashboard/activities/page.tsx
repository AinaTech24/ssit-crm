import Link from "next/link";
import { sql } from "drizzle-orm";
import { Phone, MapPin, StickyNote, Activity as ActivityIcon, MessageCircle } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { formatDate } from "@/lib/utils";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { ContactQuickActions } from "@/components/common/ContactQuickActions";
import { LogActivityButton } from "@/components/activities/ActivityLogger";
import { dateRangeCond, dateRangeFilter } from "@/lib/filters/date-range";

export const dynamic = "force-dynamic";

const KIND_OPTS = [
  { value: "call", label: "Calls" }, { value: "visit", label: "Visits" }, { value: "note", label: "Notes" },
  { value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "Email" }, { value: "sms", label: "SMS" },
];
const KIND_META: Record<string, { icon: any; tone: string; label: string }> = {
  call: { icon: Phone, tone: "bg-blue-50 text-blue-700", label: "Call" },
  visit: { icon: MapPin, tone: "bg-emerald-50 text-emerald-700", label: "Visit" },
  note: { icon: StickyNote, tone: "bg-slate-50 text-slate-600", label: "Note" },
  whatsapp: { icon: MessageCircle, tone: "bg-emerald-50 text-emerald-700", label: "WhatsApp" },
  email: { icon: MessageCircle, tone: "bg-violet-50 text-violet-700", label: "Email" },
  sms: { icon: MessageCircle, tone: "bg-blue-50 text-blue-700", label: "SMS" },
  other: { icon: ActivityIcon, tone: "bg-slate-50 text-slate-600", label: "Other" },
};

export default async function ActivitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const firmWide = can(session.roles, "dashboard.view.owner", (session as any).permissions);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const kind = (sp.kind ?? "").split(",").filter(Boolean);
  const mine = sp.mine === "1" || !firmWide;

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const conds: any[] = [sql`a.tenant_id = ${session.tenantId}::uuid`];
      if (q) conds.push(sql`(a.subject_name ILIKE ${`%${q}%`} OR a.subject ILIKE ${`%${q}%`} OR a.notes ILIKE ${`%${q}%`})`);
      if (kind.length) conds.push(sql`a.kind IN (${sql.join(kind.map((k) => sql`${k}`), sql`, `)})`);
      if (mine) conds.push(sql`a.owner_user_id = ${session.userId}::uuid`);
      const dr = dateRangeCond(sp, "created", "a.occurred_at");
      if (dr) conds.push(dr);
      const whereSql = sql`WHERE ${sql.join(conds, sql` AND `)}`;

      const rows = await tx.execute(sql`
        SELECT a.id, a.subject_type, a.subject_id, a.subject_name, a.subject_phone,
               a.kind, a.direction, a.status, a.subject, a.notes, a.occurred_at,
               a.duration_sec, a.location_label, a.next_followup_at, u.name AS owner_name
        FROM activities a LEFT JOIN users u ON u.id = a.owner_user_id
        ${whereSql}
        ORDER BY a.occurred_at DESC
        LIMIT 300
      `);

      const mineSql = mine ? sql` AND owner_user_id = ${session.userId}::uuid` : sql``;
      const stats = await tx.execute(sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE kind = 'call' AND occurred_at::date = current_date)::int AS calls_today,
          COUNT(*) FILTER (WHERE kind = 'visit' AND occurred_at >= current_date - 6)::int AS visits_week,
          COUNT(*) FILTER (WHERE next_followup_at IS NOT NULL AND next_followup_at::date <= current_date)::int AS followups_due
        FROM activities WHERE tenant_id = ${session.tenantId}::uuid ${mineSql}
      `);
      return { rows: rows.rows as any[], stats: stats.rows[0] as any };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const s = data.stats;
  const hrefFor = (t: string, id: string) => (t === "investor" ? `/dashboard/investors/${id}` : t === "lead" ? `/dashboard/leads/${id}` : `/dashboard/families/${id}`);

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><ActivityIcon className="size-6 text-brand-cyan" /> Activity Log</h1>
        </div>
        <LogActivityButton />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={ActivityIcon} label="Activities (total)" value={s?.total ?? 0} />
        <Stat icon={Phone} label="Calls today" value={s?.calls_today ?? 0} tone="blue" />
        <Stat icon={MapPin} label="Visits this week" value={s?.visits_week ?? 0} tone="emerald" />
        <Stat icon={StickyNote} label="Follow-ups due" value={s?.followups_due ?? 0} tone="amber" />
      </div>

      <CompactFilterBar
        totalCount={data.rows.length}
        filters={[
          { type: "search", key: "q", placeholder: "Search subject, notes, client…" },
          { type: "multi", key: "kind", label: "Type", options: KIND_OPTS },
          dateRangeFilter("created", "Activity date"),
          ...(firmWide ? [{ type: "select" as const, key: "mine", label: "Owner", options: [{ value: "1", label: "Logged by me" }] }] : []),
        ]}
        rightSlot={
          <CustomViews viewsKey="views:activities" presets={[
            { id: "calls", name: "Calls only", params: "kind=call" },
            { id: "visits", name: "Field visits", params: "kind=visit" },
          ]} />
        }
      />

      <div className="card-surface table-scroll">
        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">No activities yet. Use <strong>Log activity</strong>, or <strong>Check In</strong> / <strong>Log activity</strong> from a client or lead.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-left py-2 font-medium">Subject / Client</th>
                <th className="text-left py-2 font-medium">Outcome</th>
                <th className="text-left py-2 font-medium">Owner</th>
                <th className="text-left py-2 font-medium">When</th>
                <th className="text-right py-2 font-medium pr-4">Reach</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((a) => {
                const km = KIND_META[a.kind] ?? KIND_META.other;
                const Icon = km.icon;
                return (
                  <tr key={a.id} className="border-b last:border-0 hover:bg-secondary/40 align-top">
                    <td className="px-4 py-3">
                      <span className={`chip text-[10px] inline-flex items-center gap-1 ${km.tone}`}><Icon className="size-3" /> {km.label}</span>
                      {a.direction && <div className="text-[10px] text-muted-foreground mt-1 capitalize">{a.direction}</div>}
                    </td>
                    <td className="py-3">
                      <div className="font-medium">{a.subject || <span className="text-muted-foreground italic">—</span>}</div>
                      <Link href={hrefFor(a.subject_type, a.subject_id)} className="text-[11px] text-brand-cyan hover:underline">{a.subject_name ?? "(unknown)"}</Link>
                    </td>
                    <td className="py-3 text-xs max-w-[280px]">
                      <div className="truncate text-muted-foreground">{a.notes ?? "—"}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {a.status ? <span className="capitalize">{a.status.replace(/_/g, " ")}</span> : null}
                        {a.duration_sec ? ` · ${Math.round(a.duration_sec / 60)}m` : ""}
                        {a.location_label ? ` · 📍 ${a.location_label}` : ""}
                      </div>
                    </td>
                    <td className="py-3 text-xs whitespace-nowrap">{a.owner_name ?? "—"}</td>
                    <td className="py-3 text-xs whitespace-nowrap">{formatDate(a.occurred_at)}</td>
                    <td className="py-3 pr-4 text-right">
                      <ContactQuickActions phone={a.subject_phone} message={a.subject_name ? `Hi ${String(a.subject_name).split(" ")[0]}, ` : undefined} show={["whatsapp", "call"]} />
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

function Stat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone?: "blue" | "emerald" | "amber" }) {
  const color = tone === "blue" ? "text-blue-600" : tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{label}</span><Icon className="size-3.5 text-muted-foreground" /></div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
