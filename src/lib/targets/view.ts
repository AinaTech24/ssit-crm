/**
 * Which targets a signed-in user may see, with the achievement worked out.
 *
 *   owner         every target, shown or not
 *   everyone else only targets the admin left "visible":
 *                   · their own,
 *                   · their branch's / desk's,
 *                   · a branch head also sees the people in their branch / desk.
 */

import { sql } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import {
  achievementFor,
  loadMembership,
  loadUserActuals,
  METRIC_BY_KEY,
  type SubjectType,
} from "./index";

type Rec = Record<string, any>;
export type SubjectCard = {
  subjectType: SubjectType;
  subjectId: string;
  name: string;
  metrics: { key: string; label: string; unit: "count" | "inr"; target: number; actual: number; visible: boolean }[];
};

export async function loadVisibleTargets(tx: any, session: SessionUser, period: string): Promise<SubjectCard[]> {
  const isOwner = session.roles.includes("owner");
  const rows = (
    await tx.execute(sql`
      SELECT subject_type, subject_id, metric_key, target_value, visible
        FROM target_goals
       WHERE tenant_id = ${session.tenantId}::uuid AND period = ${period}
    `)
  ).rows as { subject_type: SubjectType; subject_id: string; metric_key: string; target_value: string; visible: boolean }[];
  if (rows.length === 0) return [];

  const membership = await loadMembership(tx, session.tenantId);
  const me = membership.users.find((u) => u.id === session.userId);
  const isHead = session.roles.includes("branch_head");

  const myBranch = me?.branch_id ?? null;
  const myDesk = me?.desk_id ?? null;
  const allowedUsers = new Set<string>([session.userId]);
  if (isHead) {
    for (const u of membership.users) {
      if (myDesk ? u.desk_id === myDesk : myBranch && u.branch_id === myBranch) allowedUsers.add(u.id);
    }
  }

  const mayShow = (r: { subject_type: SubjectType; subject_id: string; visible: boolean }) => {
    if (isOwner) return true;
    if (!r.visible) return false;
    if (r.subject_type === "user") return allowedUsers.has(r.subject_id);
    if (r.subject_type === "branch") return r.subject_id === myBranch;
    return r.subject_id === myDesk;
  };
  const shown = rows.filter(mayShow);
  if (shown.length === 0) return [];

  const actuals = await loadUserActuals(tx, session.tenantId, period);

  const names = new Map<string, string>();
  for (const u of membership.users) names.set(`user:${u.id}`, u.name ?? "—");
  const [br, dk] = await Promise.all([
    tx.execute(sql`SELECT id, name FROM branches WHERE tenant_id = ${session.tenantId}::uuid`),
    tx.execute(sql`SELECT id, name FROM desks WHERE tenant_id = ${session.tenantId}::uuid`),
  ]);
  for (const b of br.rows as Rec[]) names.set(`branch:${b.id}`, b.name);
  for (const d of dk.rows as Rec[]) names.set(`desk:${d.id}`, d.name);

  const cards = new Map<string, SubjectCard>();
  for (const r of shown) {
    const meta = METRIC_BY_KEY.get(r.metric_key);
    if (!meta) continue;
    const key = `${r.subject_type}:${r.subject_id}`;
    const card =
      cards.get(key) ??
      cards
        .set(key, {
          subjectType: r.subject_type,
          subjectId: r.subject_id,
          name: names.get(key) ?? "—",
          metrics: [],
        })
        .get(key)!;
    card.metrics.push({
      key: meta.key,
      label: meta.label,
      unit: meta.unit,
      target: Number(r.target_value),
      actual: achievementFor(actuals, membership, {
        subjectType: r.subject_type,
        subjectId: r.subject_id,
        metricKey: r.metric_key,
      }),
      visible: r.visible,
    });
  }
  const order = [...METRIC_BY_KEY.keys()];
  for (const c of cards.values()) c.metrics.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  // Yours first, then your branch / desk, then everyone else.
  const rank = (c: SubjectCard) => (c.subjectType === "user" && c.subjectId === session.userId ? 0 : c.subjectType === "user" ? 2 : 1);
  return [...cards.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
