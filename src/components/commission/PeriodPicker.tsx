"use client";

/**
 * Period selector for Brokerage reconciliation. Navigates to ?period=YYYY-MM so
 * the server component re-queries — keeps all the heavy aggregation server-side.
 * Uses the branded SelectField (custom themed options popup) in place of the
 * old native <select> + form-submit.
 */

import { useRouter, usePathname } from "next/navigation";
import { SelectField } from "@/components/ui/SelectField";

export function PeriodPicker({
  period,
  options,
}: {
  period: string;
  options: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <div className="flex items-center gap-2 text-sm">
      <label className="text-muted-foreground">Period:</label>
      <SelectField
        className="w-36"
        value={period}
        onChange={(e) => router.push(`${pathname}?period=${e.target.value}`)}
      >
        {[period, ...options.filter((p) => p !== period)].map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </SelectField>
    </div>
  );
}
