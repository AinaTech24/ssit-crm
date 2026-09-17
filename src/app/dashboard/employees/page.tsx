import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { Plus, UserCog, AlertTriangle, Target, IndianRupee, ShieldCheck, Network, Upload } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { ROLE_LABELS, can } from "@/lib/auth/rbac";
import { formatDate, formatINR } from "@/lib/utils";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { EmployeeRowActions } from "@/components/employees/EmployeeRowActions";
import { TeamPresence } from "@/components/employees/TeamPresence";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  invited: "bg-blue-50 text-blue-700",
  suspended: "bg-rose-50 text-rose-700",
  offboarding: "bg-amber-50 text-amber-700",
  offboarded: "bg-gray-50 text-gray-700",
};

export const dynamic = "force-dynamic";

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  // The team roster — names, roles, targets, AUM, status — is firm-admin only.
  // The page previously authenticated but never checked a capability, so any
  // signed-in user who typed the URL got the whole list, and the row actions
  // then failed at the API with "missing settings.users". Gate it once, here.
  if (!can(session.roles, "settings.users", session.permissions)) redirect("/dashboard");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const deptFilter = (sp.department ?? "").split(",").filter(Boolean);
  const statusFilter = (sp.status ?? "").split(",").filter(Boolean);

  const data = await withTenant(session.tenantId, async (tx) => {
    // Trashed (soft-deleted) employees live in the Trash bin, not the team list.
    const conds: any[] = [sql`u.deleted_at IS NULL`];
    if (q) {
      conds.push(
        sql`(u.name ILIKE ${`%${q}%`} OR u.email ILIKE ${`%${q}%`} OR u.phone ILIKE ${`%${q}%`} OR u.euin ILIKE ${`%${q}%`})`
      );
    }
    if (deptFilter.length) {
      conds.push(
        sql`u.department IN (${sql.join(deptFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (statusFilter.length) {
      conds.push(
        sql`u.status IN (${sql.join(statusFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    } else {
      // Offboarded people are ex-staff, not team members. Removing one
      // permanently from Trash marks them offboarded rather than deleting the
      // row — dozens of tables FK to users with RESTRICT, so the record has to
      // survive for the leads, clients and tasks that still point at it. It
      // just should not sit in the roster afterwards, which made a permanent
      // removal look like it had done nothing. Still reachable by filtering
      // Status explicitly.
      conds.push(sql`u.status <> 'offboarded'`);
    }
    const whereSql = conds.length ? sql` WHERE ${sql.join(conds, sql` AND `)}` : sql``;

    const employees = await tx.execute(sql`
      SELECT u.id, u.name, u.email, u.phone, u.roles, u.status,
             u.department, u.joining_date, u.annual_target, u.sip_monthly_target,
             u.reporting_manager_id, mgr.name AS manager_name,
             u.branch_id, br.name AS branch_name, u.restrict_to_own_records,
             u.euin, u.nism_expiry_at, u.last_login_at, u.created_at,
             (SELECT COUNT(*)::int FROM investors i WHERE i.rm_id = u.id AND i.status = 'active') AS assigned_clients,
             (SELECT COALESCE(SUM(i.aum::numeric), 0)::numeric FROM investors i WHERE i.rm_id = u.id AND i.status = 'active') AS my_aum
      FROM users u
      LEFT JOIN users mgr ON mgr.id = u.reporting_manager_id
      LEFT JOIN branches br ON br.id = u.branch_id
      ${whereSql}
      ORDER BY u.created_at DESC
    `);
    return employees.rows as any[];
  });

  const stats = {
    total: data.length,
    active: data.filter((e) => e.status === "active").length,
    nismExpiring: data.filter(
      (e) => e.nism_expiry_at && new Date(e.nism_expiry_at).getTime() - Date.now() < 90 * 24 * 60 * 60 * 1000
    ).length,
    targetedRms: data.filter((e) => Number(e.annual_target ?? 0) > 0).length,
  };

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <UserCog className="size-6 text-brand-cyan" /> Employees / Team
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <TeamPresence members={data.map((e) => ({ id: e.id, name: e.name }))} />
          <Link href="/dashboard/employees/org" className="rounded-md border px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 hover:bg-secondary">
            <Network className="size-4" /> Org chart
          </Link>
          <Link href="/dashboard/employees/compliance" className="rounded-md border px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 hover:bg-secondary">
            <ShieldCheck className="size-4" /> Licensing
          </Link>
          <Link href="/dashboard/employees/import" className="rounded-md border px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 hover:bg-secondary">
            <Upload className="size-4" /> Import
          </Link>
          <Link
            href="/dashboard/employees/new"
            className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
          >
            <Plus className="size-4" /> Invite employee
          </Link>
        </div>
      </div>

      <CompactFilterBar
        totalCount={data.length}
        filters={[
          { type: "search", key: "q", placeholder: "Search by name, email, phone, EUIN…" },
          {
            type: "multi",
            key: "department",
            label: "Department",
            options: [
              { value: "sales", label: "Sales" },
              { value: "operations", label: "Operations" },
              { value: "back_office", label: "Back Office" },
              { value: "compliance", label: "Compliance" },
              { value: "marketing", label: "Marketing" },
              { value: "advisory", label: "Advisory" },
              { value: "support", label: "Support" },
              { value: "leadership", label: "Leadership" },
            ],
          },
          {
            type: "multi",
            key: "status",
            label: "Status",
            options: [
              { value: "active", label: "Active" },
              { value: "invited", label: "Invited" },
              { value: "suspended", label: "Suspended" },
              { value: "offboarding", label: "Offboarding" },
              { value: "offboarded", label: "Offboarded" },
            ],
          },
        ]}
        rightSlot={
          <CustomViews
            viewsKey="views:employees"
            presets={[
              { id: "active", name: "Active only", params: "status=active" },
              { id: "sales", name: "Sales team", params: "department=sales,advisory" },
              { id: "ops", name: "Operations team", params: "department=operations,back_office" },
              { id: "compliance", name: "Compliance", params: "department=compliance" },
            ]}
          />
        }
      />

      <div className="card-surface overflow-hidden">
        {data.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <UserCog className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2">No employees match these filters.</div>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Employee</th>
                  <th className="text-left py-2 font-medium">Branch</th>
                  <th className="text-left py-2 font-medium">Department</th>
                  <th className="text-left py-2 font-medium">Manager</th>
                  <th className="text-left py-2 font-medium">Joined</th>
                  <th className="text-left py-2 font-medium">Roles</th>
                  <th className="text-right py-2 font-medium">Clients</th>
                  <th className="text-right py-2 font-medium">AUM</th>
                  <th className="text-right py-2 font-medium">Target</th>
                  <th className="text-left py-2 font-medium">NISM</th>
                  <th className="text-left py-2 font-medium">Status</th>
                  <th className="text-right py-2 font-medium pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.map((e) => {
                  const nismExpiry = e.nism_expiry_at ? new Date(e.nism_expiry_at) : null;
                  const nismDays = nismExpiry ? Math.floor((nismExpiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : null;
                  return (
                    <tr key={e.id} className="border-b last:border-0 hover:bg-secondary/40">
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/employees/${e.id}`} className="font-medium hover:underline">
                          {e.name}
                        </Link>
                        <div className="text-[11px] text-muted-foreground">{e.email}</div>
                        {e.phone && <div className="text-[10px] text-muted-foreground font-mono">{e.phone}</div>}
                      </td>
                      <td className="py-3 text-xs">
                        {e.branch_name ? (
                          <span className="inline-flex items-center gap-1">
                            {e.branch_name}
                            {(e.roles ?? []).includes("branch_head") && (
                              <span className="chip bg-amber-50 text-amber-800 border border-amber-200 text-[9px] px-1 py-0">
                                head
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-amber-700">— no branch —</span>
                        )}
                      </td>
                      <td className="py-3 text-xs capitalize">
                        {e.department ? e.department.replace(/_/g, " ") : ""}
                      </td>
                      <td className="py-3 text-xs">{e.manager_name ?? ""}</td>
                      <td className="py-3 text-xs text-muted-foreground tabular-nums">
                        {e.joining_date ? formatDate(e.joining_date) : ""}
                      </td>
                      <td className="py-3 text-xs">
                        {(e.roles ?? []).slice(0, 3).map((r: string) => ROLE_LABELS[r] ?? r).join(", ")}
                        {(e.roles ?? []).length > 3 && <span className="text-muted-foreground"> +{e.roles.length - 3}</span>}
                      </td>
                      <td className="py-3 text-right tabular-nums">{e.assigned_clients}</td>
                      <td className="py-3 text-right tabular-nums text-muted-foreground">
                        {Number(e.my_aum ?? 0) > 0 ? formatINR(Number(e.my_aum)) : ""}
                      </td>
                      <td className="py-3 text-right text-xs">
                        {Number(e.annual_target ?? 0) > 0 ? (
                          (() => {
                            const annualTarget = Number(e.annual_target);
                            const myAum = Number(e.my_aum ?? 0);
                            const progress = Math.round((myAum / annualTarget) * 100);
                            const progressColor = progress >= 100 ? "bg-emerald-500 text-emerald-600" : progress >= 50 ? "bg-amber-500 text-amber-600" : "bg-rose-500 text-rose-600";
                            return (
                              <div className="flex flex-col items-end gap-1">
                                <span className="font-medium tabular-nums text-foreground">
                                  {formatINR(annualTarget)}
                                </span>
                                <div className="w-16 h-1 bg-secondary rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${progressColor.split(" ")[0]}`}
                                    style={{ width: `${Math.min(100, progress)}%` }}
                                  />
                                </div>
                                <span className={`text-[9px] font-bold tabular-nums ${progressColor.split(" ")[1]}`}>
                                  {progress}%
                                </span>
                              </div>
                            );
                          })()
                        ) : (
                          ""
                        )}
                      </td>
                      <td className="py-3 text-xs">
                        {nismExpiry ? (
                          <span className={nismDays != null && nismDays < 90 ? "text-amber-600" : ""}>
                            {nismDays != null && nismDays < 30 && (
                              <AlertTriangle className="size-3 inline mr-1 text-rose-600" />
                            )}
                            {formatDate(nismExpiry)}
                          </span>
                        ) : (
                          ""
                        )}
                      </td>
                      <td className="py-3">
                        <span className={`chip ${STATUS_COLORS[e.status] ?? ""}`}>{e.status}</span>
                      </td>
                      <td className="py-3 pr-4">
                        <EmployeeRowActions
                          employee={{
                            id: e.id,
                            name: e.name,
                            email: e.email ?? null,
                            phone: e.phone ?? null,
                            status: e.status,
                            department: e.department ?? null,
                            managerName: e.manager_name ?? null,
                            roles: (e.roles ?? []) as string[],
                            assignedClients: Number(e.assigned_clients ?? 0),
                            aum: Number(e.my_aum ?? 0),
                            joiningDate: e.joining_date ? String(e.joining_date) : null,
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone?: "emerald" | "amber" | "muted" }) {
  const color = tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-foreground";
  return (
    <div className="kpi-card">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</span>
        <Icon className="size-3.5 text-muted-foreground" />
      </div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
