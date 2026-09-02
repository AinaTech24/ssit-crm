"use client";

/**
 * Themed filter bar for the platform support-tickets list. Three custom
 * dropdowns (status / category / priority) that instant-filter via the URL
 * query — no Apply button. Replaces the old native <select> + submit form.
 */

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ThemeSelect } from "@/components/ui/ThemeSelect";

const STATUS: [string, string][] = [
  ["", "All statuses"], ["open", "Open"], ["in_progress", "In progress"],
  ["waiting_customer", "Waiting customer"], ["resolved", "Resolved"], ["closed", "Closed"],
];
const CATEGORY: [string, string][] = [
  ["", "All categories"], ["bug", "Bug"], ["feature_request", "Feature request"],
  ["billing", "Billing"], ["training", "Training"], ["integration", "Integration"],
  ["data_help", "Data help"], ["other", "Other"],
];
const PRIORITY: [string, string][] = [
  ["", "All priorities"], ["urgent", "Urgent"], ["high", "High"], ["normal", "Normal"], ["low", "Low"],
];

export function SupportTicketFilters({
  status = "",
  category = "",
  priority = "",
}: {
  status?: string;
  category?: string;
  priority?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="border-b px-4 py-2.5 flex flex-wrap gap-2">
      <ThemeSelect value={status} onChange={(v) => setParam("status", v)} options={STATUS} wrapperClassName="min-w-[150px]" className="text-sm" />
      <ThemeSelect value={category} onChange={(v) => setParam("category", v)} options={CATEGORY} wrapperClassName="min-w-[160px]" className="text-sm" />
      <ThemeSelect value={priority} onChange={(v) => setParam("priority", v)} options={PRIORITY} wrapperClassName="min-w-[150px]" className="text-sm" />
    </div>
  );
}
