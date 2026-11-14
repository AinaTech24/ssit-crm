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
