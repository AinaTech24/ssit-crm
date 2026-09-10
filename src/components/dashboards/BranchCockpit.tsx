/**
 * One branch, at a glance — the middle rung between the firm-wide cockpit and
 * one person's dashboard.
 *
 * Answers the two questions a firm admin actually has about a branch: who
 * staffs it (headcount by role — RMs, back office, insurance, RIA, RA…), and
 * what it is carrying (clients, AUM, SIP book, sales, pipeline, open work).
 *
 * Scoping rule: PEOPLE are scoped by users.branch_id. BOOK is scoped by
 * investors.branch_id rather than by "clients of this branch's RMs" — a client
 * can be reassigned to an RM at another branch without the client itself
 * moving, and the branch's book is the client list, not the staff list.
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { Building2, Users, Wallet, Repeat, TrendingUp, Target, ListChecks, LifeBuoy } from "lucide-react";
import { withTenant } from "@/db/client";
import { formatINR } from "@/lib/utils";
import { ROLE_TREE, findRoleNode, primaryRoleNode } from "@/lib/auth/role-tree";
import type { SessionUser } from "@/lib/auth/session";
import { DashboardEmptyState } from "@/components/dashboards/DashboardEmptyState";



type HeadRow = { role: string; n: number };
type TotalsRow = {
  clients: number;
  aum: string;
  sip_book: string;
  net_mtd: string;
  gross_mtd: string;
  open_leads: number;
  tasks_open: number;
  sr_open: number;
};
type MemberRow = {
  id: string;
  name: string | null;
  roles: string[] | null;
  clients: number;
  aum: string;
};

export async function BranchCockpit({
  session,
  branchId,
  branchName,
  roleKey,
}: {
  session: SessionUser;
  branchId: string;
  branchName: string;
  /** Optional ROLE_TREE key. Narrows the roster (never the branch's book — the
   *  branch carries its clients regardless of which desk you are looking at). */
  roleKey?: string;
}) {
  const roleNode = findRoleNode(roleKey);
  const data = await withTenant(session.tenantId, async (tx) => {
    const [headRes, totalsRes, membersRes] = await Promise.all([
      // unnest() so a user holding several roles is counted under each — an
      // "owner + rm" shows in the RM count, which is what staffing means here.
      tx.execute(sql`
        SELECT r AS role, count(*)::int AS n
          FROM users u, unnest(u.roles) AS r
         WHERE u.tenant_id = ${session.tenantId}::uuid
           AND u.branch_id = ${branchId}::uuid
           AND u.status = 'active'
         GROUP BY r
      `),
      tx.execute(sql`
        SELECT
          (SELECT count(*)::int FROM investors
            WHERE branch_id = ${branchId}::uuid AND deleted_at IS NULL AND status = 'active')  AS clients,
          (SELECT COALESCE(SUM(f.aum), 0)::numeric FROM folios f
            JOIN investors i ON i.id = f.investor_id
           WHERE i.branch_id = ${branchId}::uuid AND i.deleted_at IS NULL)                     AS aum,
          (SELECT COALESCE(SUM(s.amount), 0)::numeric FROM sips s
            JOIN investors i ON i.id = s.investor_id
           WHERE i.branch_id = ${branchId}::uuid AND i.deleted_at IS NULL
             AND s.status = 'active')                                                          AS sip_book,
          (SELECT COALESCE(SUM(CASE WHEN tr.direction = 'inflow' THEN tr.amount::numeric
                                     ELSE -tr.amount::numeric END), 0)::numeric
             FROM transactions tr
             JOIN investors i ON i.id = tr.investor_id
            WHERE i.branch_id = ${branchId}::uuid
              AND tr.status IN ('processed', 'successful')
              AND tr.order_date >= date_trunc('month', current_date))                           AS net_mtd,
          (SELECT COALESCE(SUM(tr.amount) FILTER (WHERE tr.direction = 'inflow'), 0)::numeric
             FROM transactions tr
             JOIN investors i ON i.id = tr.investor_id
            WHERE i.branch_id = ${branchId}::uuid
              AND tr.status IN ('processed', 'successful')
              AND tr.order_date >= date_trunc('month', current_date))                           AS gross_mtd,
          (SELECT count(*)::int FROM leads l
            WHERE l.branch_id = ${branchId}::uuid
              AND l.converted_investor_id IS NULL
              AND l.stage NOT IN ('lost', 'not_interested'))                                    AS open_leads,
          (SELECT count(*)::int FROM tasks t
            WHERE t.assignee_id IN (
                    SELECT id FROM users
                     WHERE tenant_id = ${session.tenantId}::uuid AND branch_id = ${branchId}::uuid)
              AND t.status IN ('open', 'in_progress') AND t.deleted_at IS NULL)                 AS tasks_open,
          (SELECT count(*)::int FROM service_requests sr
            JOIN investors i ON i.id = sr.investor_id
           WHERE i.branch_id = ${branchId}::uuid
             AND sr.status NOT IN ('resolved', 'closed'))                                       AS sr_open
      `),
      // The roster itself, each row carrying the book that person owns so the
      // table is a league table rather than a phone list.
      tx.execute(sql`
        SELECT u.id, u.name, u.roles,
               (SELECT count(*)::int FROM investors i
                 WHERE i.rm_id = u.id AND i.deleted_at IS NULL AND i.status = 'active')        AS clients,
               (SELECT COALESCE(SUM(f.aum), 0)::numeric FROM folios f
                 JOIN investors i2 ON i2.id = f.investor_id
                WHERE i2.rm_id = u.id AND i2.deleted_at IS NULL)                                AS aum
          FROM users u
         WHERE u.tenant_id = ${session.tenantId}::uuid
           AND u.branch_id = ${branchId}::uuid
           AND u.status = 'active'
           ${roleNode ? sql`AND u.roles && ${roleNode.roles}::text[]` : sql``}
         ORDER BY u.name ASC
      `),
    ]);
    return {
      heads: headRes.rows as unknown as HeadRow[],
      totals: totalsRes.rows[0] as unknown as TotalsRow | undefined,
      members: membersRes.rows as unknown as MemberRow[],
    };
  });

  const headOf = (role: string) => data.heads.find((h) => h.role === role)?.n ?? 0;
  // One card per top-level node; a node covering several rbac roles (Back
  // Office = back_office + ops, RA = research + sales) sums them, so the roster
  // does not imply teams the firm does not have.
  const staffed = ROLE_TREE.map((n) => ({
    role: n.key,
    label: n.label,
    n: n.roles.reduce((sum, r) => sum + headOf(r), 0),
    children: (n.children ?? []).map((c) => ({
      key: c.key,
      label: c.label,
      n: c.roles.reduce((sum, r) => sum + headOf(r), 0),
    })),
  }));
  const t = data.totals;

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Building2 className="size-5" /> {branchName}
          {roleNode && <span className="text-muted-foreground font-normal">· {roleNode.label}</span>}
        </h1>
        <p className="text-muted-foreground text-sm">
          {roleNode
            ? `The ${roleNode.label} desk at this branch. Pick a name from the Member dropdown to open their own dashboard.`
            : "Team and book for this branch. Narrow by role, or pick someone to open their own dashboard."}
        </p>
      </div>

      {/* What the branch is carrying. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat icon={<Users className="size-3.5" />} label="Clients" value={String(t?.clients ?? 0)} />
        <Stat icon={<Wallet className="size-3.5" />} label="AUM" value={formatINR(Number(t?.aum ?? 0))} />
        <Stat icon={<Repeat className="size-3.5" />} label="SIP book" value={formatINR(Number(t?.sip_book ?? 0))} sub="per month" />
        <Stat
          icon={<TrendingUp className="size-3.5" />}
          label="Net sales (MTD)"
          value={formatINR(Number(t?.net_mtd ?? 0))}
          sub={`Gross ${formatINR(Number(t?.gross_mtd ?? 0))}`}
        />
        <Stat icon={<Target className="size-3.5" />} label="Open leads" value={String(t?.open_leads ?? 0)} />
        <Stat
          icon={<ListChecks className="size-3.5" />}
          label="Open work"
          value={String(t?.tasks_open ?? 0)}
          sub={`${t?.sr_open ?? 0} service requests`}
        />
      </div>

      {/* Who staffs it. Roles with nobody in them are still shown at 0 — an
          empty seat is information (this branch has no RIA), not noise. */}
      <div className="border rounded-lg bg-card">
        <div className="border-b px-4 py-2.5 font-medium flex items-center gap-2">
          <Users className="size-4" /> Team composition
          <span className="text-xs text-muted-foreground font-normal">
            ({data.members.length} {data.members.length === 1 ? "person" : "people"})
          </span>
        </div>
        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {staffed.map((s) => (
            <div key={s.role} className="rounded-lg border bg-background/60 px-3 py-2.5">
              <div className="text-xl font-semibold tabular-nums">{s.n}</div>
              <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{s.label}</div>
              {/* A parent shows its desks so "RA: 3" is never a dead end. */}
              {s.children.length > 0 && (
                <div className="mt-1.5 pt-1.5 border-t space-y-0.5">
                  {s.children.map((c) => (
                    <div key={c.key} className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span className="truncate">{c.label.replace(/^RA — /, "")}</span>
                      <span className="tabular-nums font-medium">{c.n}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* The roster, each row a doorway into that person's dashboard. */}
      <div className="border rounded-lg bg-card">
        <div className="border-b px-4 py-2.5 font-medium flex items-center gap-2">
          <LifeBuoy className="size-4" /> Members
        </div>
        {data.members.length === 0 ? (
          <DashboardEmptyState
            compact
            title={roleNode ? `No ${roleNode.label} at this branch` : "No active members in this branch"}
            hint="Assign team members to this branch from Settings → Team."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground bg-muted/40">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Name</th>
                  <th className="text-left font-medium px-3 py-2">Role</th>
                  <th className="text-right font-medium px-3 py-2">Clients</th>
                  <th className="text-right font-medium px-4 py-2">AUM</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.members.map((m) => (
                  <tr key={m.id} className="hover:bg-accent/30">
                    <td className="px-4 py-2">
                      <Link
                        href={`/dashboard?branch=${branchId}${roleKey ? `&role=${roleKey}` : ""}&rm=${m.id}`}
                        className="font-medium hover:underline"
                      >
                        {m.name ?? "—"}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {primaryRoleNode(m.roles)?.label ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.clients}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatINR(Number(m.aum ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider flex items-center gap-1.5">
        {icon} {label}
      </div>
      <div className="text-xl font-semibold tabular-nums mt-1">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
