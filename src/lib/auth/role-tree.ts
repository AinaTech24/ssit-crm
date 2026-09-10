/**
 * The org chart of roles, as a two-level tree.
 *
 * `Role` in rbac.ts is a FLAT list — every role is a peer, which is what the
 * capability matrix wants (a grant is per role, full stop). But the firm does
 * not think flat: "RA" is one function that happens to split into Research and
 * Sales, and a firm admin looking at a branch wants to pick RA and see both,
 * or drill to just the research desk.
 *
 * So this file adds the hierarchy WITHOUT touching the capability matrix. A
 * parent node is a grouping over its children, never something a user is
 * assigned — `ra` is not a Role and grants nothing on its own. Assignment and
 * permissions stay exactly where they were; only the way roles are presented
 * and filtered gains a level.
 *
 * Adding a sub-role later: add the real role to rbac.ts (union, labels,
 * capability grants), then list it as a child here.
 */

import { ROLE_LABELS } from "./rbac";

export type RoleNode = {
  /** Stable key for URLs. For a leaf this is the real rbac Role. */
  key: string;
  label: string;
  /** Real rbac roles this node covers — itself for a leaf, all children for a parent. */
  roles: string[];
  children?: RoleNode[];
};

/**
 * Display order matches how a branch is actually read: who runs it, who owns
 * clients, then the supporting desks.
 */
export const ROLE_TREE: RoleNode[] = [
  { key: "branch_head", label: ROLE_LABELS.branch_head, roles: ["branch_head"] },
  { key: "rm", label: ROLE_LABELS.rm, roles: ["rm"] },
  // back_office and ops are the same desk under two legacy keys — one node.
  { key: "back_office", label: ROLE_LABELS.back_office, roles: ["back_office", "ops"] },
  { key: "insurance", label: ROLE_LABELS.insurance, roles: ["insurance"] },
  { key: "ria", label: ROLE_LABELS.ria, roles: ["ria"] },
  {
    key: "ra",
    label: "RA",
    roles: ["ra_research", "ra_sales"],
    children: [
      { key: "ra_research", label: "RA — Research", roles: ["ra_research"] },
      { key: "ra_sales", label: "RA — Sales", roles: ["ra_sales"] },
    ],
  },
  { key: "sub_broker", label: ROLE_LABELS.sub_broker, roles: ["sub_broker"] },
  { key: "marketing", label: ROLE_LABELS.marketing, roles: ["marketing"] },
  { key: "compliance", label: ROLE_LABELS.compliance, roles: ["compliance"] },
];

/** Flat walk of the tree, parents before their children. */
export function flattenRoleTree(): Array<RoleNode & { depth: number }> {
  const out: Array<RoleNode & { depth: number }> = [];
  for (const n of ROLE_TREE) {
    out.push({ ...n, depth: 0 });
    for (const c of n.children ?? []) out.push({ ...c, depth: 1 });
  }
  return out;
}

/** Look up a node by key, at either level. Returns undefined for an unknown key. */
export function findRoleNode(key: string | null | undefined): RoleNode | undefined {
  if (!key) return undefined;
  for (const n of ROLE_TREE) {
    if (n.key === key) return n;
    for (const c of n.children ?? []) if (c.key === key) return c;
  }
  return undefined;
}

/**
 * The rbac roles a scope key selects. An unknown key selects nothing rather
 * than everything — a filter that silently widens is worse than one that
 * returns an empty list.
 */
export function rolesForKey(key: string | null | undefined): string[] {
  return findRoleNode(key)?.roles ?? [];
}

/**
 * The node a user belongs to for grouping: their most specific role, preferring
 * a sub-role over its parent, and taking the first match in tree order so a
 * user who is "owner + rm" files under RM rather than inventing a group.
 */
export function primaryRoleNode(userRoles: string[] | null | undefined): RoleNode | undefined {
  const rs = userRoles ?? [];
  for (const n of ROLE_TREE) {
    for (const c of n.children ?? []) {
      if (c.roles.some((r) => rs.includes(r))) return c;
    }
    if (n.roles.some((r) => rs.includes(r))) return n;
  }
  return undefined;
}
