/**
 * Finance Management Checklist — read-only SOP reference, adopted from
 * Network FP "8.6 Financial Checklist".
 *
 * The cadence of bookkeeping / accounting / tax tasks an MFD firm runs on
 * its own business finances. Print-friendly for the DDQ / ops binder.
 */

import Link from "next/link";
import { ChevronLeft, CheckSquare } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { PrintReportButton } from "@/components/investors/PrintReportButton";
import { ChecklistBox } from "@/components/reports/ChecklistBox";
import { FINANCE_CHECKLIST } from "@/lib/finance/checklist";

export const dynamic = "force-dynamic";

const CADENCE_TONE: Record<string, string> = {
  "Daily / Weekly": "bg-brand-cyan-light text-brand-cyan-deep border-brand-cyan/30",
  Monthly: "bg-emerald-50 text-emerald-800 border-emerald-200",
  Quarterly: "bg-amber-50 text-amber-800 border-amber-200",
  Annual: "bg-violet-50 text-violet-800 border-violet-200",
};

export default async function FinancialChecklistPage() {
  await requireSession();

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-start justify-between gap-3 print:hidden">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Link href="/dashboard/reports" className="hover:underline inline-flex items-center gap-1">
              <ChevronLeft className="size-3" /> Reports
            </Link>
          </div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <CheckSquare className="size-6 text-brand-cyan" /> Finance management checklist
          </h1>
        </div>
        <PrintReportButton />
      </div>

      <div className="hidden print:block text-center mb-3">
        <h1 className="text-xl font-bold">Finance Management Checklist</h1>
        <p className="text-xs text-slate-500">
          Generated {new Date().toLocaleDateString("en-GB")}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {FINANCE_CHECKLIST.map((group) => (
          <div key={group.cadence} className="border rounded-lg bg-card overflow-hidden break-inside-avoid">
            <div className={`px-4 py-2.5 border-b flex items-center justify-between ${CADENCE_TONE[group.cadence] ?? ""}`}>
              <span className="font-semibold text-sm">{group.cadence}</span>
              {group.note && <span className="text-[11px] font-medium opacity-80">{group.note}</span>}
            </div>
            <ul className="p-4 space-y-2">
              {group.items.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <ChecklistBox storageKey={`finchk:${group.cadence}:${i}`} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground border-t pt-3">
        Adapted from the Network FP "8.6 Financial Checklist". The CRM already automates several of
        these — commission capture &amp; reconciliation (Commission Reconciliation) and SIP / asset
        tracking (SIP Tracker &amp; Reports).
      </p>
    </div>
  );
}
