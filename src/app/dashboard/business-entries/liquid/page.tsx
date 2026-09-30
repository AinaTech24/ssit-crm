import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, Droplets, TrendingUp } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatINR } from "@/lib/utils";
import { getLiquidParkingReport } from "@/lib/business/report";

export const dynamic = "force-dynamic";

const MANAGE_ROLES = ["owner", "branch_head", "rm", "back_office", "ops"];

export default async function LiquidReportPage() {
  const session = await requireSession();
  if (!session.roles.some((r) => MANAGE_ROLES.includes(r))) redirect("/dashboard");

  const rows = await withTenant(session.tenantId, (tx) => getLiquidParkingReport(tx, session.tenantId));
  const totalDryPowder = rows.reduce((s, r) => s + r.liquidNet, 0);

  return (
    <div className="space-y-5 max-w-5xl">
      <Link href="/dashboard/business-entries" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to transactions
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Droplets className="size-6 text-sky-500" /> Liquid-for-switching report
        </h1>
        <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
          Net money each client has parked in <strong>Liquid</strong> funds via booked business (liquid inflows − amounts
          switched/redeemed out). This is the dry powder ready to deploy into <strong>Equity</strong> on a market dip.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="card-surface p-4 bg-sky-50/60">
          <div className="text-xs text-muted-foreground">Total liquid dry-powder</div>
          <div className="text-2xl font-bold mt-1 tabular-nums text-sky-700">{formatINR(totalDryPowder)}</div>
        </div>
        <div className="card-surface p-4">
          <div className="text-xs text-muted-foreground">Clients with liquid parked</div>
          <div className="text-2xl font-bold mt-1 tabular-nums">{rows.length}</div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card-surface p-12 text-center text-sm text-muted-foreground">
          <Droplets className="size-8 mx-auto text-muted-foreground/40" />
          <div className="mt-2">No liquid parking recorded yet.</div>
          <p className="mt-1 text-xs max-w-md mx-auto">
            Log a lumpsum / switch into a Liquid-category scheme on a business entry and clients will appear here.
          </p>
        </div>
      ) : (
        <div className="card-surface table-scroll">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Client</th>
                <th className="text-right py-2 font-medium">Liquid in</th>
                <th className="text-right py-2 font-medium">Liquid out</th>
                <th className="text-right py-2 font-medium">Available (net)</th>
                <th className="text-left py-2 font-medium pr-4">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.investorId ?? i} className="border-b last:border-0 hover:bg-sky-50/40 transition-colors">
                  <td className="px-4 py-2.5 font-medium">
                    {r.investorId ? <Link href={`/dashboard/investors/${r.investorId}`} className="hover:underline">{r.name}</Link> : r.name}
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-muted-foreground">{formatINR(r.liquidIn)}</td>
                  <td className="py-2.5 text-right tabular-nums text-muted-foreground">{formatINR(r.liquidOut)}</td>
                  <td className="py-2.5 text-right tabular-nums font-bold text-sky-700">
                    <span className="inline-flex items-center gap-1">{formatINR(r.liquidNet)} <TrendingUp className="size-3.5 opacity-60" /></span>
                  </td>
                  <td className="py-2.5 pr-4 text-xs tabular-nums text-muted-foreground">
                    {r.lastDate ? new Date(r.lastDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}
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
