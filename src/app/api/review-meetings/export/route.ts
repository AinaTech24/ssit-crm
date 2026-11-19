import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/review-meetings/export - download meetings as an .xlsx, one row per
 * meeting, with the whole meeting record AND the client's (or lead's) details.
 * Documents are not part of the file.
 *
 * Filters (all optional):
 *   meeting_from / meeting_to   yyyy-mm-dd, inclusive (the dialog turns a month or a
 *                               year into this range)
 *   unit                        "b:<branchId>" | "d:<deskId>"  (department / sub-branch)
 *   rm                          one person's id
 *   status, category, type, mode   comma-separated
 *
 * Who sees what is the data wall's job, not this route's: the meeting scope used by
 * the Meetings list applies here too, so an RM exports their own meetings, a head
 * their team's, the owner everyone's - whatever filters are asked for.
 */

import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { resolveMeetingScope, meetingScopeSql } from "@/lib/auth/data-scope";
import { parseScope, scopeFilterSql } from "@/lib/scope/view-filter";
import { dateRangeCond } from "@/lib/filters/date-range";
import { loadTenantLicense } from "@/lib/auth/license";
import { isFieldAllowed } from "@/lib/auth/field-gate";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const MAX_ROWS = 10000;

const TYPE_LABEL: Record<string, string> = {
  portfolio_review: "Portfolio Review",
  goal_review: "Goal Review",
  new_investment_discussion: "New Investment",
  service_discussion: "Service Discussion",
  family_review: "Family Review",
  complaint_discussion: "Complaint Discussion",
  discovery_call: "Discovery Call",
  new_client_kickoff: "Client Kickoff",
  product_demo: "Product Demo",
  sales_pitch: "Sales Pitch",
  follow_up_call: "Follow-up Call",
  follow_up_visit: "Follow-up Visit",
  other: "Other",
};
const MODE_LABEL: Record<string, string> = { office: "Office", client_place: "Client Place", online: "Online", phone: "Phone" };
const titleCase = (s: unknown) =>
  String(s ?? "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

/** yyyy-mm-dd in India time - the day the meeting was held, as the RM sees it. */
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
const dOnly = (v: unknown) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : "");
const list = (v: string | null) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const license = await loadTenantLicense(session.tenantId, session.roles);
    const show = {
      pan: isFieldAllowed(license, "investor", "pan"),
      phone: isFieldAllowed(license, "investor", "phone"),
      email: isFieldAllowed(license, "investor", "email"),
      aum: isFieldAllowed(license, "investor", "aum"),
      sip: isFieldAllowed(license, "investor", "active_sip_amount") || isFieldAllowed(license, "investor", "sip"),
    };

    const sp: Record<string, string | undefined> = {};
    req.nextUrl.searchParams.forEach((v, k) => {
      sp[k] = v;
    });
    const scopeSel = parseScope(sp);
    const statusFilter = list(sp.status ?? null);
    const categoryFilter = list(sp.category ?? null);
    const typeFilter = list(sp.type ?? null);
    const modeFilter = list(sp.mode ?? null);
    const inList = (col: string, vals: string[]) => sql`${sql.raw(col)} IN (${sql.join(vals.map((v) => sql`${v}`), sql`, `)})`;

    const rows = await withTenant(
      session.tenantId,
      async (tx) => {
        const meetingScope = await resolveMeetingScope(tx, session);
        const filters: any[] = [
          sql`m.tenant_id = ${session.tenantId}::uuid`,
          meetingScopeSql(meetingScope, "m.rm_id"),
          scopeFilterSql(scopeSel, session.tenantId, ["m.created_by_id", "m.rm_id"]),
        ];
        if (statusFilter.length) filters.push(inList("m.status", statusFilter));
        if (categoryFilter.length) filters.push(inList("m.category", categoryFilter));
        if (typeFilter.length) filters.push(inList("m.meeting_type", typeFilter));
        if (modeFilter.length) filters.push(inList("m.meeting_mode", modeFilter));
        const dr = dateRangeCond(sp, "meeting", "m.meeting_date");
        if (dr) filters.push(dr);

        const r = await tx.execute(sql`
          SELECT m.id, m.meeting_date, m.duration_minutes, m.category, m.meeting_type, m.subject,
                 m.meeting_mode, m.location_or_link, m.status, m.discussion_points, m.meeting_notes,
                 m.outcome, m.outcome_notes, m.next_review_date, m.action_items, m.attendees,
                 m.created_at, m.other_party_name,
                 m.reschedule_count, m.reschedule_reason, m.actual_end_at,
                 pm.subject AS parent_subject, pm.meeting_date AS parent_date,
                 -- who the meeting is with
                 CASE WHEN i.id IS NOT NULL THEN 'Client'
                      WHEN l.id IS NOT NULL THEN 'Lead'
                      WHEN m.other_party_name IS NOT NULL THEN 'Other' END AS party_kind,
                 COALESCE(i.name, l.name, m.other_party_name) AS party_name,
                 -- client
                 i.pan AS c_pan, i.segment_tag AS c_segment, i.service_tier AS c_tier,
                 i.email AS c_email, i.phone AS c_phone, i.whatsapp_phone AS c_whatsapp,
                 i.address AS c_address, i.aum AS c_aum, i.active_sip_amount AS c_sip,
                 i.kyc_status AS c_kyc, i.status AS c_status, i.last_review_at AS c_last_review,
                 i.next_review_at AS c_next_review, i.onboarded_at AS c_since,
                 f.family_name AS c_family, crm.name AS c_rm,
                 -- lead
                 l.phone AS l_phone, l.email AS l_email, l.stage AS l_stage, l.source AS l_source,
                 l.source_campaign AS l_event,
                 -- who owns the meeting
                 ru.name AS rm_name, cu.name AS created_by_name,
                 d.name AS desk_name, b.name AS branch_name,
                 (SELECT string_agg(x.name, ', ' ORDER BY x.name) FROM users x
                   WHERE x.id::text IN (SELECT jsonb_array_elements_text(COALESCE(m.collaborator_ids, '[]'::jsonb)))) AS collaborators
          FROM review_meetings m
          LEFT JOIN investors i ON i.id = m.investor_id
          LEFT JOIN families f ON f.id = i.family_id
          LEFT JOIN users crm ON crm.id = i.rm_id
          LEFT JOIN leads l ON l.id = m.lead_id
          LEFT JOIN users ru ON ru.id = COALESCE(m.rm_id, m.created_by_id)
          LEFT JOIN users cu ON cu.id = m.created_by_id
          LEFT JOIN review_meetings pm ON pm.id = m.parent_meeting_id
          LEFT JOIN desks d ON d.id = ru.desk_id
          LEFT JOIN branches b ON b.id = ru.branch_id
          WHERE ${sql.join(filters, sql` AND `)}
          ORDER BY m.meeting_date DESC
          LIMIT ${MAX_ROWS}
        `);
        // DPDP: a bulk read of client details leaves an access trail.
        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "review_meeting.export",
          entityType: "review_meeting",
          entityId: session.tenantId,
          piiAccessed: { pan: show.pan, phone: show.phone, email: show.email } as any,
          after: { count: r.rows.length, filters: sp } as any,
          ...clientMetaFromHeaders(req.headers),
        });
        return r.rows as any[];
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    const data = rows.map((m) => {
      const addr = (m.c_address as any) ?? {};
      const actions = Array.isArray(m.action_items) ? (m.action_items as any[]) : [];
      const attendees = Array.isArray(m.attendees) ? (m.attendees as any[]) : [];
      const isClient = m.party_kind === "Client";
      const isLead = m.party_kind === "Lead";
      const row: Record<string, any> = {
        "Meeting date": istDate(m.meeting_date),
        "Time (IST)": istTime(m.meeting_date),
        "Duration (min)": m.duration_minutes ?? "",
        Status: titleCase(m.status),
        Category: titleCase(m.category),
        "Meeting type": TYPE_LABEL[m.meeting_type] ?? titleCase(m.meeting_type),
        Subject: m.subject ?? "",
        Mode: MODE_LABEL[m.meeting_mode] ?? titleCase(m.meeting_mode),
        "Location / link": m.location_or_link ?? "",
        "Meeting with": m.party_kind ?? "",
        Name: m.party_name ?? "",
      };
      if (isClient) {
        if (show.pan) row["PAN"] = m.c_pan ?? "";
        row["Segment"] = m.c_segment ?? "";
        row["Service tier"] = m.c_tier ?? "";
        row["Family"] = m.c_family ?? "";
        if (show.phone) row["Phone"] = m.c_phone ?? "";
        if (show.phone) row["WhatsApp"] = m.c_whatsapp ?? "";
        if (show.email) row["Email"] = m.c_email ?? "";
        row["Address"] = [addr.line1, addr.city, addr.state, addr.pincode].filter(Boolean).join(", ");
        row["Client status"] = m.c_status ?? "";
        if (show.pan) row["KYC"] = m.c_kyc ?? "";
        if (show.aum) row["AUM"] = m.c_aum != null ? Number(m.c_aum) : "";
        if (show.sip) row["Active SIP / month"] = m.c_sip != null ? Number(m.c_sip) : "";
        row["Client RM"] = m.c_rm ?? "";
        row["Client since"] = dOnly(m.c_since);
        row["Last review"] = dOnly(m.c_last_review);
        row["Next review (client)"] = dOnly(m.c_next_review);
      } else if (isLead) {
        if (show.phone) row["Phone"] = m.l_phone ?? "";
        if (show.email) row["Email"] = m.l_email ?? "";
        row["Lead stage"] = titleCase(m.l_stage);
        row["Lead source"] = titleCase(m.l_source);
        row["Event"] = m.l_event ?? "";
      }
      row["RM / owner"] = m.rm_name ?? "";
      row["Sub-branch"] = m.desk_name ?? "";
      row["Branch"] = m.branch_name ?? "";
      row["Collaborators"] = m.collaborators ?? "";
      row["Created by"] = m.created_by_name ?? "";
      row["Discussion points (agenda)"] = m.discussion_points ?? "";
      row["Meeting notes"] = m.meeting_notes ?? "";
      row["Outcome"] = titleCase(m.outcome);
      row["Outcome notes"] = m.outcome_notes ?? "";
      row["Action items"] = actions
        .map((a, i) => `${i + 1}. ${a?.title ?? ""}${a?.dueAt ? ` (due ${String(a.dueAt).slice(0, 10)})` : ""}`)
        .join("\n");
      row["Attendees"] = attendees
        .map((a) => `${a?.name ?? ""}${a?.role ? ` (${titleCase(a.role)})` : ""}${a?.notes ? ` - ${a.notes}` : ""}`)
        .join("; ");
      row["Next review date"] = dOnly(m.next_review_date);
      row["Follow-up of"] = m.parent_subject || m.parent_date ? `${m.parent_subject ?? "Earlier meeting"} (${istDate(m.parent_date)})` : "";
      row["Times rescheduled"] = Number(m.reschedule_count ?? 0);
      row["Reschedule reason"] = m.reschedule_reason ?? "";
      row["Ended at (IST)"] = m.actual_end_at ? `${istDate(m.actual_end_at)} ${istTime(m.actual_end_at)}` : "";
      row["Created on"] = istDate(m.created_at);
      return row;
    });

    // Always emit at least a header row so an empty filter still downloads a valid file.
    const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ "Meeting date": "(no meetings match the chosen filters)" }]);
    if (data.length) ws["!cols"] = Object.keys(data[0]).map((k) => ({ wch: /notes|points|items|address|attendees/i.test(k) ? 42 : Math.min(28, Math.max(12, k.length + 2)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Meetings");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="meetings-${stamp}.xlsx"`,
        "Cache-Control": "no-store",
        "X-Row-Count": String(data.length),
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
