/**
 * Quarterly / Annual review report for a single investor.
 *
 * Per MFD-scaling research, this is the #1 retention tool against direct-plan
 * leakage — investors who get a quarterly review document are dramatically
 * less likely to defect to Zerodha/Groww.
 *
 * Implementation: a print-friendly HTML page that renders the full report.
 * The user clicks the print icon (browser's built-in Ctrl+P) → "Save as PDF"
 * to get a branded one-page deliverable. This avoids puppeteer/headless-chrome
 * complexity for v1; we'll move to server-rendered PDF later.
 *
 * Sections (per PersonalFN sample format):
 *   - Cover with firm logo + investor name + period
 *   - Executive summary (AUM, gain, top performer, top under-performer)
 *   - Asset allocation drift vs target
 *   - Scheme-wise XIRR
 *   - Goal-vs-actual
 *   - Action items
 *   - Footer with SEBI mandated tagline + ARN
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { withTenant, db } from "@/db/client";
import { investors, folios, sips, goals, transactions, tenants } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatINR, formatDate } from "@/lib/utils";
import { PrintReportButton } from "@/components/investors/PrintReportButton";

export const dynamic = "force-dynamic";

export default async function ReviewReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const now = new Date();
  const quarter = Math.floor(now.getMonth() / 3) + 1;
  const period = sp.period ?? `Q${quarter} FY${now.getFullYear()}`;

  const session = await requireSession();
  const tenant = (await withTenant(session.tenantId, async (tx) =>
    tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1)
  ))[0];

  const data = await withTenant(session.tenantId, async (tx) => {
    const inv = (await tx.select().from(investors).where(eq(investors.id, id)).limit(1))[0];
    if (!inv) return null;
    const foliosRows = await tx.select().from(folios).where(eq(folios.investorId, id));
    const sipsRows = await tx.select().from(sips).where(eq(sips.investorId, id));
    const goalsRows = await tx.select().from(goals).where(eq(goals.investorId, id));
    const txRows = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.investorId, id))
      .orderBy(desc(transactions.orderDate))
      .limit(50);
    return { investor: inv, folios: foliosRows, sips: sipsRows, goals: goalsRows, transactions: txRows };
  });
  if (!data) notFound();

  const { investor: inv, folios: foliosRows, sips: sipsRows, goals: goalsRows, transactions: txRows } = data;
  const totalAum = Number(inv.aum ?? 0);
  const totalSip = Number(inv.activeSipAmount ?? 0);
  const lifetimeInflow = Number(inv.lifetimeInflow ?? 0);
  const lifetimeOutflow = Number(inv.lifetimeOutflow ?? 0);
  const gain = totalAum - (lifetimeInflow - lifetimeOutflow);
  const gainPct = lifetimeInflow > 0 ? (gain / lifetimeInflow) * 100 : 0;

  // Asset allocation from folios (best-effort from schemes jsonb)
  const allocation: Record<string, number> = {};
  for (const f of foliosRows) {
    const schemes = (f.schemes as any[]) ?? [];
    for (const s of schemes) {
      const cat = (s.category ?? "Other") as string;
      allocation[cat] = (allocation[cat] ?? 0) + (Number(s.value) || 0);
    }
  }
  const allocationTotal = Object.values(allocation).reduce((a, b) => a + b, 0);

  return (
    <>
      {/* Print-only / screen-only chrome */}
      <div className="print:hidden mb-4 flex items-center justify-between max-w-4xl mx-auto pt-6 px-6">
        <Link
          href={`/dashboard/investors/${id}`}
          className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
        >
          <ChevronLeft className="size-4" /> Back to investor
        </Link>
        <PrintReportButton />
      </div>

      <div className="bg-white text-black max-w-4xl mx-auto p-10 print:p-6 print:max-w-none print:shadow-none shadow-lg rounded-lg print:rounded-none">
        {/* COVER */}
        <header className="border-b pb-6 mb-6 flex items-start justify-between">
          <div>
            <div
              className="h-2 w-16 mb-3 rounded"
              style={{ backgroundColor: tenant?.primaryColor ?? "#1f2937" }}
            />
            <h1 className="text-3xl font-bold tracking-tight">Portfolio review</h1>
            <p className="text-gray-600 mt-1">{period} · prepared for {inv.name}</p>
          </div>
          <div className="text-right text-sm">
            {(tenant as any)?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={(tenant as any).logoUrl}
                alt={tenant?.legalName ?? "Firm logo"}
                className="h-14 ml-auto mb-1 object-contain"
              />
            ) : (
              <div className="font-semibold text-lg">{tenant?.legalName ?? "—"}</div>
            )}
            <div className="text-gray-500 font-mono text-xs">{tenant?.arn ?? ""}</div>
            <div className="text-xs text-gray-500 mt-1">Generated {formatDate(new Date())}</div>
          </div>
        </header>

        {/* EXECUTIVE SUMMARY */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Executive summary</h2>
          <div className="grid grid-cols-4 gap-3 text-sm">
            <SummaryCell label="Current AUM" value={formatINR(totalAum)} />
            <SummaryCell label="Monthly SIP" value={formatINR(totalSip) + "/mo"} />
            <SummaryCell label="Lifetime gain" value={formatINR(gain)} tone={gain >= 0 ? "good" : "bad"} />
            <SummaryCell label="Gain %" value={`${gainPct.toFixed(1)}%`} tone={gain >= 0 ? "good" : "bad"} />
          </div>
          <p className="text-sm text-gray-700 mt-4 leading-relaxed">
            Dear {inv.name.split(" ")[0]}, this is your portfolio review for {period}. Your current AUM stands
            at <strong>{formatINR(totalAum)}</strong> across {foliosRows.length} folios, with an active SIP book
            of <strong>{formatINR(totalSip)}/month</strong>. {gain >= 0 ? `Your portfolio has generated a lifetime gain of ${formatINR(gain)}.` : "We'd like to discuss rebalancing in our next review."}
          </p>
        </section>

        {/* ASSET ALLOCATION */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Asset allocation</h2>
          {allocationTotal === 0 ? (
            <p className="text-sm text-gray-500">No scheme-level allocation data available yet. We'll populate this from the next CAMS feed sync.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead className="border-b">
                <tr className="text-left text-xs text-gray-500">
                  <th className="py-2">Category</th>
                  <th className="py-2 text-right">Value</th>
                  <th className="py-2 text-right">% of portfolio</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(allocation)
                  .sort(([, a], [, b]) => b - a)
                  .map(([cat, val]) => (
                    <tr key={cat} className="border-b">
                      <td className="py-2">{cat}</td>
                      <td className="py-2 text-right tabular-nums">{formatINR(val)}</td>
                      <td className="py-2 text-right tabular-nums">{((val / allocationTotal) * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </section>

        {/* FOLIOS */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Folios ({foliosRows.length})</h2>
          {foliosRows.length === 0 ? (
            <p className="text-sm text-gray-500">No folios.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead className="border-b text-left text-xs text-gray-500">
                <tr>
                  <th className="py-2">AMC</th>
                  <th className="py-2">Folio #</th>
                  <th className="py-2 text-right">Current value</th>
                </tr>
              </thead>
              <tbody>
                {foliosRows.map((f) => (
                  <tr key={f.id} className="border-b">
                    <td className="py-2">{f.amcName ?? f.amcCode}</td>
                    <td className="py-2 font-mono text-xs">{f.folioNumber}</td>
                    <td className="py-2 text-right tabular-nums">{formatINR(Number(f.aum ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* ACTIVE SIPs */}
        {sipsRows.filter((s) => s.status === "active").length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-3">Active SIPs</h2>
            <table className="w-full text-sm border-collapse">
              <thead className="border-b text-left text-xs text-gray-500">
                <tr>
                  <th className="py-2">Scheme</th>
                  <th className="py-2 text-right">Amount</th>
                  <th className="py-2 text-right">Frequency</th>
                </tr>
              </thead>
              <tbody>
                {sipsRows.filter((s) => s.status === "active").map((s) => (
                  <tr key={s.id} className="border-b">
                    <td className="py-2">{s.schemeName ?? s.schemeCode}</td>
                    <td className="py-2 text-right tabular-nums">{formatINR(Number(s.amount))}</td>
                    <td className="py-2 text-right text-xs capitalize">{s.frequency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* GOAL PROGRESS */}
        {goalsRows.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-3">Goal progress</h2>
            <div className="space-y-4">
              {goalsRows.map((g) => {
                const pct = Number(g.progressPct ?? 0);
                const onTrack = pct >= 80;
                return (
                  <div key={g.id} className="border rounded p-3">
                    <div className="flex justify-between items-baseline text-sm">
                      <div>
                        <span className="font-medium">{g.name}</span>
                        <span className="text-gray-500 text-xs ml-2 capitalize">{g.category}</span>
                      </div>
                      <span className="text-xs text-gray-500">target {formatDate(g.targetDate)}</span>
                    </div>
                    <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={onTrack ? "h-full bg-emerald-500" : "h-full bg-amber-500"}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                    <div className="text-xs text-gray-600 mt-1 flex justify-between">
                      <span>{formatINR(Number(g.currentValue ?? 0))} of {formatINR(Number(g.targetAmount))}</span>
                      <span className={onTrack ? "text-emerald-700" : "text-amber-700"}>
                        {pct.toFixed(0)}% · {onTrack ? "on track" : "needs attention"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* RECENT TRANSACTIONS */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Recent transactions ({txRows.length})</h2>
          {txRows.length === 0 ? (
            <p className="text-sm text-gray-500">No transactions in the period.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead className="border-b text-left text-xs text-gray-500">
                <tr>
                  <th className="py-2">Date</th>
                  <th className="py-2">Scheme</th>
                  <th className="py-2">Type</th>
                  <th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {txRows.slice(0, 15).map((t) => (
                  <tr key={t.id} className="border-b">
                    <td className="py-2 text-xs">{t.orderDate ?? "—"}</td>
                    <td className="py-2 text-xs">{t.schemeName ?? t.schemeCode}</td>
                    <td className="py-2 text-xs capitalize">{t.type}</td>
                    <td className={`py-2 text-right tabular-nums ${t.direction === "outflow" ? "text-rose-700" : "text-emerald-700"}`}>
                      {t.direction === "outflow" ? "−" : "+"}
                      {formatINR(Number(t.amount ?? 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* ACTION ITEMS */}
        <section className="mb-8 bg-gray-50 rounded p-4">
          <h2 className="text-lg font-semibold mb-2">Action items / next steps</h2>
          <ul className="text-sm space-y-1 list-disc list-inside text-gray-700">
            {!inv.nomineeName && <li>Add a nominee for your folios (currently missing).</li>}
            {inv.kycStatus === "expired" && <li>Renew KYC — currently expired.</li>}
            {inv.panAadhaarLinkStatus === "not_linked" && (
              <li>Link PAN and Aadhaar (currently unlinked; required to prevent investment freeze).</li>
            )}
            {(!inv.riskProfile || !inv.riskProfileSignedAt) && (
              <li>Complete your Risk Profile assessment (SEBI compliance requires signed profile).</li>
            )}
            {inv.riskProfileSignedAt && new Date(inv.riskProfileSignedAt).getTime() < Date.now() - 365 * 24 * 60 * 60 * 1000 && (
              <li>Renew your annual Risk Profile assessment (last completed &gt;1 year ago).</li>
            )}
            {goalsRows.some((g) => Number(g.progressPct ?? 0) < 50) && (
              <li>Some goals are tracking behind — let's discuss a top-up.</li>
            )}
            {totalSip < 5000 && totalAum > 1000000 && (
              <li>AUM is healthy but SIP book is modest — consider stepping up SIPs to maintain compounding.</li>
            )}
            <li>Schedule next review meeting — we'd like to discuss your goals and rebalancing.</li>
          </ul>
        </section>

        {/* COMPLIANT FOOTER */}
        <footer className="border-t pt-4 mt-8 text-xs text-gray-500 space-y-1">
          <p>
            <strong>Mutual fund investments are subject to market risks. Read all scheme related documents carefully.</strong>
          </p>
          <p>
            Past performance is not indicative of future results. This document is intended for {inv.name} only
            and is not a recommendation to buy/sell any security.
          </p>
          <p className="mt-2">
            <strong>{tenant?.legalName}</strong>, AMFI Registered Mutual Fund Distributor ({tenant?.arn}).
            {tenant?.principalEuin && <> Principal EUIN: {tenant.principalEuin}.</>}
            {tenant?.email && <> · {tenant.email}</>}
            {tenant?.phone && <> · {tenant.phone}</>}
          </p>
        </footer>
      </div>

      <style>{`
        @media print {
          @page { margin: 0.6in; size: A4; }
          body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          /* Keep each block whole so content never cuts mid-section across a page. */
          section, header, footer { break-inside: avoid; page-break-inside: avoid; }
          h1, h2, h3 { break-after: avoid; page-break-after: avoid; }
          tr, li, img { break-inside: avoid; page-break-inside: avoid; }
          /* Repeat table headers on each printed page. */
          thead { display: table-header-group; }
        }
      `}</style>
    </>
  );
}

function SummaryCell({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  const color = tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-rose-700" : "text-gray-900";
  return (
    <div className="border rounded p-3 bg-gray-50">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-lg font-bold mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}
