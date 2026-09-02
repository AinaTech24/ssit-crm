"use client";

/**
 * Print toolbar for the proposal-print page.
 *   - Auto-fires window.print() once on mount (unless ?autoprint=0)
 *   - Renders a small toolbar at the top of the page (hidden on print)
 *     with "Back" + a manual "Save as PDF / Print" button.
 */

import { useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Printer } from "lucide-react";

export function ProposalPrintHelper({
  proposalId,
  recipientName,
}: {
  proposalId: string;
  recipientName: string;
}) {
  const params = useSearchParams();
  useEffect(() => {
    if (params.get("autoprint") === "0") return;
    const t = setTimeout(() => {
      try {
        window.print();
      } catch {
        /* ignore */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [params]);

  return (
    <div className="print:hidden bg-secondary/40 border-b border-border px-6 py-3 flex items-center justify-between sticky top-0 z-10 backdrop-blur">
      <div className="text-sm text-muted-foreground">
        Proposal PDF · <span className="font-medium text-foreground">{recipientName}</span>
      </div>
      <div className="flex items-center gap-2">
        <Link href={`/dashboard/proposals/${proposalId}`} className="btn-secondary text-xs">
          Back
        </Link>
        <button onClick={() => window.print()} className="btn-primary text-xs">
          <Printer className="size-3.5" /> Save as PDF / Print
        </button>
      </div>
    </div>
  );
}
