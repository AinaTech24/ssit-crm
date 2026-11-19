import { describe, it, expect } from "vitest";
import { BULK_FIELD_GROUPS, findBulkField } from "../src/lib/investors/bulk-fields";
import { isMeetingParticipantSql, meetingParticipantsLateral } from "../src/lib/meetings/participants";

describe("bulk-update field catalogue", () => {
  const all = BULK_FIELD_GROUPS.flatMap((g) => g.fields);

  it("has unique keys and a value list for every select", () => {
    expect(new Set(all.map((f) => f.key)).size).toBe(all.length);
    for (const f of all.filter((x) => x.kind === "select")) {
      expect(f.options?.length ?? 0).toBeGreaterThan(0);
      expect(f.column).toBeTruthy();
    }
  });

  it("never offers fields that carry a compliance trail of their own", () => {
    for (const k of ["kycStatus", "riskProfile", "pan", "rmId", "bankName", "nominees"]) {
      expect(findBulkField(k)).toBeUndefined();
    }
  });

  it("covers the groups shown in the dialog", () => {
    expect(BULK_FIELD_GROUPS.map((g) => g.group)).toEqual(["Service", "Classification", "Profile", "Address", "Tags"]);
    expect(findBulkField("tag_add")?.kind).toBe("tag_add");
    expect(findBulkField("city")?.target).toBe("address");
  });
});

describe("meeting participants SQL", () => {
  it("accepts a plain table alias and refuses anything else", () => {
    expect(() => isMeetingParticipantSql("m", "11111111-1111-1111-1111-111111111111")).not.toThrow();
    expect(() => meetingParticipantsLateral("review_meetings")).not.toThrow();
    expect(() => meetingParticipantsLateral("m; DROP TABLE users")).toThrow();
    expect(() => isMeetingParticipantSql("m.x", "11111111-1111-1111-1111-111111111111")).toThrow();
  });
});
