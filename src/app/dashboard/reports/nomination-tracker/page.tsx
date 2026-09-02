import Link from "next/link";
import { sql } from "drizzle-orm";
import { ShieldCheck, AlertTriangle, UserX, IndianRupee } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatINR } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ALLOWED = ["owner", "compliance", "branch_head", "back_office", "ops"];

function formatCr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return formatINR(n);
}

/**
 * Nomination compliance tracker — SEBI mandates a nominee (or an explicit
 * opt-out) on every folio. This surfaces clients missing a nominee, prioritised
 * by AUM so the biggest compliance + succession gaps get chased first.
 */
export default async function NominationTrackerPage() {
  const session = await requireSession();
  if (!session.roles.some((r) => ALLOWED.includes(r))) {
    return (
      <div className="max-w-2xl mx-auto mt-12 card-surface p-8 text-center">
        <AlertTriangle className="size-8 text-amber-600 mx-auto" />
        <h1 className="text-xl font-bold mt-3">Not available for your role</h1>
      </div>
    );
  }

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const rowsRes = await tx.execute(sql`
        SELECT i.id, i.name, i.segment_tag, i.rm_id, i.kyc_status,
               i.nominee_name,
               COALESCE(SUM(f.aum::numeric), 0) AS aum
        FROM investors i
        LEFT JOIN folios f ON f.investor_id = i.id AND f.closed_at IS NULL
        WHERE i.tenant_id = ${session.tenantId} AND i.deleted_at IS NULL
        GROUP BY i.id, i.name, i.segment_tag, i.rm_id, i.kyc_status, i.nominee_name
      `);
      const rmRes = await tx.execute(sql`SELECT id, name FROM users WHERE tenant_id = ${session.tenantId}`);
      return { rows: rowsRes.rows as any[], rms: rmRes.rows as any[] };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const rmName = new Map<string, string>();
  for (const r of data.rms) rmName.set(r.id, r.name);

  const hasNominee = (n: string | null | undefined) => !!(n && String(n).trim());
  const total = data.rows.length;
  const withNominee = data.rows.filter((r) => hasNominee(r.nominee_name)).length;
  const missing = data.rows
    .filter((r) => !hasNominee(r.nominee_name))
    .map((r) => ({
      id: r.id,
      name: r.name,
      segment: r.segment_tag as string | null,
      kyc: r.kyc_status as string | null,
      rm: r.rm_id ? rmName.get(r.rm_id) ?? "Unknown RM" : "Unassigned",
      aum: Number(r.aum ?? 0),
    }))
    .sort((a, b) => b.aum - a.aum);

  const missingCount = missing.length;
  const coverage = total > 0 ? (withNominee / total) * 100 : 100;
  const aumMissing = missing.reduce((s, m) => s + m.aum, 0);

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="page-title">
          <ShieldCheck className="size-6 text-brand-cyan" /> Nomination Compliance
        </h1>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="kpi-card">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Clients</div>
          <div className="text-2xl font-bold mt-1.5 tabular-nums">{total}</div>
        </div>
        <div className="kpi-card">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Coverage</div>
          <div
            className={`text-2xl font-bold mt-1.5 tabular-nums ${coverage >= 95 ? "text-emerald-700" : coverage >= 80 ? "text-amber-700" : "text-rose-700"
              }`}
          >
            {coverage.toFixed(0)}%
          </div>
          <div className="text-[11px] mt-0.5 text-muted-foreground">{withNominee} with nominee</div>
        </div>
        <div className="kpi-card">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground flex items-center gap-1.5">
            <UserX className="size-4" /> Missing nominee
          </div>
          <div className="text-2xl font-bold mt-1.5 tabular-nums text-rose-700">{missingCount}</div>
        </div>
        <div className="kpi-card">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground flex items-center gap-1.5">
            <IndianRupee className="size-4" /> AUM exposed
          </div>
          <div className="text-2xl font-bold mt-1.5 tabular-nums">{formatCr(aumMissing)}</div>
          <div className="text-[11px] mt-0.5 text-muted-foreground">no nominee on record</div>
        </div>
      </div>

      {missingCount === 0 ? (
        <div className="card-surface p-8 text-center">
          <ShieldCheck className="size-8 text-emerald-600 mx-auto" />
          <h2 className="text-lg font-semibold mt-3">Every client has a nominee 🎉</h2>
          <p className="text-muted-foreground text-sm mt-1">Full nomination coverage — nothing to chase.</p>
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <div className="border-b px-4 py-2.5 text-sm font-medium">
            Missing nominee — top {Math.min(missingCount, 100)} by AUM
          </div>
          <div className="table-scroll">
            <table className="w-full text-sm table-modern">
              <thead className="sticky top-0 z-10 bg-card">
                <tr>
                  <th className="text-left px-4 py-2.5">Client</th>
                  <th className="text-left px-4 py-2.5">Segment</th>
                  <th className="text-left px-4 py-2.5">KYC</th>
                  <th className="text-left px-4 py-2.5">RM</th>
                  <th className="text-right px-4 py-2.5">AUM</th>
                  <th className="text-right px-4 py-2.5">Action</th>
                </tr>
              </thead>
              <tbody>
                {missing.slice(0, 100).map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-2.5">
                      <Link href={`/dashboard/investors/${m.id}`} className="font-medium hover:underline">
                        {m.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{m.segment ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-[11px] capitalize text-muted-foreground">
                        {(m.kyc ?? "—").replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{m.rm}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatINR(m.aum)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Link
                        href={`/dashboard/investors/${m.id}`}
                        className="inline-flex items-center gap-1 text-xs text-brand-cyan font-semibold hover:underline"
                      >
                        Add nominee →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
