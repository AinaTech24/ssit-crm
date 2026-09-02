import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { SipRejectionBoard } from "@/components/reports/SipRejectionBoard";

export const dynamic = "force-dynamic";

export default function SipRejectionPage() {
  return (
    <div className="space-y-5 max-w-5xl">
      <div className="print:hidden">
        <Link
          href="/dashboard/reports"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"
        >
          <ChevronLeft className="size-3.5" /> Reports &amp; MIS
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">SIP Rejection, Pending &amp; Repurchase</h1>
        <p className="text-muted-foreground text-sm">
          Per branch, by RM (grouped into desks): SIP rejections &amp; pending, plus additional-purchase repurchase.
        </p>
      </div>

      <SipRejectionBoard />
    </div>
  );
}
