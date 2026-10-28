/**
 * Dashboard router. Dispatches to the right variant based on the user's
 * primary role. Owner / Branch Head → Owner cockpit. RM → RM dashboard.
 * Back Office → Ops dashboard. Marketing → Marketing dashboard. Compliance
 * sees a compliance-flavored summary.
 *
 * Role priority order (a user can hold many roles):
 *   owner > compliance > marketing > back_office/ops > rm/branch_head > assistant
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
import { RiaDashboard } from "@/components/dashboards/RiaDashboard";
import { RaDashboard } from "@/components/dashboards/RaDashboard";
import { BackOfficeDashboard } from "@/components/dashboards/BackOfficeDashboard";
import { MarketingDashboard } from "@/components/dashboards/MarketingDashboard";
import { ComplianceCockpit } from "@/components/dashboards/ComplianceCockpit";
import { AnnouncementsStrip } from "@/components/announcements/AnnouncementsStrip";
import { DashboardScopeFilter, type ScopeMember, type ScopeUnit } from "@/components/dashboards/DashboardScopeFilter";
import { DashboardViewSwitch } from "@/components/dashboards/DashboardViewSwitch";
import { ReviewMeetingsOverdue } from "@/components/dashboards/ReviewMeetingsOverdue";
import { AdminRmReviewSection } from "@/components/dashboards/AdminRmReviewSection";
import { BranchCockpit } from "@/components/dashboards/BranchCockpit";
import { MyTargetsCard } from "@/components/targets/MyTargetsCard";
import { primaryRoleNode } from "@/lib/auth/role-tree";
import { confinedDeskId } from "@/lib/scope/view-filter";
import { AdminViewToggle } from "@/components/dashboards/AdminViewToggle";
import { canSwitchAdmin } from "@/lib/auth/view-mode";
import { ROLE_LABELS } from "@/lib/auth/rbac";
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
  // ?unit=d:<deskId> — the research dashboard's sub-branch filter.
  const scopeDeskId = (sp.unit ?? "").startsWith("d:") ? (sp.unit ?? "").slice(2) : undefined;
  // Sub-branch heads an admin has given the admin-view switch to.
  const adminMode = session.viewMode === "admin";
  const showAdminToggle = adminMode || (await canSwitchAdmin(session.tenantId, session.userId));
  const adminToggle = showAdminToggle ? (
    <div className="mb-3">
      <AdminViewToggle adminMode={adminMode} />
    </div>
  ) : null;
  // "b:<branchId>" or "d:<deskId>" — one param for both levels of the org.
  // ?as=ra — a firm admin looking at the research dashboard instead of the firm.
  const asResearch = (sp.as ?? "") === "ra";
  let unitParam = (sp.unit ?? "").trim();
  // A branch head landing on /dashboard cold (no ?unit= yet — that's every
  // normal login) fell through every "is a unit selected?" check below to
  // OwnerCockpit, the FIRM-WIDE view — the exact bug this default closes. A
  // branch head must default to THEIR branch, never to "no unit chosen".
  const isBranchHeadSession = !roles.includes("owner") && roles.includes("branch_head") && !!session.branchId;
  // A head confined to one sub-branch defaults to THAT desk, not the whole
  // registered office (which also holds every sibling sub-branch).
  const confinedDesk = isBranchHeadSession
    ? await withTenant(session.tenantId, (tx) => confinedDeskId(tx, session))
    : null;
  if (confinedDesk) unitParam = `d:${confinedDesk}`;
  else if (!unitParam && isBranchHeadSession) unitParam = `b:${session.branchId}`;

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
          {/* The standard cockpit gets this further down, but a custom default
              board returns early — so a user who set one had a dashboard that
              never self-updated until they reloaded the page. */}
          <AutoRefresh intervalMs={30000} />
          <AnnouncementsStrip session={session} />
          {adminToggle}
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
  // Only the firm-wide admin cockpit carries the overdue-reviews worklist.
  let showReviewOverdue = false;
  let dash: React.ReactNode;
  let memberBar: React.ReactNode = null;
  // View / Create / Period controls — shown on the right of the "Viewing" row,
  // only for the firm-wide Owner cockpit (not when drilled into one member).
  let headerControls: React.ReactNode = null;
  // Everything below is invoked as a direct `await Fn(props)` call rather than
  // JSX (`<Fn />`) so a throw inside a cockpit's own data-fetching actually
  // reaches this try/catch — JSX only builds a React element, it doesn't run
  // the async function body, so a JSX-based render leaves any thrown error to
  // be caught by the route's error.tsx instead (which takes the whole page
  // down with a bare "Something went wrong", for every role, with nothing in
  // the server log to say which cockpit or session hit it). Catching it here
  // lets us fall back to a working dashboard and log exactly who/what failed.
  try {
    if (can(roles, "dashboard.view.owner", perms)) {
      // Branch list drives the first dropdown; the member list is loaded only for
      // the branch in scope, so the second dropdown is a team, not a directory.
      // Both queries are tenant-scoped by RLS.
      const scope = await withTenant(session.tenantId, async (tx) => {
        // Branches are the registered offices (usually one). Desks are the teams
        // the firm actually runs — Surat, Wealth, RA — and are what a firm admin
        // means by "branch" day to day, so both levels go in one picker.
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
        const allBranches = (branchRes.rows as { id: string; name: string }[]).map((b) => ({
          id: String(b.id),
          name: b.name ?? "—",
        }));
        // dashboard.view.owner is also held by branch_head. A branch head runs ONE
        // branch, so they get their own and nothing else — otherwise this picker
        // would hand them every other branch's book and roster.
        const branchScoped = !roles.includes("owner") && roles.includes("branch_head") && !!session.branchId;
        const branches = branchScoped ? allBranches.filter((b) => b.id === session.branchId) : allBranches;
        const branchIds = new Set(branches.map((b) => b.id));
        const desks = (deskRes.rows as { id: string; name: string; branch_id: string }[])
          .filter((d) => branchIds.has(String(d.branch_id)))
          // A sub-branch head sees their own sub-branch and no sibling.
          .filter((d) => !confinedDesk || String(d.id) === confinedDesk)
          .map((d) => ({ id: String(d.id), name: d.name ?? "—", branchId: String(d.branch_id) }));

        const units: ScopeUnit[] = [];
        if (confinedDesk) {
          for (const d of desks) units.push({ value: `d:${d.id}`, label: d.name, depth: 0 });
        } else {
          for (const b of branches) {
            units.push({ value: `b:${b.id}`, label: b.name, depth: 0 });
            for (const d of desks.filter((x) => x.branchId === b.id)) {
              units.push({ value: `d:${d.id}`, label: d.name, depth: 1 });
            }
          }
        }

        const desk = unitParam.startsWith("d:") ? desks.find((d) => d.id === unitParam.slice(2)) : undefined;
        const branch = desk
          ? branches.find((b) => b.id === desk.branchId)
          : unitParam.startsWith("b:")
            ? branches.find((b) => b.id === unitParam.slice(2))
            : undefined;
        if (!branch) {
          return { units, branch: undefined, desk: undefined, members: [] as ScopeMember[], memberRoles: {} as Record<string, string[]> };
        }

        const memberRes = await tx.execute(sql`
          SELECT id, name, roles FROM users
          WHERE tenant_id = ${session.tenantId}::uuid
            AND branch_id = ${branch.id}::uuid
            AND status = 'active'
            ${desk ? sql`AND desk_id = ${desk.id}::uuid` : sql``}
          ORDER BY name ASC
        `);
        // The role rides along in brackets on each name rather than being its own
        // filter step — one dropdown fewer to walk through to reach a person.
        const members: ScopeMember[] = (
          memberRes.rows as { id: string; name: string | null; roles: string[] | null }[]
        ).map((u) => ({
          id: String(u.id),
          name: u.name ?? "—",
          // ROLE_TREE covers the operating desks, not every rbac role — an
          // owner-only account is not on it, and must not read as "Team member".
          roleLabel:
            primaryRoleNode(u.roles)?.label ?? ROLE_LABELS[(u.roles ?? [])[0] ?? ""] ?? "Team member",
        }));
        const memberRoles: Record<string, string[]> = {};
        for (const u of memberRes.rows as { id: string; roles: string[] | null }[]) {
          memberRoles[String(u.id)] = u.roles ?? [];
        }
        return { units, branch, desk, members, memberRoles };
      });

      const selected = rmParam ? scope.members.find((m) => m.id === rmParam) : undefined;
      memberBar = (
        <div className="flex flex-wrap items-center gap-2">
          {roles.includes("owner") && <DashboardViewSwitch current={asResearch ? "ra" : "admin"} />}
          <DashboardScopeFilter
            units={scope.units}
            members={scope.members}
            selectedUnit={scope.branch ? unitParam : ""}
            selectedMember={selected ? rmParam : ""}
            dateFrom={dateFrom}
            dateTo={dateTo}
            confined={!!confinedDesk}
          />
        </div>
      );
      // Whole firm → firm cockpit. Branch or desk → that team. Person → their own.
      const selectedRoles = selected ? scope.memberRoles[selected.id] ?? [] : [];
      // A research analyst has no book — no SIP, no net sales — so picking one
      // must open THEIR dashboard, not the RM one that is all about those.
      const selectedIsRa = selectedRoles.some((r) => r === "ra_research" || r === "ra_sales");
      dash = selected
        ? selectedIsRa
          ? await RaDashboard({ session, deskId: scopeDeskId, target: { userId: selected.id, name: selected.name, roles: selectedRoles } })
          : await RmDashboard({ session, targetUserId: selected.id, targetName: selected.name, from: dateFrom, to: dateTo })
        : asResearch
          ? await RaDashboard({ session, asAdmin: true, deskId: scopeDeskId })
          : scope.branch
          ? await BranchCockpit({
              session,
              branchId: scope.branch.id,
              branchName: scope.branch.name,
              deskId: scope.desk?.id,
              deskName: scope.desk?.name,
            })
          : await OwnerCockpit({ session, period, customStart: pstart, customFrom: pfrom, customTo: pto });
      showReviewOverdue = !selected && !scope.branch && !asResearch;
      if (!selected && !scope.branch) {
        headerControls = <DashboardHeaderBar period={period} currentLabel={periodLabel} variant="light" />;
      }
    } else if (can(roles, "dashboard.view.compliance", perms)) {
      dash = await ComplianceCockpit({ session, period, customStart: pstart });
    } else if (can(roles, "dashboard.view.marketing", perms)) {
      dash = await MarketingDashboard({ session, period, customStart: pstart });
    } else if (can(roles, "dashboard.view.ops", perms)) {
      dash = await BackOfficeDashboard({ session });
    } else if (can(roles, "dashboard.view.ria", perms)) {
      dash = await RiaDashboard({ session });
    } else if (can(roles, "dashboard.view.ra", perms)) {
      // ?rm= also drives the research coverage filter, the same param every
      // other module uses for "show me one person".
      dash = await RaDashboard({ session, deskId: scopeDeskId });
    } else if (can(roles, "dashboard.view.rm", perms)) {
      dash = await RmDashboard({ session, from: dateFrom, to: dateTo });
    } else {
      // Team member fallback — just tasks
      dash = await RmDashboard({ session, limited: true, from: dateFrom, to: dateTo });
    }
  } catch (err) {
    // Whatever role-specific cockpit just blew up, don't take the whole page
    // down with it — fall back to the one view that has the fewest joins and
    // the fewest assumptions about role/branch state, and log everything
    // needed to diagnose the real cause from server logs alone.
    console.error("[dashboard] cockpit render failed, falling back to limited view", {
      userId: session.userId,
      tenantId: session.tenantId,
      roles: session.roles,
      branchId: session.branchId,
      unitParam,
      rmParam,
      error: err instanceof Error ? { message: err.message, stack: err.stack } : err,
    });
    memberBar = null;
    headerControls = null;
    try {
      dash = await RmDashboard({ session, limited: true, from: dateFrom, to: dateTo });
    } catch (fallbackErr) {
      console.error("[dashboard] fallback RmDashboard also failed", {
        userId: session.userId,
        tenantId: session.tenantId,
        error: fallbackErr instanceof Error ? { message: fallbackErr.message, stack: fallbackErr.stack } : fallbackErr,
      });
      dash = (
        <div className="card-surface glass-card p-6 text-sm text-muted-foreground">
          We couldn&apos;t load your dashboard right now. Please refresh, or contact support if this keeps happening.
        </div>
      );
    }
  }

  return (
    <>
      {/* Live-refresh the dashboard data periodically (no manual reload).
          Conservative interval — pauses when the tab is hidden. */}
      <AutoRefresh intervalMs={30000} />
      <AnnouncementsStrip session={session} />
      {adminToggle}
      {memberBar && (
        <div className="mb-5 mt-1 flex items-center justify-between gap-3 flex-wrap">
          {memberBar}
          {headerControls}
        </div>
      )}
      {/* The role cockpits are async server components doing their own data
          fetching — stream them in behind a skeleton so the shell (sidebar,
          topbar, announcements) paints immediately. */}
      <Suspense fallback={null}>{await MyTargetsCard({ session })}</Suspense>
      <Suspense fallback={<DashboardPageSkeleton />}>{dash}</Suspense>
      {/* Firm-wide worklist: reviews that have slipped and stayed slipped. Only
          on the admin cockpit — a single RM's dashboard already lists their
          own due reviews, and a desk view is about that desk's numbers. */}
      {showReviewOverdue && (
        <Suspense fallback={null}>
          {await ReviewMeetingsOverdue({ session })}
        </Suspense>
      )}
      {/* Meetings and portfolio reviews, RM by RM — who is meeting clients. On
          the firm admin's dashboard only. */}
      {showReviewOverdue && (
        <div className="mt-6">
          <Suspense fallback={null}>
            {await AdminRmReviewSection({ session, rmId: rmParam || undefined })}
          </Suspense>
        </div>
      )}
    </>
  );
}

