import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { InsuranceProductionBoard } from "@/components/reports/InsuranceProductionBoard";

export const dynamic = "force-dynamic";

export default function InsuranceProductionPage() {
  return (
    <div className="space-y-5 max-w-4xl">
      <div className="print:hidden">
        <Link
          href="/dashboard/reports"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"
        >
          <ChevronLeft className="size-3.5" /> Reports &amp; MIS
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Insurance Production — by Advisor</h1>
        <p className="text-muted-foreground text-sm">
          Personal &amp; commercial-line premium booked in the FY, split New vs Renewal, per advisor.
        </p>
      </div>

      <InsuranceProductionBoard />
    </div>
  );
}
