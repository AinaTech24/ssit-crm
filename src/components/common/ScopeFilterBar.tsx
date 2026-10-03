"use client";

/**
 * "Sub-branch" + "RM" dropdowns for a list page.
 *
 * Same two params the dashboard has always used (`?unit=` + `?rm=`), so a desk
 * chosen on Clients is still chosen when you move to Leads or Tasks instead of
 * resetting at every module.
 *
 * Every OTHER query param on the page is preserved when these change — a
 * search, a status filter or a sort is not something to lose because someone
 * picked a desk. Page number is the exception: narrowing the list invalidates
 * whatever page 4 used to mean, so it resets to the first.
 *
 * Branches and desks share one control, values prefixed `b:` / `d:` so the two
 * id spaces can never be confused. Firms run their real structure at DESK
 * level — "Surat", "Vadodara" are desks under one registered office — which is
 * why the desks are the indented entries people actually pick.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { Building2, User } from "lucide-react";
import type { ScopeMember, ScopeUnit } from "@/lib/scope/view-filter";

export function ScopeFilterBar({
  basePath,
  units,
  members,
  selectedUnit,
  selectedMember,
  unitLabel = "Sub-branch",
  className = "",
}: {
  /** e.g. "/dashboard/investors" */
  basePath: string;
  units: ScopeUnit[];
  /** People in the selected unit. Empty until a unit is picked. */
  members: ScopeMember[];
  selectedUnit?: string;
  selectedMember?: string;
  unitLabel?: string;
  className?: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();

  function go(unit: string, member: string) {
    const params = new URLSearchParams(sp?.toString() ?? "");
    if (unit) params.set("unit", unit);
    else params.delete("unit");
    if (member) params.set("rm", member);
    else params.delete("rm");
    // A narrower list makes the old page number meaningless.
    params.delete("page");
    const qs = params.toString();
    router.push(`${basePath}${qs ? `?${qs}` : ""}`);
  }

  if (units.length === 0) return null;
  // One unit means a sub-branch head confined to their own: there is nothing
  // to choose between, so the sub-branch dropdown is the firm admin's control,
  // not theirs. They still get the team-member picker for their own people.
  const confined = units.length === 1;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {!confined && (
      <div className="inline-flex items-center gap-1.5">
        <Building2 className="size-3.5 text-muted-foreground" />
        <select
          value={selectedUnit ?? ""}
          onChange={(e) => go(e.target.value, "")}
          className="input-base h-8 text-xs py-0 pr-7"
          aria-label={unitLabel}
        >
          <option value="">All {unitLabel.toLowerCase()}s</option>
          {units.map((u) => (
            <option key={u.value} value={u.value}>
              {u.depth > 0 ? `   ${u.label}` : u.label}
            </option>
          ))}
        </select>
      </div>
      )}

      <div className="inline-flex items-center gap-1.5">
        <User className="size-3.5 text-muted-foreground" />
        <select
          value={selectedMember ?? ""}
          onChange={(e) => go(selectedUnit ?? "", e.target.value)}
          disabled={members.length === 0}
          className="input-base h-8 text-xs py-0 pr-7 disabled:opacity-50"
          aria-label="Team member"
          title={members.length === 0 ? `Pick a ${unitLabel.toLowerCase()} first` : undefined}
        >
          <option value="">
            {members.length === 0 ? `Pick a ${unitLabel.toLowerCase()} first` : confined ? "Everyone" : "Everyone in it"}
          </option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.roleLabel})
            </option>
          ))}
        </select>
      </div>

      {((!confined && selectedUnit) || selectedMember) && (
        <button
          type="button"
          onClick={() => go("", "")}
          className="text-[11px] text-muted-foreground hover:underline"
        >
          Clear
        </button>
      )}
    </div>
  );
}
