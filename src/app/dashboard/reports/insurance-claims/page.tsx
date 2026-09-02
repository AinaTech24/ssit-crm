import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { InsuranceClaimsBoard } from "@/components/reports/InsuranceClaimsBoard";

export const dynamic = "force-dynamic";

export default function InsuranceClaimsPage() {
  return (
    <div className="space-y-5 max-w-3xl">
      <div className="print:hidden">
        <Link
          href="/dashboard/reports"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"
        >
          <ChevronLeft className="size-3.5" /> Reports &amp; MIS
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Insurance Claims — Summary</h1>
        <p className="text-muted-foreground text-sm">
          Claims logged, settled, pending and file-not-received — counts and amounts.
        </p>
      </div>

      <InsuranceClaimsBoard />
    </div>
  );
}
