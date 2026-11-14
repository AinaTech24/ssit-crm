import { describe, expect, it } from "vitest";
import { ASSIGNABLE_ROLES, areAssignableRoles, can, primaryRoleLabel } from "@/lib/auth/rbac";
import { roleDefaultNavKeys } from "@/config/nav-access";

describe("Accounts role", () => {
  it("can be assigned and is labelled", () => {
    expect(ASSIGNABLE_ROLES).toContain("accounts");
    expect(areAssignableRoles(["accounts"])).toBe(true);
    expect(primaryRoleLabel(["accounts"])).toBe("Accounts");
  });

  it("does the books: expenses, practice finances, commission MIS", () => {
    expect(can(["accounts"], "expense.manage")).toBe(true);
    expect(can(["accounts"], "finances.view")).toBe(true);
    expect(can(["accounts"], "reports.commission")).toBe(true);
  });

  it("has no book of clients or leads, and no firm administration", () => {
    expect(can(["accounts"], "investor.view.all")).toBe(false);
    expect(can(["accounts"], "investor.edit.all")).toBe(false);
    expect(can(["accounts"], "lead.view.all")).toBe(false);
    expect(can(["accounts"], "settings.billing")).toBe(false);
    expect(can(["accounts"], "settings.users")).toBe(false);
  });

  it("opens on finances plus the everyday self-service items", () => {
    const keys = roleDefaultNavKeys(["accounts"]) ?? [];
    expect(keys).toEqual(expect.arrayContaining(["/dashboard/finances", "/dashboard/finances/expenses", "/dashboard/attendance"]));
    expect(keys).not.toContain("/dashboard/investors");
    // Holding another, unrestricted role as well never narrows anything.
    expect(roleDefaultNavKeys(["accounts", "rm"])).toBeNull();
  });
});

describe("assigning tasks to other people", () => {
  it("every staff role that can create a task may assign it to someone else", async () => {
    const { ASSIGNABLE_ROLES, can } = await import("@/lib/auth/rbac");
    const missing = ASSIGNABLE_ROLES.filter(
      (r) => (can([r], "task.edit.assigned") || can([r], "task.edit.all")) && !can([r], "task.assign.others")
    );
    expect(missing).toEqual([]);
  });

  it("Accounts can assign tasks to others", async () => {
    const { can } = await import("@/lib/auth/rbac");
    expect(can(["accounts"], "task.assign.others")).toBe(true);
  });
});
