import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq, and, or, ilike, inArray, sql } from "drizzle-orm";
import { Mail, PenSquare } from "lucide-react";
import { withTenant } from "@/db/client";
import { communications, investors, leads } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { dateRangeCond, dateRangeFilter } from "@/lib/filters/date-range";
import { CustomViews } from "@/components/common/CustomViews";
import { Pager } from "@/components/common/Pager";
import { CommsList, type CommRow } from "@/components/communications/CommsList";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const SKIPPED = ["skipped_consent", "skipped_compliance", "skipped_session", "skipped_rate_limit"];

export default async function CommunicationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  // Comms is the most PII-dense surface in the app (client message bodies +
  // inbound replies). Gate it to the roles that legitimately handle or oversee
  // comms; an investor-portal / unprivileged session is bounced.
  const canView =
    can(session.roles, "communication.send", session.permissions) ||
    can(session.roles, "compliance.view", session.permissions) ||
    can(session.roles, "investor.view.all", session.permissions) ||
    can(session.roles, "reports.business", session.permissions);
  if (!canView) redirect("/dashboard");
  // Managers / compliance / ops see the whole firm; a plain RM (or marketing)
  // sees only threads they sent or that belong to their own clients/leads.
  const seesAll =
    can(session.roles, "investor.view.all", session.permissions) ||
    can(session.roles, "compliance.view", session.permissions) ||
    can(session.roles, "reports.business", session.permissions);
  const me = session.userId;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const channels = (sp.channel ?? "").split(",").filter(Boolean);
  const statusesRaw = (sp.status ?? "").split(",").filter(Boolean);
  const flagged = sp.flagged === "1";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  // Expand the "skipped" folder to its four concrete statuses.
  const statuses: string[] = [];
  for (const s of statusesRaw) (s === "skipped" ? statuses.push(...SKIPPED) : statuses.push(s));

  const data = await withTenant(session.tenantId, async (tx) => {
    // Tenant-wide headline counts (NOT page-scoped — the previous bug).
    const k = (
      await tx.execute(sql`
        SELECT
          count(*) FILTER (WHERE status = 'scheduled')::int AS scheduled,
          count(*) FILTER (WHERE status IN ('sent','delivered','read','replied'))::int AS sent,
          count(*) FILTER (WHERE status IN ('delivered','read'))::int AS delivered,
          count(*) FILTER (WHERE status IN ('read','replied'))::int AS read,
          count(*) FILTER (WHERE status = 'failed')::int AS failed
        FROM communications
        WHERE tenant_id = ${session.tenantId}::uuid${seesAll
          ? sql``
          : sql` AND (user_id = ${me}::uuid
                OR investor_id IN (SELECT id FROM investors WHERE rm_id = ${me}::uuid)
                OR lead_id IN (SELECT id FROM leads WHERE owner_id = ${me}::uuid))`
        }
      `)
    ).rows[0] as any;

    // Tenant scope is mandatory: under the superuser/RLS-bypass model the
    // explicit predicate is the live protection. Without it this list (and the
    // filtered total) would render every tenant's inbox/outbox.
    const conds: any[] = [eq(communications.tenantId, session.tenantId)];
    // Per-RM scope (the leftJoins to investors/leads below back this OR).
    if (!seesAll) {
      conds.push(
        or(
          eq(communications.userId, me),
          eq(investors.rmId, me),
          eq(leads.ownerId, me)
        )!
      );
    }
    if (channels.length) conds.push(inArray(communications.channel, channels as any));
    if (statuses.length) conds.push(inArray(communications.status, statuses as any));
    if (flagged) conds.push(sql`${communications.flaggedAt} IS NOT NULL`);
    const dr = dateRangeCond(sp, "created", "communications.created_at");
    if (dr) conds.push(dr);
    if (q) {
      conds.push(
        or(
          ilike(investors.name, `%${q}%`),
          ilike(leads.name, `%${q}%`),
          ilike(communications.templateKey, `%${q}%`),
          sql`(${communications.payload}->'rendered'->>'subject') ILIKE ${"%" + q + "%"}`
        )!
      );
    }
    const where = conds.length ? and(...conds) : undefined;

    const base = tx
      .select({
        comm: communications,
        investorName: investors.name,
        leadName: leads.name,
      })
      .from(communications)
      .leftJoin(investors, eq(investors.id, communications.investorId))
      .leftJoin(leads, eq(leads.id, communications.leadId));

    const rows = await base
      .where(where as any)
      .orderBy(desc(communications.createdAt), desc(communications.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);

    const cnt = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(communications)
      .leftJoin(investors, eq(investors.id, communications.investorId))
      .leftJoin(leads, eq(leads.id, communications.leadId))
      .where(where as any);

    return {
      counts: k,
      rows,
      filteredTotal: Number(cnt[0]?.c ?? 0),
    };
  });

  const listRows: CommRow[] = data.rows.map(({ comm: c, investorName, leadName }) => {
    const payload = (c.payload ?? {}) as any;
    return {
      id: c.id,
      channel: c.channel,
      direction: c.direction,
      status: c.status,
      recipient: investorName ?? leadName ?? payload.recipient ?? "—",
      subject: payload?.rendered?.subject ?? "",
      preview: String(payload?.rendered?.text ?? (c.inboundContent as any)?.text ?? "").slice(0, 120),
      createdAt: c.createdAt.toISOString(),
      scheduledAt: c.scheduledAt ? new Date(c.scheduledAt).toISOString() : null,
      templateKey: c.templateKey,
      workflowRunId: c.workflowRunId,
      flagged: !!c.flaggedAt,
    };
  });

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Mail className="size-6 text-brand-cyan" /> Communications
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/communications/cadence" className="btn-secondary text-xs whitespace-nowrap">
            Cadence (SOP) →
          </Link>
          <Link href="/dashboard/communications/compose" className="btn-primary text-xs whitespace-nowrap">
            <PenSquare className="size-4" /> Compose
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatLink label="Scheduled" value={data.counts?.scheduled ?? 0} param="scheduled" />
        <StatLink label="Sent" value={data.counts?.sent ?? 0} param="sent" />
        <StatLink label="Delivered" value={data.counts?.delivered ?? 0} param="delivered" />
        <StatLink label="Read" value={data.counts?.read ?? 0} param="read" />
        <StatLink label="Failed" value={data.counts?.failed ?? 0} param="failed" tone="rose" />
      </div>

      <CompactFilterBar
        totalCount={data.filteredTotal}
        filters={[
          { type: "search", key: "q", placeholder: "Search recipient, subject, template…" },
          {
            type: "multi",
            key: "channel",
            label: "Channel",
            options: [
              { value: "email", label: "Email" },
              { value: "whatsapp", label: "WhatsApp" },
              { value: "sms", label: "SMS" },
              { value: "call", label: "Call" },
              { value: "inapp", label: "In-app" },
            ],
          },
          {
            type: "multi",
            key: "status",
            label: "Status",
            options: [
              { value: "scheduled", label: "Scheduled" },
              { value: "queued", label: "Queued" },
              { value: "sent", label: "Sent" },
              { value: "delivered", label: "Delivered" },
              { value: "read", label: "Read" },
              { value: "replied", label: "Replied" },
              { value: "failed", label: "Failed" },
              { value: "skipped", label: "Skipped" },
              { value: "cancelled", label: "Cancelled" },
            ],
          },
          dateRangeFilter("created", "Date"),
        ]}
        rightSlot={
          <CustomViews
            viewsKey="views:communications"
            presets={[
              { id: "scheduled", name: "Scheduled", params: "status=scheduled" },
              { id: "failed", name: "Failed", params: "status=failed" },
              { id: "email", name: "Email", params: "channel=email" },
              { id: "flagged", name: "Flagged", params: "flagged=1" },
            ]}
          />
        }
      />

      <div className="border rounded-lg bg-card table-scroll">
        <CommsList rows={listRows} />
      </div>
      <Pager
        page={page}
        totalPages={Math.ceil(data.filteredTotal / PAGE_SIZE)}
        total={data.filteredTotal}
        pageSize={PAGE_SIZE}
      />
    </div>
  );
}

function StatLink({
  label,
  value,
  param,
  tone,
}: {
  label: string;
  value: number;
  param: string;
  tone?: "rose";
}) {
  return (
    <Link href={`/dashboard/communications?status=${param}`} className="border rounded-lg p-4 bg-card hover:bg-accent/40 transition-colors">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${tone === "rose" && value > 0 ? "text-rose-600" : ""}`}>
        {value}
      </div>
    </Link>
  );
}
