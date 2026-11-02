import { describe, expect, it } from "vitest";
import { isMeetingVisible, type MeetingScope } from "@/lib/auth/data-scope";

/** A tx whose lookup of "is the booker in my desk" answers as told. */
const tx = (inMyDesk: boolean) => ({ execute: async () => ({ rows: inMyDesk ? [{ "?column?": 1 }] : [] }) });

const deskHead: MeetingScope = { scope: { kind: "desks", deskIds: ["desk-1"] }, delegatedIds: [], userId: "chirag" };

describe("a single meeting follows the same wall as the list", () => {
  it("lets a sub-branch head open a meeting booked by someone in their desk (this was a 404)", async () => {
    expect(await isMeetingVisible(tx(true), deskHead, { createdById: "team-member", ownerId: null })).toBe(true);
  });

  it("still refuses a meeting booked by someone in another desk", async () => {
    expect(await isMeetingVisible(tx(false), deskHead, { createdById: "other-desk-rm", ownerId: null })).toBe(false);
  });

  it("always lets the booker and anyone named on it in, without a lookup", async () => {
    const own: MeetingScope = { scope: { kind: "own", userId: "rm" }, delegatedIds: [], userId: "rm" };
    expect(await isMeetingVisible(tx(false), own, { createdById: "rm" })).toBe(true);
    expect(await isMeetingVisible(tx(false), own, { createdById: "x", collaboratorIds: ["rm"] })).toBe(true);
    expect(await isMeetingVisible(tx(false), own, { createdById: "x", ownerId: null })).toBe(false);
  });

  it("lets the firm-wide wall see everything", async () => {
    const all: MeetingScope = { scope: { kind: "all" }, delegatedIds: [], userId: "owner" };
    expect(await isMeetingVisible(tx(false), all, { createdById: "anyone" })).toBe(true);
  });
});
