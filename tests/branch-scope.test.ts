import { describe, it, expect } from "vitest";
import {
  ALL_BRANCH_ROLES,
  OWN_BRANCH_ROLES,
  managesOwnBranch,
  seesAllBranches,
  resolveDataScope,
  dataScopeSql,
  isInScope,
  type DataScope,
} from "@/lib/auth/data-scope";
import type { SessionUser } from "@/lib/auth/session";

/**
 * The data wall.
 *
 *   a branch's data is invisible to another branch;
 *   inside a branch, one person's data is invisible to another person;
 *   back office + the firm admin see everything;
 *   a branch head sees their own branch in full, automatically;
 *   a per-user branch grant lifts both walls for the granted branches, and
 *     stacks on top of a branch head's own branch.
 *
 * These tests pin the rule itself. The SQL it produces is exercised against a
 * real database separately — here we care that the right SHAPE comes out for
 * each kind of session, because that is what silently regresses.
 */

const BRANCH_A = "11111111-1111-1111-1111-111111111111";
const BRANCH_B = "22222222-2222-2222-2222-222222222222";
const ME = "99999999-9999-9999-9999-999999999999";
const SOMEONE_ELSE = "88888888-8888-8888-8888-888888888888";

function session(roles: string[], branchId?: string | null): SessionUser {
  return {
    userId: ME,
    tenantId: "33333333-3333-3333-3333-333333333333",
    branchId: branchId ?? undefined,
    roles,
    email: "u@example.com",
    name: "Test User",
    permissions: [],
  } as unknown as SessionUser;
}

/** A tx stub returning a fixed allowed_branches value. */
function txWithGrant(allowed: unknown) {
  return { execute: async () => ({ rows: [{ allowed_branches: allowed }] }) };
}

const COLS = { branch: "investors.branch_id", owner: "investors.rm_id" };
const text = (frag: unknown) => JSON.stringify(frag);

describe("seesAllBranches", () => {
  it("is true for the owner and both back-office roles", () => {
    for (const role of ALL_BRANCH_ROLES) {
      expect(seesAllBranches(session([role]))).toBe(true);
    }
  });

  it("is false for every other role — including the ones that used to see all", () => {
    // compliance and gifting_hr hold investor.view.all and marketing holds
    // lead.view.all; none of that means the whole FIRM any more. branch_head is
    // here too: it sees one branch, which is not the same as all of them.
    for (const role of ["compliance", "gifting_hr", "marketing", "branch_head", "sub_broker", "rm", "ria", "insurance"]) {
      expect(seesAllBranches(session([role]))).toBe(false);
    }
  });

  it("is true when a restricted role is stacked with an unrestricted one", () => {
    expect(seesAllBranches(session(["rm", "back_office"]))).toBe(true);
  });
});

describe("managesOwnBranch", () => {
  it("is true for a branch head with a branch", () => {
    for (const role of OWN_BRANCH_ROLES) {
      expect(managesOwnBranch(session([role], BRANCH_A))).toBe(true);
    }
  });

  it("is false for a branch head with NO branch assigned", () => {
    // Nothing to wall to — they fall through to own-records rather than being
    // walled against a branch that does not exist, which would match nothing.
    expect(managesOwnBranch(session(["branch_head"], null))).toBe(false);
  });

  it("is false for every non-managing role", () => {
    for (const role of ["rm", "sub_broker", "compliance", "ria", "insurance", "marketing"]) {
      expect(managesOwnBranch(session([role], BRANCH_A))).toBe(false);
    }
  });
});

describe("resolveDataScope", () => {
  it("gives back office everything without reading a grant", async () => {
    const tx = { execute: async () => { throw new Error("should not query"); } };
    expect(await resolveDataScope(tx, session(["back_office"]))).toEqual({ kind: "all" });
  });

  it("gives a branch head their OWN branch with no grant at all", async () => {
    const scope = await resolveDataScope(txWithGrant(null), session(["branch_head"], BRANCH_A));
    expect(scope).toEqual({ kind: "branches", branchIds: [BRANCH_A] });
  });

  it("adds a grant ON TOP of a branch head's own branch", async () => {
    const scope = await resolveDataScope(txWithGrant([BRANCH_B]), session(["branch_head"], BRANCH_A));
    expect(scope.kind).toBe("branches");
    expect([...(scope as { branchIds: string[] }).branchIds].sort()).toEqual([BRANCH_A, BRANCH_B].sort());
  });

  it("does not list a branch twice when the grant repeats the head's own branch", async () => {
    const scope = await resolveDataScope(txWithGrant([BRANCH_A]), session(["branch_head"], BRANCH_A));
    expect(scope).toEqual({ kind: "branches", branchIds: [BRANCH_A] });
  });

  it("falls back to own-records for a branch head with no branch assigned", async () => {
    const scope = await resolveDataScope(txWithGrant(null), session(["branch_head"], null));
    expect(scope).toEqual({ kind: "own", userId: ME });
  });

  it("still gives a plain RM own-records when there is no grant", async () => {
    const scope = await resolveDataScope(txWithGrant(null), session(["rm"], BRANCH_A));
    expect(scope).toEqual({ kind: "own", userId: ME });
  });

  it("falls back to own-records when the grant is an empty list", async () => {
    const scope = await resolveDataScope(txWithGrant([]), session(["rm"], BRANCH_A));
    expect(scope).toEqual({ kind: "own", userId: ME });
  });

  it("honours a branch grant", async () => {
    const scope = await resolveDataScope(txWithGrant([BRANCH_A, BRANCH_B]), session(["branch_head"], BRANCH_A));
    expect(scope).toEqual({ kind: "branches", branchIds: [BRANCH_A, BRANCH_B] });
  });

  it("drops junk entries from the grant rather than casting them to uuid", async () => {
    // The column is free-form jsonb; a bad value would otherwise reach ::uuid
    // and 500 the page.
    const scope = await resolveDataScope(txWithGrant([BRANCH_A, "not-a-uuid", 42, null]), session(["rm"]));
    expect(scope).toEqual({ kind: "branches", branchIds: [BRANCH_A] });
  });

  it("fails CLOSED to own-records when the grant cannot be read", async () => {
    const tx = { execute: async () => { throw new Error("no such column"); } };
    expect(await resolveDataScope(tx, session(["rm"]))).toEqual({ kind: "own", userId: ME });
  });
});

describe("dataScopeSql", () => {
  it("is TRUE for an unrestricted session", () => {
    const frag = text(dataScopeSql({ kind: "all" }, COLS));
    expect(frag).not.toContain("branch_id");
    expect(frag).not.toContain("rm_id");
  });

  it("filters on branch for a granted session, and only the granted ones", () => {
    const frag = text(dataScopeSql({ kind: "branches", branchIds: [BRANCH_A] }, COLS));
    expect(frag).toContain("branch_id");
    expect(frag).toContain(BRANCH_A);
    expect(frag).not.toContain(BRANCH_B);
  });

  it("filters on the owner column for everyone else", () => {
    const frag = text(dataScopeSql({ kind: "own", userId: ME }, COLS));
    expect(frag).toContain("rm_id");
    expect(frag).toContain(ME);
    // The branch is NOT part of an own-records filter: the record is yours
    // wherever it sits.
    expect(frag).not.toContain("branch_id");
  });
});

describe("isInScope — the single-row path", () => {
  const own: DataScope = { kind: "own", userId: ME };
  const granted: DataScope = { kind: "branches", branchIds: [BRANCH_A] };

  it("lets an unrestricted session open anything", () => {
    expect(isInScope({ kind: "all" }, { branchId: BRANCH_B, ownerId: SOMEONE_ELSE })).toBe(true);
  });

  it("admits your own record and refuses a colleague's", () => {
    expect(isInScope(own, { branchId: BRANCH_A, ownerId: ME })).toBe(true);
    expect(isInScope(own, { branchId: BRANCH_A, ownerId: SOMEONE_ELSE })).toBe(false);
  });

  it("admits a granted branch whoever owns the record", () => {
    expect(isInScope(granted, { branchId: BRANCH_A, ownerId: SOMEONE_ELSE })).toBe(true);
  });

  it("refuses an ungranted branch", () => {
    expect(isInScope(granted, { branchId: BRANCH_B, ownerId: SOMEONE_ELSE })).toBe(false);
  });

  it("refuses a record with no branch to a branch-granted session", () => {
    // Unassigned rows must not leak through a grant that names real branches.
    expect(isInScope(granted, { branchId: null, ownerId: SOMEONE_ELSE })).toBe(false);
  });
});
