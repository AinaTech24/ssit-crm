import { describe, expect, it } from "vitest";
import { hasUnit, unitOfRecord, usersWithRolesInUnit } from "@/lib/notifications/branch-recipients";

/** A fake tx that records the SQL it was asked to run and answers with canned rows. */
function fakeTx(rowsFor: (sqlText: string) => unknown[]) {
  const seen: string[] = [];
  return {
    seen,
    tx: {
      execute: async (q: any) => {
        const text = (q?.queryChunks ?? [])
          .map((c: any) => (typeof c === "string" ? c : (c?.value ?? c?.queryChunks ?? []).toString()))
          .join("");
        seen.push(text);
        return { rows: rowsFor(text) };
      },
    },
  };
}

describe("branch-wise recipients", () => {
  it("a unit narrows only when it has a branch or a desk", () => {
    expect(hasUnit(null)).toBe(false);
    expect(hasUnit({ branchId: null, deskId: null })).toBe(false);
    expect(hasUnit({ branchId: "b", deskId: null })).toBe(true);
    expect(hasUnit({ branchId: null, deskId: "d" })).toBe(true);
  });

  it("returns nobody for an empty role list without touching the database", async () => {
    const { tx, seen } = fakeTx(() => []);
    expect(await usersWithRolesInUnit(tx, "t", [], { branchId: "b", deskId: null })).toEqual([]);
    expect(seen).toHaveLength(0);
  });

  it("returns the ids the query finds", async () => {
    const { tx } = fakeTx(() => [{ id: "u1" }, { id: "u2" }]);
    expect(await usersWithRolesInUnit(tx, "t", ["rm"], { branchId: "b", deskId: null })).toEqual(["u1", "u2"]);
  });

  it("a record with its own branch uses it; otherwise the owner's branch", async () => {
    const { tx } = fakeTx(() => [{ branch_id: "baroda", desk_id: null }]);
    expect(await unitOfRecord(tx, "t", { branch_id: "mumbai", rm_id: "u" })).toEqual({ branchId: "mumbai", deskId: null });
    expect(await unitOfRecord(tx, "t", { rm_id: "u" })).toEqual({ branchId: "baroda", deskId: null });
    expect(await unitOfRecord(tx, "t", {})).toBeNull();
    expect(await unitOfRecord(tx, "t", null)).toBeNull();
  });
});

describe("a firm run by desks under one shared branch", () => {
  // Every user sits under "Head Office"; the desks are the real branches. Matching a
  // desk member on the shared branch as well told every head in the firm.
  it("matches a person on a desk by the desk, and falls back to the branch only for people with no desk", async () => {
    // Flatten the drizzle query (nested fragments included) into plain text.
    const flat = (c: any): string =>
      typeof c === "string"
        ? c
        : Array.isArray(c)
          ? c.map(flat).join("")
          : c?.queryChunks
            ? flat(c.queryChunks)
            : c?.value !== undefined
              ? flat(c.value)
              : "?";
    let captured = "";
    const tx = {
      execute: async (q: any) => {
        captured = flat(q);
        return { rows: [] };
      },
    };
    await usersWithRolesInUnit(tx, "t", ["branch_head"], { branchId: "head-office", deskId: "wealth" });
    const q = captured.replace(/\s+/g, " ");
    expect(q).toContain("desk_id =");
    expect(q).toContain("desk_id IS NULL AND branch_id =");
    expect(q).not.toMatch(/OR branch_id =/);
  });
});
