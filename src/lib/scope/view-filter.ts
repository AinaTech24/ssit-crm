/**
 * "Show me one sub-branch, or one person" — as a filter any list page can use.
 *
 * This is a VIEW filter, not a wall. The data wall (lib/auth/data-scope.ts)
 * still decides what a session may see at all; this narrows what is on screen
 * within that, so a firm admin can look at one desk or one RM without changing
 * anybody's permissions. Applied on top of the wall, never instead of it — a
 * branch head who picks another desk from the dropdown still sees nothing they
 * were not already allowed to see.
 *
 * The dashboard has had this shape for a while (`?unit=` + `?rm=`, see
 * components/dashboards/DashboardScopeFilter). Clients, Leads, Tasks, Service
 * Requests and Command Center now read the SAME two params, so a chosen desk
 * survives moving between modules instead of resetting at each one.
 *
 * Unit values are prefixed so branch and desk ids can share one control:
 *   "b:<branchId>"  a whole branch
 *   "d:<deskId>"    one desk (a sub-branch)
 */

import { sql, type SQL } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/rbac";
import { explainDataScope } from "@/lib/auth/data-scope";

export type ScopeUnit = {
  /** "b:<branchId>" or "d:<deskId>". */
  value: string;
  label: string;
  /** 0 = branch, 1 = a desk inside it. */
  depth: number;
};

export type ScopeMember = { id: string; name: string; roleLabel: string };

export type ScopeSelection = {
  /** Raw ?unit= value, e.g. "d:8f3…". */
  unit: string;
  /** Raw ?rm= value — one person's id. */
  rm: string;
  branchId: string | null;
  deskId: string | null;
};

/** Read the two params off a page's searchParams. */
export function parseScope(sp: Record<string, string | undefined>): ScopeSelection {
  const unit = (sp.unit ?? "").trim();
  const rm = (sp.rm ?? "").trim();
  return {
    unit,
    rm,
    branchId: unit.startsWith("b:") ? unit.slice(2) : null,
    deskId: unit.startsWith("d:") ? unit.slice(2) : null,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The selection as a SQL predicate over a record's OWNER column(s).
 *
 * Derived from who owns the record, not from a branch/desk column on the
 * record itself — those are stamped at creation and drift the moment the
 * record is reassigned or its owner moves desk. Same rule the data wall uses,
 * so the filter and the wall can never disagree about which desk a record is
 * "in".
 *
 * Returns TRUE when nothing is selected, so callers can AND it unconditionally.
 */
export function scopeFilterSql(
  sel: ScopeSelection,
  tenantId: string,
  ownerCol: string | string[]
): SQL {
  const cols = Array.isArray(ownerCol) ? ownerCol : [ownerCol];
  const owners = sql.join(
    cols.map((c) => sql`${sql.raw(c)}`),
    sql`, `
  );

  // A person beats a unit: picking an RM inside a desk means that RM.
  if (sel.rm && UUID_RE.test(sel.rm)) {
    return sql`(${sql.join(
      cols.map((c) => sql`${sql.raw(c)} = ${sel.rm}::uuid`),
      sql` OR `
    )})`;
  }
  if (sel.deskId && UUID_RE.test(sel.deskId)) {
    return sql`EXISTS (
      SELECT 1 FROM users su
      WHERE su.id IN (${owners})
        AND su.tenant_id = ${tenantId}::uuid
        AND su.desk_id = ${sel.deskId}::uuid
    )`;
  }
  if (sel.branchId && UUID_RE.test(sel.branchId)) {
    return sql`EXISTS (
      SELECT 1 FROM users su
      WHERE su.id IN (${owners})
        AND su.tenant_id = ${tenantId}::uuid
        AND su.branch_id = ${sel.branchId}::uuid
    )`;
  }
  return sql`TRUE`;
}

/**
 * The ONE desk (sub-branch) this session is confined to, or null.
 *
 * Taken from the data wall itself rather than re-derived from roles, so the
 * pickers can never offer a desk the wall would then refuse to show — or hide
 * one it would. A sub-branch head gets their desk; the firm admin, back office
 * and anyone with a wider grant get null.
 */
export async function confinedDeskId(tx: any, session: SessionUser): Promise<string | null> {
  const { scope } = await explainDataScope(tx, session);
  return scope.kind === "desks" && scope.deskIds.length === 1 ? scope.deskIds[0] : null;
}

/**
 * The branches and desks this session may look at, as one indented list.
 *
 * A branch head is held to their own branch: the picker must not hand them
 * every other branch's roster, which is the same rule the dashboard applies.
 */
export async function loadScopeUnits(
  tx: any,
  session: SessionUser
): Promise<{ units: ScopeUnit[]; branchIds: string[] }> {
  const confined = await confinedDeskId(tx, session);
  const [branchRes, deskRes] = await Promise.all([
    tx.execute(sql`
      SELECT id, name FROM branches
      WHERE tenant_id = ${session.tenantId}::uuid
      ORDER BY name ASC
    `),
    tx.execute(sql`
      SELECT id, name, branch_id FROM desks
      WHERE tenant_id = ${session.tenantId}::uuid
      ORDER BY name ASC
    `),
  ]);

  const all = (branchRes.rows as { id: string; name: string | null }[]).map((b) => ({
    id: String(b.id),
    name: b.name ?? "—",
  }));
  const branchScoped =
    !session.roles.includes("owner") && session.roles.includes("branch_head") && !!session.branchId;
  const branches = branchScoped ? all.filter((b) => b.id === session.branchId) : all;
  const branchIds = new Set(branches.map((b) => b.id));
  const desks = (deskRes.rows as { id: string; name: string | null; branch_id: string }[])
    .filter((d) => branchIds.has(String(d.branch_id)))
    // A desk head sees their own desk and no other — not the sibling
    // sub-branches the registered office also holds.
    .filter((d) => !confined || String(d.id) === confined)
    .map((d) => ({ id: String(d.id), name: d.name ?? "—", branchId: String(d.branch_id) }));

  const units: ScopeUnit[] = [];
  if (confined) {
    // One entry, no branch above it: nothing to choose between.
    for (const d of desks) units.push({ value: `d:${d.id}`, label: d.name, depth: 0 });
    return { units, branchIds: [...branchIds] };
  }
  for (const b of branches) {
    units.push({ value: `b:${b.id}`, label: b.name, depth: 0 });
    for (const d of desks.filter((x) => x.branchId === b.id)) {
      units.push({ value: `d:${d.id}`, label: d.name, depth: 1 });
    }
  }
  return { units, branchIds: [...branchIds] };
}

/**
 * The people in the selected unit, for the second dropdown.
 *
 * Empty until a unit is chosen — a firm-wide list of every employee is not a
 * useful thing to scroll, and the point of the first dropdown is to cut it
 * down. The role rides along in brackets so picking a person does not need a
 * third "which role" step.
 */
export async function loadScopeMembers(
  tx: any,
  session: SessionUser,
  sel: ScopeSelection
): Promise<ScopeMember[]> {
  // A desk head's team is their desk, whatever the URL says — and nothing
  // picked from the URL may reach a unit this session cannot see, or the
  // roster of another sub-branch leaks through the dropdown.
  const confined = await confinedDeskId(tx, session);
  const { units } = await loadScopeUnits(tx, session);
  const allowed = new Set(units.map((u) => u.value));
  const deskId = confined ?? sel.deskId;
  const branchId = confined ? null : sel.branchId;
  if (!deskId && !branchId) return [];
  if (deskId && !allowed.has(`d:${deskId}`)) return [];
  if (branchId && !allowed.has(`b:${branchId}`)) return [];
  const where = deskId
    ? sql`desk_id = ${deskId}::uuid`
    : sql`branch_id = ${branchId}::uuid`;
  const r = await tx.execute(sql`
    SELECT id, name, roles FROM users
    WHERE tenant_id = ${session.tenantId}::uuid
      AND status = 'active'
      AND ${where}
    ORDER BY name ASC
  `);
  return (r.rows as { id: string; name: string | null; roles: string[] | null }[]).map((u) => ({
    id: String(u.id),
    name: u.name ?? "—",
    roleLabel: ROLE_LABELS[(u.roles ?? [])[0] ?? ""] ?? "Team member",
  }));
}

/**
 * Should this session be offered the picker at all?
 *
 * Anyone whose view covers more than their own records: a firm admin, back
 * office, or a branch head (who gets their own branch and its desks). An RM
 * sees their own book whatever the dropdown said, so offering it would only
 * be a control that does nothing.
 */
export function canPickScope(session: SessionUser): boolean {
  return session.roles.some((r) =>
    ["owner", "back_office", "ops", "branch_head"].includes(r)
  );
}
