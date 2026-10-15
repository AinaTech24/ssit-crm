/**
 * Research's meetings: the ones handed to them, and the ones they hand on.
 *
 * Research does not run a book, so this panel deliberately shows NO clients and
 * none of their data — no names, AUM, counts or review status. It answers two
 * questions only:
 *   - what has an RM, back office or operations assigned to ME, and
 *   - what have I assigned to someone else.
 * Each row is the meeting itself (when, what, status) and the colleague on the
 * other side, with their sub-branch. A sub-branch dropdown narrows both lists.
 *
 * A meeting is "assigned to" someone when they are one of its collaborators and
 * did not book it; "assigned by" the person who booked it for others.
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { CalendarCheck, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/rbac";
import { ResearchUnitFilter } from "./ResearchUnitFilter";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MeetingRow = {
  id: string;
  meeting_date: string;
  status: string;
  meeting_type: string | null;
  subject: string | null;
  created_by_id: string | null;
  collaborator_ids: string[] | null;
};
type Person = { id: string; name: string; roles: string[] | null; desk_id: string | null; desk_name: string | null };

function fmt(d: string): string {
  return new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}
const label = (s: string | null) => (s ?? "").replace(/_/g, " ");
const roleOf = (p?: Person) => (p?.roles?.[0] ? ROLE_LABELS[p.roles[0]] ?? "" : "");

export async function ResearchMeetingsSection({
  session,
  deskId,
  userId,
  allResearch = false,
}: {
  session: SessionUser;
  /** ?unit=d:<id> — narrows to meetings with someone on this sub-branch. */
  deskId?: string;
  /** Whose meetings: this person. Defaults to the signed-in user. */
  userId?: string;
  /** An admin looking at research as a whole: every research user's meetings. */
  allResearch?: boolean;
}) {
  const uid = userId ?? session.userId;
  const unit = deskId && UUID_RE.test(deskId) ? deskId : undefined;
  const toMe: { m: MeetingRow; by?: Person }[] = [];
  const byMe: { m: MeetingRow; to: Person[] }[] = [];
  let desks: { id: string; name: string }[] = [];

  try {
    const data = await withTenant(session.tenantId, async (tx) => {
      const raRes = allResearch
        ? await tx.execute(sql`
            SELECT id FROM users
             WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' AND 'ra_research' = ANY(roles)
          `)
        : { rows: [{ id: uid }] };
      const raIds = (raRes.rows as { id: string }[]).map((r) => String(r.id));
      const people = new Map<string, Person>();
      if (raIds.length === 0) return { meetings: [] as MeetingRow[], people, desks: [] as { id: string; name: string }[], raIds };
      const idList = sql`ARRAY[${sql.join(raIds.map((i) => sql`${i}`), sql`, `)}]::text[]`;

      const meetingsRes = await tx.execute(sql`
        SELECT m.id, m.meeting_date, m.status, m.meeting_type, m.subject,
               m.created_by_id, m.collaborator_ids
          FROM review_meetings m
         WHERE m.tenant_id = ${session.tenantId}::uuid
           AND (m.created_by_id::text = ANY(${idList})
                OR jsonb_exists_any(COALESCE(m.collaborator_ids, '[]'::jsonb), ${idList}))
         ORDER BY m.meeting_date DESC
         LIMIT 200
      `);
      const meetings = meetingsRes.rows as unknown as MeetingRow[];

      const ids = new Set<string>();
      for (const m of meetings) {
        if (m.created_by_id) ids.add(String(m.created_by_id));
        for (const c of m.collaborator_ids ?? []) ids.add(String(c));
      }
      if (ids.size) {
        const pr = await tx.execute(sql`
          SELECT u.id, u.name, u.roles, u.desk_id, d.name AS desk_name
            FROM users u LEFT JOIN desks d ON d.id = u.desk_id
           WHERE u.tenant_id = ${session.tenantId}::uuid
             AND u.id::text = ANY(ARRAY[${sql.join([...ids].map((i) => sql`${i}`), sql`, `)}]::text[])
        `);
        for (const p of pr.rows as unknown as Person[]) people.set(String(p.id), { ...p, id: String(p.id) });
      }
      const deskRes = await tx.execute(sql`
        SELECT id, name FROM desks WHERE tenant_id = ${session.tenantId}::uuid ORDER BY name ASC
      `);
      return { meetings, people, desks: deskRes.rows as unknown as { id: string; name: string }[], raIds };
    });

    desks = data.desks.map((d) => ({ id: String(d.id), name: d.name ?? "—" }));
    const ra = new Set(data.raIds);
    const inUnit = (p?: Person) => !unit || p?.desk_id === unit;

    for (const m of data.meetings) {
      const collabs = (m.collaborator_ids ?? []).map(String);
      const creator = m.created_by_id ? String(m.created_by_id) : null;
      // Handed to research by someone else.
      if (collabs.some((c) => ra.has(c)) && creator && !ra.has(creator)) {
        const by = data.people.get(creator);
        if (inUnit(by)) toMe.push({ m, by });
      }
      // Booked by research for someone else.
      if (creator && ra.has(creator)) {
        const to = collabs
          .filter((c) => !ra.has(c))
          .map((c) => data.people.get(c))
          .filter((p): p is Person => !!p);
        if (to.length && (!unit || to.some((p) => p.desk_id === unit))) byMe.push({ m, to });
      }
    }
  } catch (err) {
    console.error("[research-meetings] failed", err instanceof Error ? err.message : err);
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-lg bg-violet-50 grid place-items-center">
            <CalendarCheck className="size-3.5 text-violet-600" />
          </div>
          <div>
            <div className="font-medium text-sm">Meetings</div>
            <div className="text-[11px] text-muted-foreground">Assigned to research, and assigned by research</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ResearchUnitFilter options={desks} selected={unit} />
          <Link href="/dashboard/review-meetings" className="text-xs text-violet-700 hover:underline font-medium">
            All meetings →
          </Link>
        </div>
      </div>

      <MeetingTable
        title="Assigned to me"
        icon={<ArrowDownLeft className="size-3.5 text-emerald-600" />}
        who="Assigned by"
        empty="Nothing has been assigned to you yet."
        rows={toMe.map(({ m, by }) => ({ m, people: by ? [by] : [] }))}
      />
      <MeetingTable
        title="Assigned by me"
        icon={<ArrowUpRight className="size-3.5 text-sky-600" />}
        who="Assigned to"
        empty="You have not assigned a meeting to anyone yet."
        rows={byMe.map(({ m, to }) => ({ m, people: to }))}
      />
    </div>
  );
}

function MeetingTable({
  title,
  icon,
  who,
  empty,
  rows,
}: {
  title: string;
  icon: React.ReactNode;
  who: string;
  empty: string;
  rows: { m: MeetingRow; people: Person[] }[];
}) {
  return (
    <div className="border rounded-lg bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-2.5 text-sm font-medium">
        {icon} {title}
        <span className="chip bg-secondary text-[10px] px-2 py-0.5">{rows.length}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs table-modern">
          <thead>
            <tr>
              <th className="text-left py-1.5 px-3">When</th>
              <th className="text-left py-1.5 px-3">Meeting</th>
              <th className="text-left py-1.5 px-3">{who}</th>
              <th className="text-left py-1.5 px-3">Sub-branch</th>
              <th className="text-left py-1.5 px-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 px-3 text-center text-muted-foreground">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map(({ m, people }) => (
                <tr key={m.id}>
                  <td className="py-2 px-3 whitespace-nowrap">{fmt(m.meeting_date)}</td>
                  <td className="py-2 px-3">
                    <Link href={`/dashboard/review-meetings/${m.id}`} className="font-medium hover:underline capitalize">
                      {m.subject || label(m.meeting_type) || "Meeting"}
                    </Link>
                  </td>
                  <td className="py-2 px-3">
                    {people.length === 0
                      ? "—"
                      : people.map((p) => (
                          <div key={p.id}>
                            {p.name}
                            {roleOf(p) && <span className="text-muted-foreground"> · {roleOf(p)}</span>}
                          </div>
                        ))}
                  </td>
                  <td className="py-2 px-3">
                    {[...new Set(people.map((p) => p.desk_name).filter(Boolean))].join(", ") || "—"}
                  </td>
                  <td className="py-2 px-3 capitalize">{label(m.status)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
