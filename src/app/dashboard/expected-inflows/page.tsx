/**
 * Expected Inflows — the firm's FUTURE money pipeline.
 *
 * Every "my FD matures in March" a client ever said, in one place, grouped by
 * month, with a ₹ total per month and a reminder already scheduled. Answers the
 * question no MFD can answer today: what is landing next quarter, and who owns it?
 */

import Link from "next/link";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { IndianRupee, CalendarClock, AlertTriangle, CheckCircle2, TrendingUp, Plus } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { expectedInflows, investors, users, INFLOW_SOURCE_LABELS } from "@/db/schema";
import { CollapsibleKpiStrip } from "@/components/investors/CollapsibleKpiStrip";

export const dynamic = "force-dynamic";

const inr = (n: any) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
const inrShort = (n: any) => {
  const v = Number(n) || 0;
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return inr(v);
};
const OPEN = ["expected", "confirmed"];

const STATUS_STYLE: Record<string, string> = {
  expected: "bg-secondary text-muted-foreground",
  confirmed: "bg-sky-50 text-sky-700",
  invested: "bg-emerald-50 text-emerald-700",
  partially_invested: "bg-emerald-50 text-emerald-700",
  lapsed: "bg-rose-50 text-rose-700",
  cancelled: "bg-muted text-muted-foreground",
};

export default async function ExpectedInflowsPage() {
  const session = await requireSession();
  requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);

  const rows = await withTenant(
    session.tenantId,
    async (tx) =>
      tx
        .select({
          id: expectedInflows.id,
          investorId: expectedInflows.investorId,
          investorName: investors.name,
          ownerName: users.name,
          sourceType: expectedInflows.sourceType,
          expectedAmount: expectedInflows.expectedAmount,
          expectedOn: expectedInflows.expectedOn,
          confidence: expectedInflows.confidence,
          status: expectedInflows.status,
          investedAmount: expectedInflows.investedAmount,
          notes: expectedInflows.notes,
        })
        .from(expectedInflows)
        .leftJoin(investors, eq(investors.id, expectedInflows.investorId))
        .leftJoin(users, eq(users.id, expectedInflows.ownerId))
        .where(eq(expectedInflows.tenantId, session.tenantId))
        .orderBy(asc(expectedInflows.expectedOn))
        .limit(1000),
    { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles }
  );

  const today = new Date().toISOString().slice(0, 10);
  const in90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

  const open = rows.filter((r) => OPEN.includes(r.status));
  const upcoming = open.filter((r) => String(r.expectedOn) >= today);
  const overdue = open.filter((r) => String(r.expectedOn) < today);
  const next90 = upcoming.filter((r) => String(r.expectedOn) <= in90);
  const invested = rows.filter((r) => r.status === "invested" || r.status === "partially_invested");

  const sum = (xs: typeof rows, f: (r: (typeof rows)[number]) => any) =>
    xs.reduce((n, r) => n + (Number(f(r)) || 0), 0);

  const totalUpcoming = sum(upcoming, (r) => r.expectedAmount);
  const total90 = sum(next90, (r) => r.expectedAmount);
  const totalOverdue = sum(overdue, (r) => r.expectedAmount);
  const totalInvested = sum(invested, (r) => r.investedAmount ?? r.expectedAmount);
  const captureRate = totalInvested + sum(rows.filter((r) => r.status === "lapsed"), (r) => r.expectedAmount);

  // Group the open pipeline by month
  const byMonth = new Map<string, typeof rows>();
  for (const r of [...overdue, ...upcoming]) {
    const key = String(r.expectedOn).slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, [] as any);
    (byMonth.get(key) as any).push(r);
  }
  const monthLabel = (k: string) =>
    new Date(`${k}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <IndianRupee className="size-6 text-emerald-600" /> Expected Inflows
          </h1>
          <p className="text-muted-foreground text-sm">
            Money your clients have told you is coming — FD maturities, bonuses, property sales — with a reminder already set.
          </p>
        </div>
        <Link href="/dashboard/investors" className="btn-secondary text-sm inline-flex items-center gap-1.5">
          <Plus className="size-4" /> Add from a client
        </Link>
      </div>

      <CollapsibleKpiStrip storageKey="inflows-kpi" title="Pipeline">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Expected (next 90 days)" value={inrShort(total90)} sub={`${next90.length} inflows`} icon={CalendarClock} tone="emerald" />
          <Kpi label="Total upcoming" value={inrShort(totalUpcoming)} sub={`${upcoming.length} inflows`} icon={TrendingUp} />
          <Kpi label="Date passed, not actioned" value={inrShort(totalOverdue)} sub={`${overdue.length} inflows`} icon={AlertTriangle} tone={overdue.length ? "rose" : "muted"} />
          <Kpi
            label="Captured"
            value={inrShort(totalInvested)}
            sub={captureRate > 0 ? `${Math.round((totalInvested / captureRate) * 100)}% of matured money` : "—"}
            icon={CheckCircle2}
            tone="emerald"
          />
        </div>
      </CollapsibleKpiStrip>

      {rows.length === 0 ? (
        <div className="border rounded-lg bg-card p-12 text-center">
          <IndianRupee className="size-8 mx-auto text-muted-foreground/40" />
          <div className="mt-3 font-semibold">Nothing tracked yet.</div>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            Next time a client says <em>&ldquo;my FD matures in March&rdquo;</em> — open their profile and add it here.
            The CRM will remind you before the date.
          </p>
          <Link href="/dashboard/investors" className="btn-primary text-sm mt-4 inline-flex">Open Clients</Link>
        </div>
      ) : (
        <div className="space-y-5">
          {[...byMonth.entries()].map(([month, list]) => {
            const monthTotal = sum(list as any, (r) => r.expectedAmount);
            const isPast = month < today.slice(0, 7);
            return (
              <div key={month} className="border rounded-lg bg-card overflow-hidden">
                <div className={`px-5 py-3 flex items-center justify-between border-b ${isPast ? "bg-rose-50/50" : "bg-secondary/30"}`}>
                  <div className="font-semibold flex items-center gap-2">
                    {monthLabel(month)}
                    {isPast && <span className="text-[10px] uppercase font-bold text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded">date passed</span>}
                  </div>
                  <div className="text-sm font-bold tabular-nums text-emerald-700">{inrShort(monthTotal)}</div>
                </div>
                <div className="overflow-x-auto scrollbar-none">
                  <table className="w-full text-sm border-collapse min-w-[720px]">
                    <thead>
                      <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b">
                        <th className="text-left font-medium py-2.5 px-4">Client</th>
                        <th className="text-left font-medium py-2.5 px-3">Source</th>
                        <th className="text-right font-medium py-2.5 px-3">Amount</th>
                        <th className="text-left font-medium py-2.5 px-3">Date</th>
                        <th className="text-left font-medium py-2.5 px-3">Confidence</th>
                        <th className="text-left font-medium py-2.5 px-3">Owner</th>
                        <th className="text-left font-medium py-2.5 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(list as any[]).map((r) => (
                        <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="py-2.5 px-4">
                            <Link href={`/dashboard/investors/${r.investorId}`} className="font-medium hover:text-primary hover:underline">
                              {r.investorName ?? "—"}
                            </Link>
                          </td>
                          <td className="py-2.5 px-3">{INFLOW_SOURCE_LABELS[r.sourceType as keyof typeof INFLOW_SOURCE_LABELS] ?? r.sourceType}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums font-semibold">{r.expectedAmount ? inr(r.expectedAmount) : "—"}</td>
                          <td className="py-2.5 px-3 tabular-nums whitespace-nowrap">
                            {new Date(`${r.expectedOn}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                          </td>
                          <td className="py-2.5 px-3 capitalize text-muted-foreground">{r.confidence}</td>
                          <td className="py-2.5 px-3 text-muted-foreground">{r.ownerName ?? "—"}</td>
                          <td className="py-2.5 px-3">
                            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[r.status] ?? ""}`}>
                              {String(r.status).replace(/_/g, " ")}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Adding an inflow automatically creates a reminder task for the owner, due{" "}
        <strong>before</strong> the money date. Mark it <em>invested</em> once the money is deployed — that is what the capture % measures.
      </p>
    </div>
  );
}

function Kpi({ label, value, sub, icon: Icon, tone }: { label: string; value: string; sub?: string; icon: any; tone?: "emerald" | "rose" | "muted" }) {
  const color = tone === "emerald" ? "text-emerald-600" : tone === "rose" ? "text-rose-600" : "text-foreground";
  return (
    <div className="card-surface glass-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</span>
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className={`text-xl font-bold mt-2 tabular-nums tracking-tight ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}
