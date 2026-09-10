"use client";

/**
 * Firm-admin dashboard scope picker: branch, then role, then a person.
 *
 * The old control was a single flat list of every active user in the firm. At
 * one branch that is fine; at five it is a scroll through strangers, and it
 * answers no structural question — you could see one RM's book but never "what
 * does the Andheri branch look like, who staffs its RA desk, and how is that
 * desk doing".
 *
 * So the scope walks the org chart:
 *   Whole firm                     → firm-wide cockpit
 *   Branch                         → that branch's team composition + its numbers
 *   Branch → Role                  → the same branch view, narrowed to that desk
 *   Branch → Role → Person         → that person's own dashboard, read-only
 *
 * Each dropdown only appears once the one before it is answered, so the bar is
 * one control until you actually start drilling. Roles come from ROLE_TREE, so
 * a parent like RA offers its Research and Sales desks indented beneath it and
 * selecting the parent covers both.
 */

import { useRouter } from "next/navigation";
import { Building2, Users, IdCard } from "lucide-react";
import { Select, type SelectOption } from "@/components/ui/Select";

export type ScopeMember = { id: string; name: string; roleKey: string; roleLabel: string };
export type ScopeRole = { key: string; label: string; depth: number; count: number };

export function DashboardScopeFilter({
  branches,
  roles,
  members,
  selectedBranch,
  selectedRole,
  selectedMember,
  dateFrom,
  dateTo,
}: {
  branches: { id: string; name: string }[];
  /** Role nodes with headcount for the selected branch. Empty until a branch is picked. */
  roles: ScopeRole[];
  /** Members matching branch + role, pre-sorted. Empty until a branch is picked. */
  members: ScopeMember[];
  selectedBranch?: string;
  selectedRole?: string;
  selectedMember?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  const router = useRouter();

  function go(branch: string, role: string, member: string) {
    const params = new URLSearchParams();
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    if (branch) params.set("branch", branch);
    if (role) params.set("role", role);
    if (member) params.set("rm", member);
    const qs = params.toString();
    router.push(`/dashboard${qs ? `?${qs}` : ""}`);
  }

  const branchOptions: SelectOption[] = [
    { value: "", label: "Whole firm" },
    ...branches.map((b) => ({ value: b.id, label: b.name })),
  ];

  // Sub-roles are indented under their parent. A role with nobody in it at this
  // branch is still listed, disabled — "this branch has no RIA" is an answer,
  // and silently dropping the row makes it look like the role does not exist.
  const roleOptions: SelectOption[] = [
    { value: "", label: "All roles" },
    ...roles.map((r) => ({
      value: r.key,
      label: `${r.depth > 0 ? "    " : ""}${r.label} (${r.count})`,
      disabled: r.count === 0,
    })),
  ];

  const memberOptions: SelectOption[] = [
    { value: "", label: "Everyone in this scope" },
    ...members.map((m) => ({ value: m.id, label: m.name })),
  ];

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-medium text-muted-foreground inline-flex items-center gap-1.5">
        <Building2 className="size-3.5" /> Branch
      </span>
      <Select
        value={selectedBranch ?? ""}
        onChange={(v) => go(v, "", "")}
        options={branchOptions}
        size="sm"
        className="w-52"
        searchable={branches.length > 8}
        ariaLabel="View dashboard for a branch"
      />

      {selectedBranch && (
        <>
          <span className="text-xs font-medium text-muted-foreground inline-flex items-center gap-1.5 ml-1">
            <IdCard className="size-3.5" /> Role
          </span>
          <Select
            value={selectedRole ?? ""}
            onChange={(v) => go(selectedBranch, v, "")}
            options={roleOptions}
            size="sm"
            className="w-56"
            ariaLabel="View dashboard for a role"
          />
        </>
      )}

      {selectedBranch && selectedRole && (
        <>
          <span className="text-xs font-medium text-muted-foreground inline-flex items-center gap-1.5 ml-1">
            <Users className="size-3.5" /> Member
          </span>
          <Select
            value={selectedMember ?? ""}
            onChange={(v) => go(selectedBranch, selectedRole, v)}
            options={memberOptions}
            size="sm"
            className="w-60"
            searchable={members.length > 8}
            placeholder={members.length ? "Everyone in this scope" : "Nobody in this role"}
            disabled={members.length === 0}
            ariaLabel="View dashboard for a team member"
          />
        </>
      )}
    </div>
  );
}
