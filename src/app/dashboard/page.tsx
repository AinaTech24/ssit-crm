/**
 * Dashboard router. Dispatches to the right variant based on the user's
 * primary role. Owner / Branch Head → Owner cockpit. RM → RM dashboard.
 * Back Office → Ops dashboard. Marketing → Marketing dashboard. Compliance
 * sees a compliance-flavored summary.
 *
 * Role priority order (a user can hold many roles):
 *   owner > compliance > marketing > back_office/ops > rm/branch_head > team_member
 */

import Link from "next/link";
import { Suspense } from "react";
import { sql } from "drizzle-orm";
import { LayoutDashboard, Star } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { AutoRefresh } from "@/components/common/AutoRefresh";
import { OwnerCockpit } from "@/components/dashboards/OwnerCockpit";
import { DashboardHeaderBar } from "@/components/dashboards/DashboardHeaderBar";
import { resolvePeriodRange } from "@/lib/dashboard/period";
import { RmDashboard } from "@/components/dashboards/RmDashboard";
import { BackOfficeDashboard } from "@/components/dashboards/BackOfficeDashboard";
import { MarketingDashboard } from "@/components/dashboards/MarketingDashboard";
import { ComplianceCockpit } from "@/components/dashboards/ComplianceCockpit";
import { AnnouncementsStrip } from "@/components/announcements/AnnouncementsStrip";
import { DashboardScopeFilter, type ScopeMember, type ScopeRole } from "@/components/dashboards/DashboardScopeFilter";
import { BranchCockpit } from "@/components/dashboards/BranchCockpit";
import { flattenRoleTree, findRoleNode, primaryRoleNode } from "@/lib/auth/role-tree";
import { getDefaultBoard } from "@/lib/dashboards/service";
import { DashboardView } from "@/components/dashboards/custom/DashboardView";
import { DashboardPageSkeleton } from "@/components/dashboards/DashboardSkeletons";
import type { PlacedWidget } from "@/lib/dashboards/widgets";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const roles = session.roles;
  const perms = session.permissions;
  const sp = await searchParams;
  const period = (sp.period ?? "mtd") as "mtd" | "qtd" | "fytd" | "lm" | "custom";
  const pstart = sp.pstart;
  // Owner cockpit custom-range window (Monthly / Quarterly / Custom range picks).
  const pfrom = (sp.pfrom ?? "").slice(0, 10) || undefined;
  const pto = (sp.pto ?? "").slice(0, 10) || undefined;
  const periodLabel = resolvePeriodRange(period, new Date(), { customStart: pstart, from: pfrom, to: pto }).label;
  // Per-user dashboards use an explicit date range (date_from/date_to); the
  // firm-wide OwnerCockpit still uses the period chips.
  const dateFrom = (sp.date_from ?? "").slice(0, 10);
  const dateTo = (sp.date_to ?? "").slice(0, 10);
  const rmParam = (sp.rm ?? "").trim();
  const branchParam = (sp.branch ?? "").trim();
  const roleParam = (sp.role ?? "").trim();

  // ── Custom default board ─────────────────────────────────────────────────
  // If the user has set one of their "My Dashboards" as default, render it here
  // instead of the role cockpit (unless ?std=1 forces the standard view).
  if (sp.std !== "1") {
    const board = await withTenant(session.tenantId, async (tx) => getDefaultBoard(tx, session.tenantId, session.userId));
    if (board) {
      const showMembers = can(roles, "dashboard.view.owner", perms);
      const members = showMembers
        ? await withTenant(session.tenantId, async (tx) => {
            const r = await tx.execute(sql`SELECT id, name FROM users WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' ORDER BY name`);
            return (r.rows as { id: string; name: string }[]).map((m) => ({ id: String(m.id), name: m.name ?? "—" }));
          })
        : [];
      return (
        <>
          <AnnouncementsStrip session={session} />
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <Star className="size-4 text-amber-500" /> {board.name}
            </h1>
            <div className="flex items-center gap-2 text-xs">
              <Link href="/dashboard/boards" className="text-muted-foreground hover:underline inline-flex items-center gap-1">
                <LayoutDashboard className="size-3.5" /> My Dashboards
              </Link>
              <Link href="/dashboard?std=1" className="text-muted-foreground hover:underline">Standard view</Link>
            </div>
          </div>
          <DashboardView layout={(board.layout as PlacedWidget[]) ?? []} members={members} initialRm={(board.filters as any)?.rm ?? ""} />
        </>
      );
    }
  }

  // Owner / Branch Head sees the full cockpit — plus a "Viewing" member
  // selector that scopes the dashboard to a single team member's RmDashboard.
  let dash: React.ReactNode;
  let memberBar: React.ReactNode = null;
  // View / Create / Period controls — shown on the right of the "Viewing" row,
  // only for the firm-wide Owner cockpit (not when drilled into one member).
  let headerControls: React.ReactNode = null;
  if (can(roles, "dashboard.view.owner", perms)) {
    // Branch list drives the first dropdown; the member list is loaded only for
    // the branch in scope, so the second dropdown is a team, not a directory.
    // Both queries are tenant-scoped by RLS.
    const scope = await withTenant(session.tenantId, async (tx) => {
      const branchRes = await tx.execute(sql`
        SELECT id, name FROM branches
        WHERE tenant_id = ${session.tenantId}::uuid
        ORDER BY name ASC
      `);
      const all = (branchRes.rows as { id: string; name: string }[]).map((bb) => ({
        id: String(bb.id),
        name: bb.name ?? "—",
      }));
      // dashboard.view.owner is also held by branch_head. A branch head runs ONE
      // branch, so they get their own and nothing else — otherwise this picker
      // would hand them every other branch's book and roster.
      const branchScoped = !roles.includes("owner") && roles.includes("branch_head") && !!session.branchId;
      const branches = branchScoped ? all.filter((bb) => bb.id === session.branchId) : all;
      const branch = branchParam ? branches.find((b) => b.id === branchParam) : undefined;
      if (!branch) {
        return {
          branches,
          branch: undefined,
          members: [] as ScopeMember[],
          roleCounts: [] as ScopeRole[],
          roleNode: undefined,
        };
      }

      const memberRes = await tx.execute(sql`
        SELECT id, name, roles FROM users
        WHERE tenant_id = ${session.tenantId}::uuid
          AND branch_id = ${branch.id}::uuid
          AND status = 'active'
        ORDER BY name ASC
      `);
      const rows = memberRes.rows as { id: string; name: string | null; roles: string[] | null }[];

      // Headcount per role node, so the Role dropdown can show "(3)" and grey
      // out desks this branch does not staff.
      const nodes = flattenRoleTree();
      const roleCounts: ScopeRole[] = nodes.map((n) => ({
        key: n.key,
        label: n.label,
        depth: n.depth,
        count: rows.filter((u) => (u.roles ?? []).some((r) => n.roles.includes(r))).length,
      }));

      // A user is placed at their MOST SPECIFIC node (RA — Research, not RA), so
      // picking the parent still catches them via its covering role list.
      const roleNode = findRoleNode(roleParam);
      const members: ScopeMember[] = rows
        .filter((u) => !roleNode || (u.roles ?? []).some((r) => roleNode.roles.includes(r)))
        .map((u) => {
          const node = primaryRoleNode(u.roles);
          return {
            id: String(u.id),
            name: u.name ?? "—",
            roleKey: node?.key ?? "team_member",
            roleLabel: node?.label ?? "Team member",
          };
        });
      return { branches, branch, members, roleCounts, roleNode };
    });

    const selected = rmParam ? scope.members.find((m) => m.id === rmParam) : undefined;
    memberBar = (
      <DashboardScopeFilter
        branches={scope.branches}
        roles={scope.roleCounts}
        members={scope.members}
        selectedBranch={scope.branch ? branchParam : ""}
        selectedRole={scope.roleNode ? roleParam : ""}
        selectedMember={selected ? rmParam : ""}
        dateFrom={dateFrom}
        dateTo={dateTo}
      />
    );
    // Whole firm → firm cockpit. Branch → branch cockpit. Person → their own.
    dash = selected ? (
      <RmDashboard session={session} targetUserId={selected.id} targetName={selected.name} from={dateFrom} to={dateTo} />
    ) : scope.branch ? (
      <BranchCockpit
        session={session}
        branchId={scope.branch.id}
        branchName={scope.branch.name}
        roleKey={scope.roleNode?.key}
      />
    ) : (
      <OwnerCockpit session={session} period={period} customStart={pstart} customFrom={pfrom} customTo={pto} />
    );
    if (!selected && !scope.branch) {
      headerControls = <DashboardHeaderBar period={period} currentLabel={periodLabel} variant="light" />;
    }
  } else if (can(roles, "dashboard.view.compliance", perms)) {
    dash = <ComplianceCockpit session={session} period={period} customStart={pstart} />;
  } else if (can(roles, "dashboard.view.marketing", perms)) {
    dash = <MarketingDashboard session={session} period={period} customStart={pstart} />;
  } else if (can(roles, "dashboard.view.ops", perms)) {
    dash = <BackOfficeDashboard session={session} />;
  } else if (can(roles, "dashboard.view.rm", perms)) {
    dash = <RmDashboard session={session} from={dateFrom} to={dateTo} />;
  } else {
    // Team member fallback — just tasks
    dash = <RmDashboard session={session} limited from={dateFrom} to={dateTo} />;
  }

  return (
    <>
      {/* Live-refresh the dashboard data periodically (no manual reload).
          Conservative interval — pauses when the tab is hidden. */}
      <AutoRefresh intervalMs={30000} />
      <AnnouncementsStrip session={session} />
      {memberBar && (
        <div className="mb-5 mt-1 flex items-center justify-between gap-3 flex-wrap">
          {memberBar}
          {headerControls}
        </div>
      )}
      {/* The role cockpits are async server components doing their own data
          fetching — stream them in behind a skeleton so the shell (sidebar,
          topbar, announcements) paints immediately. */}
      <Suspense fallback={<DashboardPageSkeleton />}>{dash}</Suspense>
    </>
  );
}

