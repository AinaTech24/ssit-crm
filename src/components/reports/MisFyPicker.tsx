"use client";

/**
 * Fiscal-year selector for the Results MIS. Navigates to ?fy=YYYY-YY so the
 * server component re-queries — keeps all the heavy aggregation server-side.
 */

import { useRouter, usePathname } from "next/navigation";
import { Printer } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";

export function MisFyPicker({ fy, options }: { fy: string; options: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <div className="flex flex-wrap items-end gap-3 print:hidden">
      <label className="text-sm">
        <span className="block text-muted-foreground mb-1">Financial year</span>
        <SelectField
          className="w-40"
          value={fy}
          onChange={(e) => router.push(`${pathname}?fy=${e.target.value}`)}
        >
          {options.map((o) => (
            <option key={o} value={o}>
              FY {o}
            </option>
          ))}
        </SelectField>
      </label>
      <div className="flex-1" />
      <button type="button" onClick={() => window.print()} className="btn-secondary">
        <Printer className="size-4" /> Print
      </button>
    </div>
  );
}
