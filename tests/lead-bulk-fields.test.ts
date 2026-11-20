import { describe, it, expect } from "vitest";
import { LEAD_BULK_SOURCE_OPTIONS, findLeadBulkField, leadBulkGroups } from "@/lib/leads/bulk-fields";
import { LEAD_SOURCE_VALUES } from "@/lib/leads/normalize";

describe("leads bulk fields", () => {
  it("source choices are all real sources and never 'event' (that goes through the Event field)", () => {
    for (const o of LEAD_BULK_SOURCE_OPTIONS) expect(LEAD_SOURCE_VALUES as readonly string[]).toContain(o.value);
    expect(LEAD_BULK_SOURCE_OPTIONS.some((o) => o.value === "event")).toBe(false);
  });
  it("fills the Event field with the firm's events and leaves other fields alone", () => {
    const groups = leadBulkGroups([{ label: "IMA Surat" }, { label: "Mumbai Meet" }]);
    const ev = groups.flatMap((g) => g.fields).find((f) => f.key === "event");
    expect(ev?.options?.map((o) => o.value)).toEqual(["IMA Surat", "Mumbai Meet"]);
    expect(findLeadBulkField("event")?.options).toEqual([]);
    expect(findLeadBulkField("nope")).toBeUndefined();
  });
});
