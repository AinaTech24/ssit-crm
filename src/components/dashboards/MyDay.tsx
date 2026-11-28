import Link from "next/link";
import { sql, type SQL } from "drizzle-orm";
import { AlertCircle, Phone } from "lucide-react";
import { withTenant, type Tx } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { taskMineSql, taskScopeSql, taskTeamIds } from "@/lib/tasks/access";
import { istDayBounds } from "@/lib/dates/ist";
import { formatDate } from "@/lib/utils";
import { DashboardEmptyState } from "./DashboardEmptyState";

/**
 * One person's day: the follow-ups due today (earlier ones folded away) and every task still open -
 * theirs, the ones they handed to others, their shared task team's and, for a branch head, the team's.
 * Used on their own dashboard, when a manager views them, and on top of a branch head's team view.
 */

/** Lists scroll; the number beside each title is always the true total (COUNT(*) OVER ()). */
const LIST_CAP = 200;

type Row = Record<string, any>;
export type MyDayData = { followUps: Row[]; overdueFollowUps: Row[]; myTasks: Row[]; teamView: boolean };

/** The true size of a list that was read with COUNT(*) OVER (). */
export function totalOf(rows: Row[]): number {
  return Number(rows[0]?.total_count ?? 0);
}

/** A lead (alias `l`) still being worked. */
export const openLeadSql = sql`l.converted_investor_id IS NULL AND l.stage NOT IN ('converted', 'lost', 'not_interested', 'cold')
  AND l.deleted_at IS NULL AND l.lost_reason IS DISTINCT FROM '__deleted__'`;

export async function loadMyDay(tx: Tx, viewer: SessionUser, userId: string): Promise<MyDayData> {
  const tenantId = viewer.tenantId;
  const { start: dayStart, end: dayEnd } = istDayBounds();
  const rowsOf = async (q: SQL) => (await tx.execute(q)).rows as Row[];
  const openTask = sql`t.tenant_id = ${tenantId}::uuid AND t.deleted_at IS NULL
    AND t.status IN ('open', 'in_progress', 'blocked') AND ${taskMineSql("t", userId)}`;

  // Leads, tasks and client / contact follow-ups. `when` picks today's or the earlier ones.
  const followUpRows = (when: (col: SQL, isActivity?: boolean) => SQL) =>
    rowsOf(sql`
      SELECT f.*, COUNT(*) OVER ()::int AS total_count FROM (
        SELECT 'lead' AS kind, l.id, l.name AS title, l.next_follow_up_at AS due_at,
               '/dashboard/leads/' || l.id::text AS href
          FROM leads l
         WHERE l.tenant_id = ${tenantId}::uuid AND l.owner_id = ${userId}::uuid AND ${openLeadSql}
           AND ${when(sql`l.next_follow_up_at`)}
        UNION ALL
        SELECT 'task', t.id, t.title, t.due_at, '/dashboard/tasks?task=' || t.id::text
          FROM tasks t WHERE ${openTask} AND ${when(sql`t.due_at`)}
        UNION ALL
        SELECT 'follow-up', a.id, COALESCE(a.subject_name, a.subject, 'Follow-up'), a.next_followup_at,
               CASE a.subject_type WHEN 'investor' THEN '/dashboard/investors/' || a.subject_id::text
                                   WHEN 'lead' THEN '/dashboard/leads/' || a.subject_id::text
                                   ELSE '/dashboard/activities' END
          FROM activities a
         WHERE a.tenant_id = ${tenantId}::uuid AND a.owner_user_id = ${userId}::uuid
           AND ${when(sql`a.next_followup_at`, true)}
           -- the same lead with the same day's follow-up is listed once
           AND NOT (a.subject_type = 'lead' AND EXISTS (
                 SELECT 1 FROM leads l WHERE l.id = a.subject_id AND l.owner_id = ${userId}::uuid AND ${openLeadSql}
                    AND ${when(sql`l.next_follow_up_at`)}))
      ) f
      ORDER BY f.due_at ASC LIMIT ${LIST_CAP}
    `);

  const followUps = await followUpRows((col) => sql`${col} >= ${dayStart} AND ${col} < ${dayEnd}`);
  // Client follow-ups older than a month are left out of "overdue": they have no "done" mark, so they
  // would pile up for ever.
  const monthAgo = new Date(dayStart.getTime() - 30 * 86_400_000);
  const overdueFollowUps = await followUpRows((col, isActivity) =>
    isActivity ? sql`${col} >= ${monthAgo} AND ${col} < ${dayStart}` : sql`${col} < ${dayStart}`
  );
  // Open tasks the person has a hand in, matching the Tasks page: theirs to do, ones they assigned or must
  // approve, and their shared task team's. A branch head on their own dashboard also gets the team's.
  const teamView = viewer.userId === userId && viewer.roles.includes("branch_head") && !viewer.roles.includes("owner");
  const mine = sql`COALESCE(${taskMineSql("t", userId)}, FALSE)`;
  let related: SQL;
  if (teamView) {
    related = await taskScopeSql(tx, viewer, "t");
  } else {
    const team = await taskTeamIds(tx, tenantId, userId);
    const ids = sql.join(team.map((id) => sql`${id}::uuid`), sql`, `);
    const shared = team.length ? sql` OR t.assignee_id IN (${ids}) OR t.created_by_id IN (${ids})` : sql``;
    related = sql`(${mine} OR t.created_by_id = ${userId}::uuid OR t.meta->>'approverId' = ${userId}${shared})`;
  }
  const myTasks = await rowsOf(sql`
    SELECT t.id, t.title, t.priority, t.status, t.due_at, u.name AS assignee_name, ${mine} AS is_mine,
           COUNT(*) OVER ()::int AS total_count
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assignee_id
     WHERE t.tenant_id = ${tenantId}::uuid AND t.deleted_at IS NULL
       AND t.status IN ('open', 'in_progress', 'blocked') AND t.type <> 'other_activity'
       AND ${related}
     ORDER BY is_mine DESC, t.due_at ASC NULLS LAST, t.created_at DESC LIMIT ${LIST_CAP}
  `);
  return { followUps, overdueFollowUps, myTasks, teamView };
}

export function ScrollList({ children }: { children: React.ReactNode }) {
  return <ul className="divide-y max-h-80 overflow-y-auto scrollbar-thin pr-1">{children}</ul>;
}

export function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="card-surface glass-card p-5">
      <div className="font-semibold flex items-center justify-between mb-3">
        <span className="text-sm font-semibold tracking-tight text-foreground/90">{title}</span>
        {count !== undefined && (
          <span className="chip bg-brand-cyan-light text-brand-cyan-deep text-xs font-semibold px-2 py-0.5">
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

/** "3:30 pm" in Indian time; a follow-up saved with only a date reads "today". */
function timeOfDay(at: string | Date): string {
  const d = new Date(at);
  const t = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
  const dateOnly = /^(12|0):00\s*am$/i.test(t) || d.toISOString().slice(11, 19) === "00:00:00";
  return dateOnly ? "today" : t;
}

function FollowUpRow({ f, when }: { f: Row; when: string }) {
  return (
    <li className="py-2 flex items-center justify-between text-sm gap-2">
      <Link href={f.href} className="flex items-center gap-2 hover:underline min-w-0">
        <span className={f.kind === "task" ? "pulse-danger-dot" : "pulse-warning-dot"} />
        {f.kind === "task" ? <AlertCircle className="size-3.5 text-primary" /> : <Phone className="size-3.5 text-primary" />}
        <span className="truncate">{f.title}</span>
        <span className="text-xs uppercase text-muted-foreground">{f.kind}</span>
      </Link>
      <span className="text-xs text-muted-foreground whitespace-nowrap">{when}</span>
    </li>
  );
}

export function FollowUpsBox({ data, title = "Follow-ups today" }: { data: MyDayData; title?: string }) {
  return (
    <Section title={title} count={totalOf(data.followUps)}>
      {data.followUps.length === 0 ? (
        <DashboardEmptyState compact title="No follow-ups due today 🎉" hint="Nothing is scheduled for today." />
      ) : (
        <ScrollList>
          {data.followUps.map((f) => (
            <FollowUpRow key={`${f.kind}-${f.id}`} f={f} when={timeOfDay(f.due_at)} />
          ))}
        </ScrollList>
      )}
      {totalOf(data.overdueFollowUps) > 0 && (
        <details className="mt-3 border-t pt-3">
          <summary className="cursor-pointer text-xs font-semibold text-destructive">
            Overdue from earlier days ({totalOf(data.overdueFollowUps)})
          </summary>
          <div className="mt-2">
            <ScrollList>
              {data.overdueFollowUps.map((f) => (
                <FollowUpRow key={`${f.kind}-${f.id}`} f={f} when={formatDate(f.due_at)} />
              ))}
            </ScrollList>
          </div>
        </details>
      )}
    </Section>
  );
}

export function OpenTasksBox({ data, title }: { data: MyDayData; title: string }) {
  const { start: dayStart } = istDayBounds();
  return (
    <Section title={title} count={totalOf(data.myTasks)}>
      <p className="text-[11px] text-muted-foreground -mt-2 mb-2">
        {data.teamView ? "Yours first, then your team's" : "Assigned to or by this person, and their shared task team's"}
      </p>
      {data.myTasks.length === 0 ? (
        <DashboardEmptyState compact title="No open tasks 🎉" hint="Your task list is clear. Nice work staying on top of things." />
      ) : (
        <ScrollList>
          {data.myTasks.map((t) => {
            const late = t.due_at && new Date(t.due_at) < dayStart;
            return (
              <li key={t.id} className="py-2 flex items-center justify-between text-sm gap-2">
                <Link href={`/dashboard/tasks?task=${t.id}`} className="flex items-center gap-2 hover:underline min-w-0">
                  <span className="truncate">{t.title}</span>
                  <span className="text-xs uppercase text-muted-foreground">{t.priority}</span>
                  {t.status !== "open" && <span className="chip text-[10px] bg-secondary capitalize">{String(t.status).replace(/_/g, " ")}</span>}
                  {!t.is_mine && <span className="chip text-[10px] bg-secondary whitespace-nowrap">For {t.assignee_name ?? "nobody yet"}</span>}
                </Link>
                <span className={`text-xs whitespace-nowrap ${late ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                  {t.due_at ? formatDate(t.due_at) : "no due date"}
                </span>
              </li>
            );
          })}
        </ScrollList>
      )}
    </Section>
  );
}

/** A branch head's own day above their team's numbers, or a manager's view of someone without a client book. */
export async function MyDayPanel({
  session,
  target,
  noLink,
}: {
  session: SessionUser;
  target?: { userId: string; name: string };
  /** For people with no personal dashboard to open. */
  noLink?: boolean;
}) {
  const userId = target?.userId ?? session.userId;
  const who = target ? `${target.name.split(" ")[0]}'s` : "My";
  let data: MyDayData;
  try {
    data = await withTenant(session.tenantId, (tx) => loadMyDay(tx, session, userId));
  } catch (err) {
    console.error("[my-day] failed", err instanceof Error ? err.message : err);
    return <div className="card-surface p-4 text-sm text-muted-foreground">Follow-ups and tasks couldn&apos;t load right now.</div>;
  }
  return (
    <div className="space-y-2 mb-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-bold tracking-tight">{target ? `${target.name}'s day` : "My day"}</h2>
        {!target && !noLink && (
          <Link href={`/dashboard?rm=${session.userId}`} className="text-xs text-primary hover:underline">
            Open my full dashboard →
          </Link>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FollowUpsBox data={data} title={`${who} follow-ups today`} />
        <OpenTasksBox data={data} title={data.teamView ? "Open tasks" : `${who} open tasks`} />
      </div>
    </div>
  );
}
