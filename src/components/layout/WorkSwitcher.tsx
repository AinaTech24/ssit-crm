"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/Select";

/**
 * Module switcher for the unified "Work" area — Tasks, Service Requests and
 * Complaints are one operational hub now, selected via this dropdown instead of
 * three separate sidebar items. Each option routes to its page (which keeps its
 * own server-side access gate, so the dropdown can safely list all three).
 *
 * Uses the themed `Select` (not a native <select>) so it matches the rest of
 * the app's dropdowns.
 */
const WORK_OPTIONS = [
  { value: "/dashboard/tasks", label: "Tasks" },
  { value: "/dashboard/service-requests", label: "Service Requests" },
  { value: "/dashboard/complaints", label: "Complaints" },
];

export function WorkSwitcher({
  current,
  options = WORK_OPTIONS,
  label = "Module",
}: {
  current: string;
  options?: { value: string; label: string }[];
  label?: string;
}) {
  const router = useRouter();
  return (
    <div className="inline-flex items-center gap-2 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="w-48">
        <Select
          value={current}
          ariaLabel={label}
          size="sm"
          options={options}
          onChange={(v) => { if (v) router.push(v); }}
        />
      </div>
    </div>
  );
}
