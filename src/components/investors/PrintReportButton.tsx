"use client";

import { Printer } from "lucide-react";

export function PrintReportButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
    >
      <Printer className="size-4" /> Print / Save as PDF
    </button>
  );
}
