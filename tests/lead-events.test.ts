import { describe, it, expect } from "vitest";
import { eventKeyFor } from "@/lib/leads/events";

describe("lead event keys", () => {
  it("is the same key for the same event typed two ways", () => {
    expect(eventKeyFor("IMA Surat")).toBe("ima_surat");
    expect(eventKeyFor("  ima   surat ")).toBe("ima_surat");
    expect(eventKeyFor("Mumbai Investor Meet 2026")).toBe("mumbai_investor_meet_2026");
  });
});
