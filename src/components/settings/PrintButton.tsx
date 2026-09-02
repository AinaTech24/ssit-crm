"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="btn-ghost text-sm">
      <Printer className="size-4" /> Print
    </button>
  );
}
