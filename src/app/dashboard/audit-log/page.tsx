import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, and, eq, gte, sql } from "drizzle-orm";
import { Download } from "lucide-react";
import { withTenant } from "@/db/client";
import { auditLog, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatRelative } from "@/lib/utils";
import { AuditList, type AuditRow } from "@/components/audit/AuditList";

export const dynamic = "force-dynamic";

/** Who may read the full tenant audit trail. Mirrors the sidebar gate — the
 *  trail exposes PII-access events, role changes and IP addresses, so it is
 *  management-only. (Owner also passes; this is the page-level enforcement the
 *  nav visibility alone did not provide.) */
const AUDIT_ROLES = ["owner", "compliance"];

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; actor?: string; days?: string; cursor?: string; user?: string; pii?: string }>;
}) {
  const session = await requireSession();
  if (!session.roles.some((r) => AUDIT_ROLES.includes(r))) notFound();

  const sp = await searchParams;
  const days = Number(sp.days ?? "7");
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const cursor = sp.cursor;
  const piiOnly = sp.pii === "1";
  const actionQ = (sp.action ?? "").trim();

  const result = await withTenant(session.tenantId, async (tx) => {
    // Shared filters (everything except the keyset cursor) — used by the list
    // AND the count KPIs so the numbers always agree with what's shown.
    const baseConditions = [gte(auditLog.at, fromDate)];
    if (actionQ) baseConditions.push(sql`${auditLog.action} ILIKE ${"%" + actionQ + "%"}`);
    if (sp.actor) baseConditions.push(eq(auditLog.actorType, sp.actor as any));
    if (sp.user) baseConditions.push(eq(auditLog.actorUserId, sp.user));
    // A genuine PII-access event has a non-empty pii_accessed object.
    const piiPredicate = sql`${auditLog.piiAccessed} IS NOT NULL AND ${auditLog.piiAccessed} <> '{}'::jsonb`;
    if (piiOnly) baseConditions.push(piiPredicate);

    const listConditions = [...baseConditions];
    if (cursor) {
      const [cursorMs, cursorId] = cursor.split(":");
      if (cursorMs && cursorId) {
        listConditions.push(
          sql`(${auditLog.at}, ${auditLog.id}) < (${new Date(Number(cursorMs)).toISOString()}::timestamp, ${cursorId}::uuid)`
        );
      }
    }

    const rows = await tx
      .select({ log: auditLog, userName: users.name })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorUserId))
      .where(and(...listConditions))
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(51);

    const hasMore = rows.length > 50;
    const displayRows = hasMore ? rows.slice(0, 50) : rows;
    const lastRow = displayRows[displayRows.length - 1];
    const nextCursor = lastRow ? `${lastRow.log.at.getTime()}:${lastRow.log.id}` : "";

    // Real totals over the window (respecting the active filters) — NOT the page size.
    const totalRes = await tx.execute(sql`SELECT COUNT(*)::int AS c FROM audit_log WHERE ${and(...baseConditions)}`);
    const totalEvents = Number((totalRes.rows[0] as any)?.c ?? 0);

    const piiRes = await tx.execute(
      sql`SELECT COUNT(*)::int AS c FROM audit_log WHERE ${and(...baseConditions)} AND ${piiPredicate}`
    );
    const piiAccessed = Number((piiRes.rows[0] as any)?.c ?? 0);

    const userList = await tx.select({ id: users.id, name: users.name }).from(users).orderBy(users.name);

    return { displayRows, hasMore, nextCursor, totalEvents, piiAccessed, userList };
  });

  const serialised: AuditRow[] = result.displayRows.map((r) => {
    const piiObj = (r.log.piiAccessed as Record<string, unknown> | null) ?? null;
    const piiFields = piiObj ? Object.keys(piiObj) : [];
    return {
      id: r.log.id,
      at: r.log.at.toISOString(),
      atLabel: formatRelative(r.log.at),
      actorType: r.log.actorType,
      actorName: r.userName ?? r.log.actorType,
      action: r.log.action,
      entityType: r.log.entityType ?? null,
      entityId: r.log.entityId ?? null,
      reason: r.log.reason ?? null,
      pii: piiFields.length > 0,
      piiFields,
      ip: r.log.ipAddress ?? null,
      userAgent: r.log.userAgent ?? null,
      before: (r.log.before as Record<string, unknown> | null) ?? null,
      after: (r.log.after as Record<string, unknown> | null) ?? null,
      meta: (r.log.meta as Record<string, unknown> | null) ?? null,
    };
  });

  const qs = new URLSearchParams();
  if (sp.actor) qs.set("actor", sp.actor);
  if (sp.user) qs.set("user", sp.user);
  if (actionQ) qs.set("action", actionQ);
  if (piiOnly) qs.set("pii", "1");
  qs.set("days", String(days));
  const exportHref = `/api/audit/export?${qs.toString()}`;

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Audit log</h1>
        </div>
        <a href={exportHref} className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent">
          <Download className="size-3.5" /> Export CSV
        </a>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total events (window)" value={result.totalEvents.toLocaleString("en-IN")} />
        <Stat label="PII access events" value={result.piiAccessed.toLocaleString("en-IN")} tone={result.piiAccessed > 0 ? "amber" : undefined} />
        <Stat label="Window" value={`${days} days`} />
        <Stat label="Retention" value="7 years" />
      </div>

      <form className="border rounded-lg bg-card">
        <div className="border-b p-3 flex gap-2 flex-wrap items-center">
          <select name="actor" defaultValue={sp.actor ?? ""} className="text-sm border rounded-md px-2 py-1 bg-background">
            <option value="">All actor types</option>
            <option value="user">User</option>
            <option value="system">System</option>
            <option value="workflow">Workflow</option>
            <option value="webhook">Webhook</option>
          </select>
          <select name="user" defaultValue={sp.user ?? ""} className="text-sm border rounded-md px-2 py-1 bg-background max-w-[12rem]">
            <option value="">Any user</option>
            {result.userList.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <select name="days" defaultValue={String(days)} className="text-sm border rounded-md px-2 py-1 bg-background">
            <option value="1">Last 24h</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last year</option>
          </select>
          <input
            name="action"
            defaultValue={actionQ}
            placeholder="action contains, e.g. investor"
            className="text-sm border rounded-md px-2 py-1 bg-background flex-1 min-w-[10rem] max-w-xs"
          />
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground select-none">
            <input type="checkbox" name="pii" value="1" defaultChecked={piiOnly} className="accent-amber-500" /> PII only
          </label>
          <button className="rounded-md border px-3 py-1 text-sm hover:bg-accent">Apply</button>
        </div>

        {serialised.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">No audit events in this window.</div>
        ) : (
          <>
            <AuditList rows={serialised} />
            {result.hasMore && (
              <div className="p-4 border-t flex justify-end">
                <Link
                  href={`/dashboard/audit-log?${qs.toString()}&cursor=${result.nextCursor}`}
                  className="rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
                >
                  Next page →
                </Link>
              </div>
            )}
          </>
        )}
      </form>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "amber" }) {
  return (
    <div className="border rounded-lg p-4 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${tone === "amber" ? "text-amber-600" : ""}`}>{value}</div>
    </div>
  );
}
