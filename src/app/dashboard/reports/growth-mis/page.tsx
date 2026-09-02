import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { GrowthMisBoard } from "@/components/reports/GrowthMisBoard";

export const dynamic = "force-dynamic";

export default function GrowthMisPage() {
  return (
    <div className="space-y-5 max-w-5xl">
      <div className="print:hidden">
        <Link
          href="/dashboard/reports"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"
        >
          <ChevronLeft className="size-3.5" /> Reports &amp; MIS
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Growth MIS</h1>
        <p className="text-muted-foreground text-sm">
          One screen tying efforts to results — the monthly review at a glance.
        </p>
      </div>

      <GrowthMisBoard />
    </div>
  );
}
