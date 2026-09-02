import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { OtherServicesBoard } from "@/components/reports/OtherServicesBoard";

export const dynamic = "force-dynamic";

export default function OtherServicesPage() {
  return (
    <div className="space-y-5 max-w-4xl">
      <div className="print:hidden">
        <Link
          href="/dashboard/reports"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"
        >
          <ChevronLeft className="size-3.5" /> Reports &amp; MIS
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Back-Office — Other Services</h1>
        <p className="text-muted-foreground text-sm">
          Service-request volumes by type and branch — IIN, CAN, bank/name/email/mobile change, switch, SWP,
          nominee, KYC.
        </p>
      </div>

      <OtherServicesBoard />
    </div>
  );
}
