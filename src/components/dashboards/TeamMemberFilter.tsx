"use client";

/**
 * Team-member scope selector for the Team Dashboard. Picking a member reloads
 * /dashboard/team with ?member=<id> (preserving the from/to range), which
 * scopes every Open/Periodic/Result metric + the per-RM table to that member.
 * "Whole team" clears the scope.
 */

import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { Select } from "@/components/ui/Select";

export function TeamMemberFilter({
  members,
  selected,
  from,
  to,
}: {
  members: { id: string; name: string }[];
  selected?: string;
  from: string;
  to: string;
}) {
  const router = useRouter();

  const options = [
    { value: "", label: "Whole team" },
    ...members.map((m) => ({ value: m.id, label: m.name })),
  ];

  function onChange(v: string) {
    const params = new URLSearchParams();
    params.set("from", from);
    params.set("to", to);
    if (v) params.set("member", v);
    router.push(`/dashboard/team?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground inline-flex items-center gap-1.5">
        <Users className="size-3.5" /> Viewing
      </span>
      <Select
        value={selected ?? ""}
        onChange={onChange}
        options={options}
        size="sm"
        className="w-48"
        ariaLabel="View team dashboard for a member"
      />
    </div>
  );
}
