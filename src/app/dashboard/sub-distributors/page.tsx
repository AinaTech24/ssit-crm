/**
 * Sub-distributors list — external channel partners under our ARN.
 *
 * SEBI angle: this is the parent's sub-ARN register. Show who's active,
 * whose ARN/EUIN/NISM is about to expire (uses the same traffic-light
 * pattern as the ARN/EUIN tracker for employees), and who's been
 * terminated.
 */

import Link from "next/link";
import { Plus } from "lucide-react";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { subDistributors } from "@/db/schema";

export const dynamic = "force-dynamic";

const ASSOCIATION_LABELS: Record<string, string> = {
  individual: "Individual",
  firm: "Firm",
  channel_partner: "Channel partner",
  referral_partner: "Referral partner",
  internal_referral: "Internal referral",
  other: "Other",
};

const STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  inactive: "bg-amber-50 text-amber-700",
  terminated: "bg-gray-100 text-gray-600",
};

export default async function SubDistributorsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requireSession();
  requireCap(session.roles, "compliance.edit", session.permissions);
  await assertActiveLicense(session.tenantId, session.roles);
  const sp = await searchParams;
  const statusFilter = sp.status ?? "active";

  // Independent reads — run concurrently (separate connections = real
  // parallelism) instead of one-after-another.
  const [rows, counts] = await Promise.all([
    withTenant(session.tenantId, async (tx) => {
      const where = [eq(subDistributors.tenantId, session.tenantId)];
      if (statusFilter !== "all") {
        where.push(eq(subDistributors.status, statusFilter as any));
      }
      return tx
        .select()
        .from(subDistributors)
        .where(and(...where))
        .orderBy(subDistributors.name);
    }),
    withTenant(session.tenantId, async (tx) => {
      const all = await tx
        .select()
        .from(subDistributors)
        .where(eq(subDistributors.tenantId, session.tenantId));
      return {
        total: all.length,
        active: all.filter((r) => r.status === "active").length,
        inactive: all.filter((r) => r.status === "inactive").length,
        terminated: all.filter((r) => r.status === "terminated").length,
      };
    }),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Sub-distributors</h1>
        </div>
        <Link href="/dashboard/sub-distributors/new" className="btn-primary text-sm">
          <Plus className="size-4" /> Add sub-distributor
        </Link>
      </div>

      {/* Status filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        {[
          { value: "active", label: `Active · ${counts.active}` },
          { value: "inactive", label: `Inactive · ${counts.inactive}` },
          { value: "terminated", label: `Terminated · ${counts.terminated}` },
          { value: "all", label: `All · ${counts.total}` },
        ].map((s) => (
          <Link
            key={s.value}
            href={`/dashboard/sub-distributors?status=${s.value}`}
            className={`chip text-xs ${statusFilter === s.value
                ? "bg-slate-900 text-white"
                : "bg-slate-100"
              }`}
          >
            {s.label}
          </Link>
        ))}
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="card-surface p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No sub-distributors with this filter yet.
          </p>
          <Link
            href="/dashboard/sub-distributors/new"
            className="btn-primary text-sm mt-4"
          >
            <Plus className="size-4" /> Register the first sub-distributor
          </Link>
        </div>
      ) : (
        <div className="card-surface table-scroll">
          <table className="w-full text-xs min-w-[960px]">
            <thead className="bg-slate-50 text-slate-600 sticky top-0 z-10 bg-card">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Code</th>
                <th className="px-3 py-2 text-left">Association</th>
                <th className="px-3 py-2 text-left">ARN</th>
                <th className="px-3 py-2 text-left">ARN expiry</th>
                <th className="px-3 py-2 text-left">City</th>
                <th className="px-3 py-2 text-left">Contact</th>
                <th className="px-3 py-2 text-left">Split %</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-slate-50/60">
                  <td className="px-3 py-2">
                    <Link
                      href={`/dashboard/sub-distributors/${r.id}`}
                      className="font-medium hover:underline"
                    >
                      {r.name}
                    </Link>
                    {r.remarks && (
                      <div className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                        {r.remarks}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono">{r.code ?? "—"}</td>
                  <td className="px-3 py-2">
                    {ASSOCIATION_LABELS[r.typeOfAssociation] ??
                      r.typeOfAssociation}
                  </td>
                  <td className="px-3 py-2 font-mono">{r.arnNumber ?? "—"}</td>
                  <td className="px-3 py-2">
                    <ExpiryBadge date={r.arnExpiryAt} />
                  </td>
                  <td className="px-3 py-2">{r.city ?? "—"}</td>
                  <td className="px-3 py-2">
                    <div className="text-[11px]">{r.email ?? "—"}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {r.mobile ?? ""}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {r.commissionSplitPct
                      ? `${Number(r.commissionSplitPct).toFixed(2)}%`
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`chip text-[10px] ${STATUS_TONE[r.status] ?? "bg-slate-100"
                        }`}
                    >
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ExpiryBadge({ date }: { date: string | null }) {
  if (!date) return <span className="text-muted-foreground">—</span>;
  const d = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  const tone =
    days < 0
      ? "bg-rose-100 text-rose-800 line-through"
      : days < 30
        ? "bg-rose-50 text-rose-700"
        : days < 90
          ? "bg-amber-50 text-amber-700"
          : "bg-emerald-50 text-emerald-700";
  return (
    <span className={`chip text-[10px] ${tone}`}>
      {new Date(date).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "2-digit",
      })}
    </span>
  );
}
