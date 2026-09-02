import Link from "next/link";
import { sql, desc, eq } from "drizzle-orm";
import { Plus, Users as UsersIcon } from "lucide-react";
import { withPlatformAdmin } from "@/db/client";
import { users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { PLATFORM_TENANT_ID } from "@/lib/platform";
import { ROLE_LABELS } from "@/lib/auth/rbac";
import { formatRelative } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  invited: "bg-blue-50 text-blue-700",
  suspended: "bg-rose-50 text-rose-700",
  offboarded: "bg-gray-50 text-gray-700",
};

export const dynamic = "force-dynamic";

export default async function PlatformStaffPage() {
  const session = await requireSession();
  const staff = await withPlatformAdmin(session.userId, async (tx) => {
    return tx
      .select()
      .from(users)
      .where(eq(users.tenantId, PLATFORM_TENANT_ID))
      .orderBy(desc(users.createdAt));
  });

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Admins</h1>
          <p className="text-muted-foreground text-sm">
            SSIT administrators — Super Admin and Admin both have full cross-tenant access.
          </p>
        </div>
        <Link
          href="/super-admin/users/new"
          className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
        >
          <Plus className="size-4" /> Add admin
        </Link>
      </div>

      <div className="border rounded-lg bg-card">
        {staff.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <UsersIcon className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2">No platform staff yet.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left py-2 font-medium">Email</th>
                <th className="text-left py-2 font-medium">Roles</th>
                <th className="text-left py-2 font-medium">Status</th>
                <th className="text-left py-2 font-medium">Last login</th>
                <th className="text-left py-2 font-medium pl-3">Added</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id} className="border-b last:border-0 hover:bg-accent/40">
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="py-3 text-xs">{s.email}</td>
                  <td className="py-3 text-xs">
                    {(s.roles ?? []).map((r: string) => (
                      <span
                        key={r}
                        className="mr-1 px-1.5 py-0.5 rounded bg-muted text-[10px] tracking-wide"
                      >
                        {ROLE_LABELS[r]?.replace(/\s*\(SSIT\)$/, "") ?? r}
                      </span>
                    ))}
                  </td>
                  <td className="py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[s.status] ?? ""}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="py-3 text-xs text-muted-foreground">
                    {s.lastLoginAt ? formatRelative(s.lastLoginAt) : "Never"}
                  </td>
                  <td className="py-3 pl-3 text-xs text-muted-foreground">{formatRelative(s.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <div className="border rounded-lg bg-card p-5">
        <h2 className="font-semibold text-sm">Permission notes</h2>
        <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">Super Admin</strong> and <strong className="text-foreground">Admin</strong> both
            have full cross-tenant read + write — create/suspend/activate tenants, edit packages,
            manage billing and all data, and create other Admins &amp; Super Admins.
          </li>
          <li>
            An email that is already in use (by any admin or MFD user, in any tenant) cannot be
            reused when creating a new admin.
          </li>
        </ul>
      </div>
    </div>
  );
}
