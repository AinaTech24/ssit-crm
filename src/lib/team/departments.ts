/**
 * `users.department` is optional and most firms never fill it in, so anything
 * keyed on that column alone finds nobody. Fall back to the role a person
 * already holds — the first match in this order wins.
 */
export const DEPT_ROLES: Array<[string, string[]]> = [
  ["leadership", ["owner", "branch_head"]],
  ["compliance", ["compliance"]],
  ["operations", ["ops"]],
  ["back_office", ["back_office"]],
  ["marketing", ["marketing"]],
  ["advisory", ["ria", "ra_research"]],
  ["sales", ["rm", "sub_broker", "ra_sales", "insurance"]],
  ["support", ["assistant", "gifting_hr"]],
];

export const DEPARTMENT_LABEL: Record<string, string> = {
  sales: "Sales",
  operations: "Operations",
  back_office: "Back Office",
  compliance: "Compliance",
  marketing: "Marketing",
  advisory: "Advisory",
  support: "Support",
  leadership: "Leadership",
  other: "Other",
};

export function inferDepartment(roles: string[] | null | undefined): string | null {
  const have = new Set(roles ?? []);
  for (const [dept, rs] of DEPT_ROLES) if (rs.some((r) => have.has(r))) return dept;
  return null;
}

/** The department a person belongs to: the one saved on their profile, else from their role. */
export function departmentOf(u: { department?: string | null; roles?: string[] | null }): string | null {
  return u.department || inferDepartment(u.roles);
}
