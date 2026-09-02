/**
 * Churn-risk report — the whole book scored by the attrition scorecard, highest
 * risk first. This is the retention worklist: which clients to call THIS week
 * before they redeem and leave. Each row shows the headline reason; the score is
 * fully explainable (see src/lib/churn/score.ts).
 */

import Link from "next/link";
import { eq } from "drizzle-orm";
import { ShieldAlert, TrendingDown, Phone, Users } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import { users } from "@/db/schema";
import { formatINR } from "@/lib/utils";
import { scanChurn } from "@/lib/churn/scan";
import { churnBandClasses } from "@/lib/churn/score";

export const dynamic = "force-dynamic";

export default async function ChurnRiskPage() {
  const session = await requireSession();
  requireAny(session.roles, ["reports.business", "reports.team", "investor.view.all", "investor.view.assigned"], session.permissions);

  // Managers see the firm; a plain RM (assigned-scope only) sees just their book.
  const seesAll =
    can(session.roles, "investor.view.all", session.permissions) ||
    can(session.roles, "reports.business", session.permissions) ||
    can(session.roles, "reports.team", session.permissions);

  const data = await withTenant(session.tenantId, async (tx) => {
    const rows = await scanChurn(tx, { limit: 200, rmId: seesAll ? undefined : session.userId });
    const rmRows = await tx.select({ id: users.id, name: users.name }).from(users);
    const rmMap = new Map(rmRows.map((r) => [r.id, r.name]));
    return { rows, rmMap };
  });

  const high = data.rows.filter((r) => r.result.band === "high");
  const medium = data.rows.filter((r) => r.result.band === "medium");
  const atRisk = data.rows.filter((r) => r.result.band !== "low");
  const aumAtRisk = atRisk.reduce((s, r) => s + r.aum, 0);

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="page-title">
          <ShieldAlert className="size-6 text-rose-500" /> Churn-risk radar
        </h1>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={ShieldAlert} label="High risk" value={String(high.length)} tone="rose" />
        <Stat icon={TrendingDown} label="Watch" value={String(medium.length)} tone="amber" />
        <Stat icon={Users} label="Total scored" value={String(data.rows.length)} />
        <Stat icon={TrendingDown} label="AUM at risk" value={aumAtRisk > 0 ? formatINR(aumAtRisk) : "—"} tone="rose" />
      </div>

      <div className="card-surface overflow-hidden">
        {atRisk.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <ShieldAlert className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2 font-medium">No clients are flagged at-risk right now.</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              As redemptions, SIP stops or long silences appear, at-risk clients will surface here. Keep
              logging contact dates so the engagement signal stays accurate.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Client</th>
                <th className="text-left py-2 font-medium">Risk</th>
                <th className="text-left py-2 font-medium">Top reasons</th>
                <th className="text-left py-2 font-medium">RM</th>
                <th className="text-right py-2 font-medium">AUM</th>
                <th className="text-right px-4 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {atRisk.map((r) => {
                const cls = churnBandClasses(r.result.band);
                return (
                  <tr key={r.investorId} className="border-b last:border-0 hover:bg-secondary/40 align-top">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/investors/${r.investorId}`} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                      <div className="text-[10px] text-muted-foreground">{r.phone ?? "—"}</div>
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <span className={`chip border ${cls.chip}`}>{cls.label}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">{r.result.score}</span>
                      </div>
                      <div className="mt-1 h-1.5 w-24 rounded-full bg-secondary overflow-hidden">
                        <div className={`h-full ${cls.bar}`} style={{ width: `${r.result.score}%` }} />
                      </div>
                    </td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-1 max-w-md">
                        {r.result.factors.slice(0, 3).map((f) => (
                          <span key={f.key} className="chip bg-secondary text-[10px]" title={f.why}>
                            {f.label}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 text-xs text-muted-foreground">
                      {r.rmId ? data.rmMap.get(r.rmId) ?? "—" : "—"}
                    </td>
                    <td className="py-3 text-right tabular-nums">{r.aum > 0 ? formatINR(r.aum) : "—"}</td>
                    <td className="px-4 py-3 text-right">
                      {r.phone && (
                        <a href={`tel:${r.phone}`} className="btn-secondary text-xs inline-flex">
                          <Phone className="size-3.5" /> Call
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground italic">
        Scores are a transparent weighted scorecard, not a black box — open any client to see every
        contributing factor. Use it to prioritise retention calls, not to make automated decisions.
      </p>
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone?: "rose" | "amber" }) {
  return (
    <div className="kpi-card">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</span>
        <Icon className="size-3.5 text-muted-foreground" />
      </div>
      <div
        className={`text-2xl font-bold mt-1 tabular-nums ${tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : "text-foreground"
          }`}
      >
        {value}
      </div>
    </div>
  );
}
