"use client";

/**
 * Employee picker for the attendance calendar. Managers only — the server page
 * ignores ?employee= for everyone else, so this is a convenience, not the gate.
 *
 * Navigates rather than fetching: the calendar is a server component and the
 * month is already in the URL, so a plain push keeps the two in sync and makes
 * the view linkable/back-button-able.
 */

import { useRouter } from "next/navigation";
import { SelectField } from "@/components/ui/SelectField";

export function AttendanceEmployeeSelect({
  value,
  month,
  selfId,
  options,
}: {
  value: string;
  month: string;
  /** Viewing yourself needs no ?employee= — keeps the default URL clean. */
  selfId: string;
  options: { value: string; label: string }[];
}) {
  const router = useRouter();
  return (
    <SelectField
      value={value}
      size="sm"
      className="w-44"
      searchable
      aria-label="Employee"
      onChange={(e) => {
        const next = e.target.value;
        const params = new URLSearchParams({ month });
        if (next !== selfId) params.set("employee", next);
        router.push(`/dashboard/attendance/calendar?${params.toString()}`);
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </SelectField>
  );
}
