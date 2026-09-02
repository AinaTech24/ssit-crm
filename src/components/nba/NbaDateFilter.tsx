"use client";

/**
 * Next-Best-Action date-range filter. Writes `?date_from` / `?date_to`; the SSR'd
 * page filters the worklist by each action's "relevant date" (review-due,
 * follow-up, KYC expiry, bounce, birthday…). Thin client wrapper over the shared
 * DateRangePicker so the server component stays static.
 */

import { useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { DateRangePicker } from "@/components/ui/DateRangePicker";

export function NbaDateFilter({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();

  function onChange(f: string, t: string) {
    const params = new URLSearchParams(sp.toString());
    if (f) params.set("date_from", f);
    else params.delete("date_from");
    if (t) params.set("date_to", t);
    else params.delete("date_to");
    start(() => router.push(`${pathname}?${params.toString()}`));
  }

  return (
    <div className={pending ? "opacity-60 pointer-events-none" : ""}>
      <DateRangePicker label="Date" from={from} to={to} onChange={onChange} />
    </div>
  );
}
