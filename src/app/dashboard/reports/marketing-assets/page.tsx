/**
 * Marketing Assets & Trust Builders — readiness reference (Network FP
 * "Marketing Assets"). Supports AMFI DDQ IV.1. Print-friendly.
 */

import Link from "next/link";
import { ChevronLeft, Megaphone, ArrowUpRight } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { PrintReportButton } from "@/components/investors/PrintReportButton";
import { ChecklistBox } from "@/components/reports/ChecklistBox";
import { MARKETING_ASSETS } from "@/lib/marketing/assets-catalog";

export const dynamic = "force-dynamic";

export default async function MarketingAssetsPage() {
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
            <Megaphone className="size-6 text-brand-cyan" /> Marketing assets & trust builders
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            The brand, trust and lead-generation assets a scaling MFD should have in place. Use it as
            a readiness checklist; several link to where they're produced in the app. Also serves as
            AMFI DDQ evidence for marketing materials.
          </p>
        </div>
        <PrintReportButton />
      </div>

      <div className="hidden print:block text-center mb-3">
        <h1 className="text-xl font-bold">Marketing Assets & Trust Builders</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {MARKETING_ASSETS.map((group) => (
          <div key={group.key} className="border rounded-lg bg-card overflow-hidden break-inside-avoid">
            <div className="px-4 py-2.5 border-b font-semibold text-sm bg-secondary/40">{group.title}</div>
            <ul className="p-4 space-y-2">
              {group.items.map((item, i) => (
                <li key={i} className="flex items-start justify-between gap-2 text-sm">
                  <div className="flex items-start gap-2">
                    <ChecklistBox storageKey={`mktg:${group.key}:${i}`} />
                    <span>{item.title}</span>
                  </div>
                  {item.href && (
                    <Link
                      href={item.href}
                      className="inline-flex items-center gap-0.5 text-[11px] text-brand-cyan-deep hover:underline font-medium whitespace-nowrap print:hidden"
                    >
                      Open <ArrowUpRight className="size-3" />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground border-t pt-3">
        Adapted from the Network FP "Marketing Assets" template. Items with a link are produced inside
        the platform; the rest are assets you create and store.
      </p>
    </div>
  );
}
