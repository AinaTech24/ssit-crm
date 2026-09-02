import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { BackOfficeWorkBoard } from "@/components/reports/BackOfficeWorkBoard";

export const dynamic = "force-dynamic";

export default function BackOfficeWorkPage() {
  return (
    <div className="space-y-5 max-w-5xl">
      <div className="print:hidden">
        <Link
          href="/dashboard/reports"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"
        >
          <ChevronLeft className="size-3.5" /> Reports &amp; MIS
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Back-Office Work</h1>
        <p className="text-muted-foreground text-sm">
          Rectification &amp; operations throughput by branch — Online / Offline, value and count.
        </p>
      </div>

      <BackOfficeWorkBoard />
    </div>
  );
}
