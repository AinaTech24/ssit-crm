import Link from "next/link";
import { ChevronLeft, LineChart } from "lucide-react";
import { EquityDmatManager } from "@/components/equity/EquityDmatManager";

export const dynamic = "force-dynamic";

export default function EquityPage() {
  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <Link
          href="/dashboard/reports/equity-team"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"
        >
          <ChevronLeft className="size-3.5" /> Equity Team report
        </Link>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <LineChart className="size-5" /> Direct Equity — DMAT Accounts
        </h1>
        <p className="text-muted-foreground text-sm">
          Your broking desk's DMAT accounts. New-DMAT and Active-Client counts in the Equity Team MIS come from
          these open / close dates.
        </p>
      </div>

      <EquityDmatManager />
    </div>
  );
}
