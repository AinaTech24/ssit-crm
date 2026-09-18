/**
 * Departments, and the roles that belong to each.
 *
 * A firm thinks in departments ("assign this to Sales") but the CRM stores
 * ROLES on every user and leaves `users.department` optional — in practice
 * most employee records never have it filled in. Matching an assignee picker
 * on the department column alone therefore offers nobody, which is useless.
 *
 * So a department resolves to a SET OF ROLES, and a picker offers anyone whose
 * roles overlap it OR whose department column says so explicitly. Firms that do
 * maintain the column get exact control; firms that don't still get a sensible
 * list out of the box.
 *
 * Deliberately NOT narrowed by branch or desk: "Sales" means every RM and sub
 * broker in the firm, whichever sub-branch they sit in. Task assignment crosses
 * desks — that's the point of it — and it is separate from the DATA wall, which
 * decides what someone can see once the task exists.
 */

export const DEPARTMENTS: [string, string][] = [
  ["sales", "Sales"],
  ["operations", "Operations"],
  ["back_office", "Back Office"],
  ["compliance", "Compliance"],
  ["marketing", "Marketing"],
  ["advisory", "Advisory"],
  ["support", "Support"],
  ["leadership", "Leadership"],
  ["other", "Other"],
];

/** Roles that make someone a member of a department for assignment purposes. */
export const DEPARTMENT_ROLES: Record<string, string[]> = {
  // Everyone who carries a book and sells.
  sales: ["rm", "sub_broker", "ra_sales", "insurance"],
  operations: ["ops", "back_office"],
  back_office: ["back_office", "ops"],
  compliance: ["compliance"],
  marketing: ["marketing"],
  // Fee-based advice and the research that feeds it.
  advisory: ["ria", "ra_research"],
  support: ["assistant", "gifting_hr"],
  leadership: ["owner", "branch_head"],
  // No role maps to "Other" — it matches on the department column only.
  other: [],
};

/** Does this person belong to `department`, by explicit column or by role? */
export function inDepartment(
  user: { roles?: string[] | null; department?: string | null },
  department: string
): boolean {
  if (user.department === department) return true;
  const roles = DEPARTMENT_ROLES[department] ?? [];
  return (user.roles ?? []).some((r) => roles.includes(r));
}
