import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/activities/export - download the Activity Log as an .xlsx, one row per
 * logged activity (call, email, visit, note ...), with the client's or lead's details.
 *
 * Filters (all optional):
 *   created_from / created_to   yyyy-mm-dd, inclusive - the day the activity happened
 *   unit                        "b:<branchId>" | "d:<deskId>"  (department / sub-branch)
 *   rm                          one person's id (whoever logged it)
 *   kind, status                comma-separated
 *   q                           the Activity Log search box (subject / notes / client)
 *
 * Who sees what is the data wall's job, exactly as on the Activity Log page: a person
 * without firm-wide view exports only their own, and the same wall applies to everyone
 * else, whatever filters are asked for.
 */

import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { dataScopeSqlFor } from "@/lib/auth/data-scope";
import { can } from "@/lib/auth/rbac";
import { parseScope, scopeFilterSql } from "@/lib/scope/view-filter";
import { dateRangeCond } from "@/lib/filters/date-range";
import { loadTenantLicense } from "@/lib/auth/license";
import { isFieldAllowed } from "@/lib/auth/field-gate";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const MAX_ROWS = 20000;

const titleCase = (s: unknown) =>
  String(s ?? "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
const SUBJECT_LABEL: Record<string, string> = { investor: "Client", lead: "Lead", family: "Family" };

function istDate(v: unknown): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(String(v));
  if (isNaN(d.getTime())) return "";
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
function istTime(v: unknown): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(String(v));
  if (isNaN(d.getTime())) return "";
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(11, 16);
}
const list = (v: string | undefined) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const license = await loadTenantLicense(session.tenantId, session.roles);
    const show = {
      pan: isFieldAllowed(license, "investor", "pan"),
      phone: isFieldAllowed(license, "investor", "phone"),
      email: isFieldAllowed(license, "investor", "email"),
    };
    const firmWide = can(session.roles, "dashboard.view.owner", (session as any).permissions);

    const sp: Record<string, string | undefined> = {};
    req.nextUrl.searchParams.forEach((v, k) => {
      sp[k] = v;
    });
    const scopeSel = parseScope(sp);
    const kinds = list(sp.kind);
    const statuses = list(sp.status);
    const q = (sp.q ?? "").trim();
    const inList = (col: string, vals: string[]) => sql`${sql.raw(col)} IN (${sql.join(vals.map((v) => sql`${v}`), sql`, `)})`;

    const rows = await withTenant(
      session.tenantId,
      async (tx) => {
        const wall = await dataScopeSqlFor(tx, session, { branch: "a.branch_id", owner: "a.owner_user_id" });
        const filters: any[] = [sql`a.tenant_id = ${session.tenantId}::uuid`, wall];
        // Same rule as the page: without firm-wide view, only what you logged yourself.
        if (!firmWide) filters.push(sql`a.owner_user_id = ${session.userId}::uuid`);
        filters.push(scopeFilterSql(scopeSel, session.tenantId, "a.owner_user_id"));
        if (kinds.length) filters.push(inList("a.kind", kinds));
        if (statuses.length) filters.push(inList("a.status", statuses));
        if (q) {
          filters.push(sql`(a.subject_name ILIKE ${`%${q}%`} OR a.subject ILIKE ${`%${q}%`} OR a.notes ILIKE ${`%${q}%`})`);
        }
        const dr = dateRangeCond(sp, "created", "a.occurred_at");
        if (dr) filters.push(dr);

        const r = await tx.execute(sql`
          SELECT a.id, a.occurred_at, a.kind, a.direction, a.status, a.subject, a.notes,
                 a.duration_sec, a.location_label, a.next_followup_at, a.created_at,
                 a.subject_type, a.subject_name, a.subject_phone,
                 i.pan AS c_pan, i.email AS c_email, i.phone AS c_phone,
                 i.segment_tag AS c_segment, i.service_tier AS c_tier, crm.name AS c_rm,
                 l.phone AS l_phone, l.email AS l_email, l.stage AS l_stage, l.source AS l_source,
                 l.source_campaign AS l_event,
                 ou.name AS owner_name, d.name AS desk_name, b.name AS branch_name
          FROM activities a
          LEFT JOIN investors i ON a.subject_type = 'investor' AND i.id = a.subject_id
          LEFT JOIN users crm ON crm.id = i.rm_id
          LEFT JOIN leads l ON a.subject_type = 'lead' AND l.id = a.subject_id
          LEFT JOIN users ou ON ou.id = a.owner_user_id
          LEFT JOIN desks d ON d.id = ou.desk_id
          LEFT JOIN branches b ON b.id = ou.branch_id
          WHERE ${sql.join(filters, sql` AND `)}
          ORDER BY a.occurred_at DESC
          LIMIT ${MAX_ROWS}
        `);
        // DPDP: a bulk read of client details leaves an access trail.
        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "activity.export",
          entityType: "activity",
          entityId: session.tenantId,
          piiAccessed: { pan: show.pan, phone: show.phone, email: show.email } as any,
          after: { count: r.rows.length, filters: sp } as any,
          ...clientMetaFromHeaders(req.headers),
        });
        return r.rows as any[];
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    const data = rows.map((a) => {
      const isClient = a.subject_type === "investor";
      const isLead = a.subject_type === "lead";
      const row: Record<string, any> = {
        Date: istDate(a.occurred_at),
        "Time (IST)": istTime(a.occurred_at),
        Type: titleCase(a.kind),
        Direction: titleCase(a.direction),
        Status: titleCase(a.status),
        Subject: a.subject ?? "",
        "Notes / outcome": a.notes ?? "",
        "Duration (min)": a.duration_sec ? Math.round((Number(a.duration_sec) / 60) * 10) / 10 : "",
        Location: a.location_label ?? "",
        "Next follow-up": istDate(a.next_followup_at),
        "Logged for": SUBJECT_LABEL[a.subject_type] ?? titleCase(a.subject_type),
        Name: a.subject_name ?? "",
      };
      const phone = (isClient ? a.c_phone : isLead ? a.l_phone : null) ?? a.subject_phone ?? "";
      if (show.phone) row["Phone"] = phone;
      if (show.email) row["Email"] = (isClient ? a.c_email : isLead ? a.l_email : "") ?? "";
      if (isClient) {
        if (show.pan) row["PAN"] = a.c_pan ?? "";
        row["Segment"] = a.c_segment ?? "";
        row["Service tier"] = a.c_tier ?? "";
        row["Client RM"] = a.c_rm ?? "";
      } else if (isLead) {
        row["Lead stage"] = titleCase(a.l_stage);
        row["Lead source"] = titleCase(a.l_source);
        row["Event"] = a.l_event ?? "";
      }
      row["Logged by"] = a.owner_name ?? "";
      row["Sub-branch"] = a.desk_name ?? "";
      row["Branch"] = a.branch_name ?? "";
      row["Logged on"] = istDate(a.created_at);
      return row;
    });

    // Always emit at least a header row so an empty filter still downloads a valid file.
    const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ Date: "(no activities match the chosen filters)" }]);
    if (data.length) ws["!cols"] = Object.keys(data[0]).map((k) => ({ wch: /notes|subject/i.test(k) ? 42 : Math.min(28, Math.max(12, k.length + 2)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Activities");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="activity-log-${stamp}.xlsx"`,
        "Cache-Control": "no-store",
        "X-Row-Count": String(data.length),
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
