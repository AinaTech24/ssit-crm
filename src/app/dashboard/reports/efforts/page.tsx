import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { EffortsBoard } from "@/components/reports/EffortsBoard";

export const dynamic = "force-dynamic";

export default function EffortsPage() {
  return (
    <div className="space-y-5 max-w-3xl">
      <div className="print:hidden">
        <Link
          href="/dashboard/reports"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"
        >
          <ChevronLeft className="size-3.5" /> Reports &amp; MIS
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Efforts — Plan vs Actual</h1>
        <p className="text-muted-foreground text-sm">
          Leading-activity tracker: reviews, meetings, IAPs/FWPs, new leads, financial plans.
        </p>
      </div>

      <EffortsBoard />
    </div>
  );
}
