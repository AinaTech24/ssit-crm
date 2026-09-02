/**
 * Tax-harvesting report — which clients have unrealised long-term equity gains
 * that can be booked tax-free within this year's ₹1.25L LTCG exemption, AND
 * which clients sit on unrealised losses worth booking to offset gains. A
 * year-end (Jan-Mar) worklist that adds real, measurable value: harvesting the
 * exemption every year saves each eligible client up to ₹15,625 of tax.
 *
 * The engine FIFO-matches lots so only genuinely long-term units count, and
 * subtracts LTCG already realised this FY from each client's remaining exemption.
 */

import Link from "next/link";
import { Sprout, IndianRupee, Users, PiggyBank, CalendarClock, TrendingDown } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import { users } from "@/db/schema";
import { formatINR } from "@/lib/utils";
import { scanTaxHarvest, LTCG_EXEMPTION, type HarvestRow } from "@/lib/tax/harvesting";
import { HarvestTaskButton } from "@/components/finance/HarvestActions";

export const dynamic = "force-dynamic";

/** Plain-text redemption plan: book gain from the biggest LT holdings until the
 *  harvestable amount is covered. The MFD confirms exact units from the CAS. */
function buildPlan(r: HarvestRow): string {
  let remaining = r.harvestable;
  const lines: string[] = [];
  for (const h of r.holdings) {
    if (remaining <= 1) break;
    const book = Math.min(h.longTermGain, remaining);
    lines.push(`• Book ~₹${Math.round(book).toLocaleString("en-IN")} gain from ${h.schemeName ?? "scheme"}, then re-buy`);
    remaining -= book;
  }
  return lines.join("\n") || "• Redeem long-term equity units up to the exemption, then re-buy.";
}

export default async function TaxHarvestingPage() {
  const session = await requireSession();
  requireAny(session.roles, ["reports.business", "reports.team", "investor.view.all", "investor.view.assigned"], session.permissions);

  // Managers see the firm; a plain RM (assigned-scope only) sees just their book.
  const seesAll =
    can(session.roles, "investor.view.all", session.permissions) ||
    can(session.roles, "reports.business", session.permissions) ||
    can(session.roles, "reports.team", session.permissions);

  const data = await withTenant(session.tenantId, async (tx) => {
    const scan = await scanTaxHarvest(tx, { limit: 200, rmId: seesAll ? undefined : session.userId });
    const rmRows = await tx.select({ id: users.id, name: users.name }).from(users);
    return { scan, rmMap: new Map(rmRows.map((r) => [r.id, r.name])) };
  });

  const { gains, losses, fyStartYear } = data.scan;
  const totalHarvestable = gains.reduce((s, r) => s + r.harvestable, 0);
  const totalTaxSaved = gains.reduce((s, r) => s + r.taxSaved, 0);
  const totalLoss = losses.reduce((s, r) => s + r.totalLoss, 0);

  // Days remaining to 31 March of the current FY (the harvest deadline).
  const fyEnd = new Date(Date.UTC(fyStartYear + 1, 2, 31));
  const today = new Date();
  const daysLeft = Math.max(0, Math.ceil((fyEnd.getTime() - today.getTime()) / 86_400_000));
  const fyLabel = `FY ${fyStartYear}-${String(fyStartYear + 1).slice(-2)}`;

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="page-title">
          <Sprout className="size-6 text-emerald-600" /> Tax-harvesting opportunities
        </h1>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={Users} label="Clients with an opportunity" value={String(gains.length)} />
        <Stat icon={IndianRupee} label="Total harvestable gain" value={totalHarvestable > 0 ? formatINR(totalHarvestable) : "—"} tone="emerald" />
        <Stat icon={PiggyBank} label="Est. tax saved" value={totalTaxSaved > 0 ? formatINR(Math.round(totalTaxSaved)) : "—"} tone="emerald" />
        <Stat
          icon={CalendarClock}
          label="Days to 31 March"
          value={String(daysLeft)}
          tone={daysLeft <= 45 ? "amber" : undefined}
          sub={daysLeft <= 45 ? "deadline approaching" : fyLabel}
        />
      </div>

      {/* ── Gains to harvest ─────────────────────────────────────────────── */}
      <div className="card-surface overflow-hidden">
        {gains.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <Sprout className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2 font-medium">No harvestable long-term gains right now.</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              Opportunities appear once clients hold equity funds for over a year with an unrealised
              gain. Make sure transactions are imported with AMFI scheme codes so gains can be priced.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Client</th>
                <th className="text-left py-2 font-medium">Top long-term holdings</th>
                <th className="text-left py-2 font-medium">RM</th>
                <th className="text-right py-2 font-medium">LT gain</th>
                <th className="text-right py-2 font-medium">Used this FY</th>
                <th className="text-right py-2 font-medium">Harvest now</th>
                <th className="text-right py-2 font-medium">Tax saved</th>
                <th className="text-right px-4 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {gains.map((r) => (
                <tr key={r.investorId} className="border-b last:border-0 hover:bg-secondary/40 align-top">
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/investors/${r.investorId}`} className="font-medium hover:underline">
                      {r.investorName}
                    </Link>
                  </td>
                  <td className="py-3">
                    <div className="flex flex-wrap gap-1 max-w-md">
                      {r.holdings.slice(0, 3).map((h, i) => (
                        <span key={i} className="chip bg-secondary text-[10px]">
                          {h.schemeName} · {formatINR(Math.round(h.longTermGain))}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 text-xs text-muted-foreground">{r.rmId ? data.rmMap.get(r.rmId) ?? "—" : "—"}</td>
                  <td className="py-3 text-right tabular-nums">{formatINR(Math.round(r.longTermGain))}</td>
                  <td className="py-3 text-right tabular-nums text-muted-foreground" title="LTCG already realised this FY — eats into the exemption">
                    {r.realizedLtcgThisFy > 0 ? formatINR(Math.round(r.realizedLtcgThisFy)) : "—"}
                  </td>
                  <td className="py-3 text-right tabular-nums font-semibold text-emerald-700">{formatINR(Math.round(r.harvestable))}</td>
                  <td className="py-3 text-right tabular-nums font-semibold text-emerald-700">{formatINR(Math.round(r.taxSaved))}</td>
                  <td className="px-4 py-3 text-right">
                    <HarvestTaskButton
                      investorId={r.investorId}
                      investorName={r.investorName}
                      harvestable={r.harvestable}
                      taxSaved={r.taxSaved}
                      plan={buildPlan(r)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Loss harvesting ──────────────────────────────────────────────── */}
      {losses.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="section-title flex items-center gap-2">
              <TrendingDown className="size-4 text-rose-600" /> Losses worth booking
            </h2>
            <span className="text-xs text-muted-foreground">
              {losses.length} client{losses.length === 1 ? "" : "s"} · {formatINR(Math.round(totalLoss))} unrealised loss to offset gains
            </span>
          </div>
          <div className="card-surface overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Client</th>
                  <th className="text-left py-2 font-medium">Losing holdings</th>
                  <th className="text-left py-2 font-medium">RM</th>
                  <th className="text-right py-2 font-medium">ST loss</th>
                  <th className="text-right px-4 py-2 font-medium">LT loss</th>
                </tr>
              </thead>
              <tbody>
                {losses.map((r) => (
                  <tr key={r.investorId} className="border-b last:border-0 hover:bg-secondary/40 align-top">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/investors/${r.investorId}`} className="font-medium hover:underline">
                        {r.investorName}
                      </Link>
                    </td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-1 max-w-md">
                        {r.holdings.slice(0, 3).map((h, i) => (
                          <span key={i} className="chip bg-rose-50 text-rose-700 text-[10px]">
                            {h.schemeName} · −{formatINR(Math.round(h.loss))}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 text-xs text-muted-foreground">{r.rmId ? data.rmMap.get(r.rmId) ?? "—" : "—"}</td>
                    <td className="py-3 text-right tabular-nums text-rose-700">{r.stLoss > 0 ? `−${formatINR(Math.round(r.stLoss))}` : "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-rose-700">{r.ltLoss > 0 ? `−${formatINR(Math.round(r.ltLoss))}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Booking a loss sets it off against realised capital gains this year (short-term losses offset both
            ST &amp; LT gains; long-term losses offset only LT gains), and unused losses carry forward 8 years.
            Re-buy after the loss is booked to keep the client&apos;s allocation intact.
          </p>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground italic">
        Estimate for planning only — FIFO cost basis from imported transactions, excludes exit load / STT and
        pre-1-Feb-2018 grandfathering. Confirm exact figures from the client&apos;s CAS before transacting.
      </p>
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone, sub }: { icon: any; label: string; value: string; tone?: "emerald" | "amber"; sub?: string }) {
  return (
    <div className="kpi-card">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</span>
        <Icon className="size-3.5 text-muted-foreground" />
      </div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-foreground"}`}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
