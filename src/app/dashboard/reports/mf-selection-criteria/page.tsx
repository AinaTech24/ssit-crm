/**
 * MF Selection Criteria (IC) — read-only reference adopted from Network FP
 * "3.3 MF Selection" (Equity / Debt / Hybrid checklists).
 *
 * Surfaces the firm's standardised per-category selection parameters +
 * quantitative benchmarks so any RM / IC member can see the bar a scheme
 * must clear before it's shortlisted. The same benchmarks auto-grade the
 * scheme IC scorecard (src/lib/mf-selection/criteria.ts → scoreScheme).
 *
 * Print-friendly so the IC can wall-mount it.
 */

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { PrintReportButton } from "@/components/investors/PrintReportButton";
import {
  CATEGORY_CRITERIA,
  MF_GROUP_LABELS,
  type Benchmark,
  type MfGroup,
} from "@/lib/mf-selection/criteria";

export const dynamic = "force-dynamic";

const GROUP_TONE: Record<MfGroup, string> = {
  equity: "bg-emerald-50 text-emerald-800 border-emerald-200",
  hybrid: "bg-blue-50 text-blue-800 border-blue-200",
  debt: "bg-amber-50 text-amber-800 border-amber-200",
};

export default async function MfSelectionCriteriaPage() {
  await requireSession();

  const groups: MfGroup[] = ["equity", "hybrid", "debt"];

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-start justify-between gap-3 print:hidden">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Link href="/dashboard/reports" className="hover:underline inline-flex items-center gap-1">
              <ChevronLeft className="size-3" /> Reports
            </Link>
          </div>
          <h1 className="text-2xl font-semibold">MF selection criteria</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            The firm's standardised investment-committee checklist for shortlisting
            schemes, by category. Quantitative benchmarks here are applied automatically
            when you run a scheme's IC scorecard.
          </p>
        </div>
        <PrintReportButton />
      </div>

      <div className="hidden print:block text-center mb-3">
        <h1 className="text-xl font-bold">MF Selection Criteria</h1>
        <p className="text-xs text-slate-500">
          Generated {new Date().toLocaleDateString("en-GB")}
        </p>
      </div>

      {groups.map((group) => {
        const cats = CATEGORY_CRITERIA.filter((c) => c.group === group);
        return (
          <section key={group} className="space-y-3">
            <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
              {MF_GROUP_LABELS[group]}
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {cats.map((cat) => (
                <div
                  key={cat.key}
                  className="border rounded-lg bg-card overflow-hidden break-inside-avoid"
                >
                  <div className={`px-4 py-2.5 border-b flex items-center justify-between ${GROUP_TONE[group]}`}>
                    <span className="font-semibold text-sm">{cat.label}</span>
                  </div>

                  {/* Quantitative benchmark chips */}
                  <div className="px-4 pt-3 flex flex-wrap gap-1.5">
                    {benchmarkChips(cat.benchmark).map((chip) => (
                      <span
                        key={chip}
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-secondary border border-border/60 text-foreground/80 tabular-nums"
                      >
                        {chip}
                      </span>
                    ))}
                  </div>

                  {/* Parameter checklist */}
                  <ul className="p-4 space-y-1.5">
                    {cat.parameters.map((p, i) => (
                      <li key={i} className="text-xs flex gap-2">
                        <span className="text-muted-foreground tabular-nums w-4 flex-shrink-0">
                          {i + 1}.
                        </span>
                        <span>
                          <span className="font-medium">{p.label}</span>
                          <span className="text-muted-foreground"> — {p.criterion}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <p className="text-[11px] text-muted-foreground border-t pt-3">
        Adapted from the Network FP "3.3 MF Selection" framework. Schemes and AMCs
        are illustrative; criteria are educational, not investment advice. The IC
        always has final say over a scheme's verdict.
      </p>
    </div>
  );
}

function benchmarkChips(b: Benchmark): string[] {
  const chips: string[] = [];
  if (b.minCagrPct != null) chips.push(`CAGR ≥ ${b.minCagrPct}%`);
  if (b.minConsistencyPct != null) chips.push(`Consistency ≥ ${b.minConsistencyPct}%`);
  if (b.minSharpe != null) chips.push(`Sharpe ≥ ${b.minSharpe}`);
  if (b.maxExpenseRatioPct != null) chips.push(`Expense ≤ ${b.maxExpenseRatioPct}%`);
  if (b.minAumCrore != null) chips.push(`AUM ≥ ₹${b.minAumCrore.toLocaleString("en-IN")} Cr`);
  if (b.minFmExperienceYears != null) chips.push(`FM ≥ ${b.minFmExperienceYears} yrs`);
  return chips;
}
