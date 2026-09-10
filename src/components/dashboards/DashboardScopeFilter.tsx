"use client";

/**
 * Firm-admin dashboard scope picker: a team, then a person in it.
 *
 * "Branch" in the schema is the legal/registered office — most firms have
 * exactly one, called Head Office. The units people actually run and report on
 * are DESKS (settings → Desks): Surat, Vadodara, Wealth, RA, RIA. A picker that
 * listed only the branches table therefore showed one entry and looked broken.
 *
 * So the first dropdown lists both levels: each branch, then its desks indented
 * beneath it. A firm with one branch simply sees its desks; a firm with several
 * gets the branch headings for free. Values are prefixed (`b:` / `d:`) so the
 * two id spaces can share one control without ever being confused.
 *
 * The second dropdown is the people in that scope, each shown as
 * "NAME (Role)" — the role travels with the person instead of being a separate
 * filter step to walk through.
 */

import { useRouter } from "next/navigation";
import { Building2, Users } from "lucide-react";
import { Select, type SelectOption } from "@/components/ui/Select";

export type ScopeMember = { id: string; name: string; roleLabel: string };
export type ScopeUnit = {
  /** "b:<branchId>" or "d:<deskId>". */
  value: string;
  label: string;
  /** 0 = branch, 1 = a desk inside it. */
  depth: number;
};

export function DashboardScopeFilter({
  units,
  members,
  selectedUnit,
  selectedMember,
  dateFrom,
  dateTo,
}: {
  units: ScopeUnit[];
  /** People in the selected scope. Empty until a scope is picked. */
  members: ScopeMember[];
  selectedUnit?: string;
  selectedMember?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  const router = useRouter();

  function go(unit: string, member: string) {
    const params = new URLSearchParams();
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    if (unit) params.set("unit", unit);
    if (member) params.set("rm", member);
    const qs = params.toString();
    router.push(`/dashboard${qs ? `?${qs}` : ""}`);
  }

  const unitOptions: SelectOption[] = [
    { value: "", label: "Whole firm" },
    ...units.map((u) => ({
      // Indent marks a desk as belonging to the branch above it.
      value: u.value,
      label: `${u.depth > 0 ? "    " : ""}${u.label}`,
    })),
  ];

  const memberOptions: SelectOption[] = [
    { value: "", label: "Everyone in this team" },
    ...members.map((m) => ({ value: m.id, label: `${m.name} (${m.roleLabel})` })),
  ];

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-medium text-muted-foreground inline-flex items-center gap-1.5">
        <Building2 className="size-3.5" /> Branch
      </span>
      <Select
        value={selectedUnit ?? ""}
        onChange={(v) => go(v, "")}
        options={unitOptions}
        size="sm"
        className="w-60"
        searchable={units.length > 8}
        ariaLabel="View dashboard for a branch or desk"
      />

      {selectedUnit && (
        <>
          <span className="text-xs font-medium text-muted-foreground inline-flex items-center gap-1.5 ml-1">
            <Users className="size-3.5" /> Member
          </span>
          <Select
            value={selectedMember ?? ""}
            onChange={(v) => go(selectedUnit, v)}
            options={memberOptions}
            size="sm"
            className="w-72"
            searchable={members.length > 8}
            placeholder={members.length ? "Everyone in this team" : "Nobody in this team"}
            disabled={members.length === 0}
            ariaLabel="View dashboard for a team member"
          />
        </>
      )}
    </div>
  );
}
