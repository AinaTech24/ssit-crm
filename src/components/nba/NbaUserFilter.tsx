"use client";

/**
 * Next-Best-Action user filter (owners only). Scopes the worklist to a specific
 * team member by writing `?user=<id>`; "All users" (empty) clears it back to
 * firm-wide. Preserves the other params (date range, urgency, type).
 */

import { useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Users } from "lucide-react";
import { Select } from "@/components/ui/Select";

export function NbaUserFilter({
  value,
  options,
}: {
  value: string;
  options: { value: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();

  function onChange(v: string) {
    const params = new URLSearchParams(sp.toString());
    if (v) params.set("user", v);
    else params.delete("user");
    start(() => router.push(`${pathname}?${params.toString()}`));
  }

  return (
    <div className={`inline-flex items-center gap-1.5 text-xs ${pending ? "opacity-60 pointer-events-none" : ""}`}>
      <Users className="size-3.5 text-muted-foreground" />
      <Select
        size="sm"
        value={value}
        onChange={onChange}
        options={[{ value: "", label: "All users" }, ...options]}
        placeholder="All users"
        ariaLabel="Filter by team member"
        className="min-w-[10rem]"
      />
    </div>
  );
}
