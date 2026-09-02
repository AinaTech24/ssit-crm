import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { EquityTeamBoard } from "@/components/reports/EquityTeamBoard";

export const dynamic = "force-dynamic";

export default function EquityTeamPage() {
  return (
    <div className="space-y-5 max-w-5xl">
      <div className="print:hidden">
        <Link
          href="/dashboard/reports"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"
        >
          <ChevronLeft className="size-3.5" /> Reports &amp; MIS
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Equity Team — Planned vs Actual</h1>
        <p className="text-muted-foreground text-sm">
          Direct-equity desk: Brokerage, New DMAT and Active Clients — FY plan, achievement and month-on-month.
        </p>
      </div>

      <EquityTeamBoard />
    </div>
  );
}
