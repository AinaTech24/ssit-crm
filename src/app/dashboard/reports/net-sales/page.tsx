import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { NetSalesBoard } from "@/components/reports/NetSalesBoard";

export const dynamic = "force-dynamic";

export default function NetSalesPage() {
  return (
    <div className="space-y-5 max-w-3xl">
      <div className="print:hidden">
        <Link
          href="/dashboard/reports"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"
        >
          <ChevronLeft className="size-3.5" /> Reports &amp; MIS
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Net Sales — by Platform</h1>
        <p className="text-muted-foreground text-sm">
          Gross sales, redemption and net sales by execution platform, per product vertical.
        </p>
      </div>

      <NetSalesBoard />
    </div>
  );
}
