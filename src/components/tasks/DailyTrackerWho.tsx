"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/Select";

/** Owner-only — switch whose Daily Job Tracker you're viewing (read-only). */
export function DailyTrackerWho({ members, current }: { members: { id: string; name: string }[]; current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function set(v: string) {
    const params = new URLSearchParams(sp.toString());
    if (v) params.set("user", v);
    else params.delete("user");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <Select
      value={current}
      onChange={set}
      options={[{ value: "", label: "My day" }, ...members.map((m) => ({ value: m.id, label: m.name }))]}
      className="w-52"
      size="sm"
      ariaLabel="Whose tracker to view"
      searchable
    />
  );
}
