/**
 * The AMC meetings table — every meeting recorded with any AMC, newest first,
 * with the "Create meeting" action when the viewer may add one.
 *
 * Shared by the AMC Empanelments page (its "AMC meetings" tab) and the stand-alone
 * AMC Meetings dashboard, so the two can never drift apart.
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { AMC_MODE_LABEL } from "@/db/schema";
import { AddAmcMeetingButton } from "@/components/amc-empanelments/AddAmcMeetingButton";

type MeetingRow = {
  id: string; meeting_date: string; subject: string; attendees: string | null;
  notes: string | null; follow_up: string | null; mode: string | null; collaborator_names: string | null;
  amc_id: string; amc_name: string; author_name: string | null;
};

const fmt = (d: string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export async function AmcMeetingsView({
  session,
  canAdd,
  linkAmc,
  title,
  tabs,
}: {
  session: SessionUser;
  canAdd: boolean;
  /** Link each AMC to its detail page — only for people who can open it. */
  linkAmc: boolean;
  title: string;
  tabs?: React.ReactNode;
}) {
  // The picker offers the firm's AMC catalogue merged with the standard list
  // (done in the picker), so it is never empty on a firm with no empanelments.
  const { catalog, branchOptions, meetings } = await withTenant(session.tenantId, async (tx) => {
    const c = await tx.execute(sql`
      SELECT code, name, (COALESCE(is_active, true) = false) AS inactive FROM amc_master
       WHERE tenant_id = ${session.tenantId}::uuid
       ORDER BY name ASC LIMIT 400
    `);
    const b = await tx.execute(sql`SELECT id, name FROM branches WHERE tenant_id = ${session.tenantId}::uuid ORDER BY name ASC`);
    const r = await tx.execute(sql`
      SELECT m.id, m.meeting_date, m.subject, m.attendees, m.notes, m.follow_up, m.mode,
             e.id AS amc_id, e.amc_name, u.name AS author_name,
             (SELECT string_agg(cu.name, ', ' ORDER BY cu.name) FROM users cu
               WHERE m.collaborator_user_ids ? cu.id::text) AS collaborator_names
        FROM amc_meetings m
        JOIN amc_empanelments e ON e.id = m.amc_empanelment_id
        LEFT JOIN users u ON u.id = m.created_by_user_id
       WHERE m.tenant_id = ${session.tenantId}::uuid
       ORDER BY m.meeting_date DESC, m.created_at DESC
       LIMIT 300
    `);
    return {
      catalog: c.rows as Array<{ code: string; name: string; inactive?: boolean }>,
      branchOptions: b.rows as Array<{ id: string; name: string }>,
      meetings: r.rows as MeetingRow[],
    };
  });

  const monthKey = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7); // IST month
  const stats = [
    { label: "Meetings", value: meetings.length },
    { label: "This month", value: meetings.filter((m) => String(m.meeting_date).slice(0, 7) === monthKey).length },
    { label: "AMCs met", value: new Set(meetings.map((m) => m.amc_id)).size },
    { label: "With follow-up", value: meetings.filter((m) => (m.follow_up ?? "").trim() !== "").length },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {canAdd && <AddAmcMeetingButton catalog={catalog} branches={branchOptions} currentUserId={session.userId} />}
      </div>
      {tabs}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="card-surface p-3">
            <div className="text-[11px] text-muted-foreground">{s.label}</div>
            <div className="text-xl font-semibold tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>
      {meetings.length === 0 ? (
        <div className="card-surface p-12 text-center text-sm text-muted-foreground">
          No AMC meetings recorded yet.{canAdd ? " Use “Create meeting” to add the first one." : ""}
        </div>
      ) : (
        <div className="card-surface table-scroll">
          <table className="w-full text-xs min-w-[1100px]">
            <thead className="bg-muted/50 text-muted-foreground sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">AMC</th>
                <th className="px-3 py-2 text-left">Subject</th>
                <th className="px-3 py-2 text-left">Mode</th>
                <th className="px-3 py-2 text-left">Attendees</th>
                <th className="px-3 py-2 text-left">Collaborators</th>
                <th className="px-3 py-2 text-left">Notes</th>
                <th className="px-3 py-2 text-left">Follow-up</th>
                <th className="px-3 py-2 text-left">Added by</th>
              </tr>
            </thead>
            <tbody>
              {meetings.map((m) => (
                <tr key={m.id} className="border-t hover:bg-slate-50/60 align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{fmt(m.meeting_date)}</td>
                  <td className="px-3 py-2">
                    {linkAmc ? (
                      <Link href={`/dashboard/amc-empanelments/${m.amc_id}?tab=meetings`} className="font-medium hover:underline">
                        {m.amc_name}
                      </Link>
                    ) : (
                      <span className="font-medium">{m.amc_name}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{m.subject}</td>
                  <td className="px-3 py-2">
                    {m.mode ? <span className="chip bg-secondary text-[10px]">{AMC_MODE_LABEL[m.mode] ?? m.mode}</span> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{m.attendees || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{m.collaborator_names || "—"}</td>
                  <td className="px-3 py-2 max-w-xs whitespace-pre-wrap">{m.notes || "—"}</td>
                  <td className="px-3 py-2 max-w-xs whitespace-pre-wrap">{m.follow_up || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{m.author_name || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
