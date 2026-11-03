import { describe, it, expect } from "vitest";
import {
  CONTENT_KIND_KEYS,
  CONTENT_KIND_OPTIONS,
  MARKETING_EVENT_OPTIONS,
  MAX_MARKETING_ATTACHMENT_BYTES,
  MAX_TASK_ATTACHMENT_BYTES,
  contentKindLabel,
  resolveMarketingEvent,
} from "@/lib/tasks/marketing-content";

describe("marketing content kinds", () => {
  it("offers exactly the seven creatives marketing asked for, in order", () => {
    expect(CONTENT_KIND_OPTIONS.map((o) => o.label)).toEqual([
      "Invite image",
      "Video",
      "Reel",
      "Post",
      "One pager",
      "Newsletter",
      "Other creative",
    ]);
  });

  it("every offered kind is accepted by the API enum", () => {
    for (const o of CONTENT_KIND_OPTIONS) expect(CONTENT_KIND_KEYS).toContain(o.key);
  });

  it("keeps legacy carousel tasks readable", () => {
    expect(CONTENT_KIND_KEYS).toContain("carousel");
    expect(contentKindLabel("carousel")).toBe("Carousel");
    expect(CONTENT_KIND_OPTIONS.some((o) => o.key === "carousel")).toBe(false);
  });

  it("labels a kind and tolerates an unknown one", () => {
    expect(contentKindLabel("one_pager")).toBe("One pager");
    expect(contentKindLabel("some_new_kind")).toBe("some new kind");
    expect(contentKindLabel(undefined)).toBe("");
  });
});

describe("marketing events", () => {
  it("offers Masterclass, B2C, Staff training and Other", () => {
    expect(MARKETING_EVENT_OPTIONS.map((e) => e.label)).toEqual(["Masterclass", "B2C", "Staff training", "Other"]);
  });

  it("uses the fixed label for a named event", () => {
    expect(resolveMarketingEvent("masterclass", "ignored")).toEqual({ eventKey: "masterclass", eventLabel: "Masterclass" });
    expect(resolveMarketingEvent("staff_training", "")).toEqual({ eventKey: "staff_training", eventLabel: "Staff training" });
  });

  it("uses the typed text for Other, with a fallback", () => {
    expect(resolveMarketingEvent("other", "  Diwali mela ")).toEqual({ eventKey: "other", eventLabel: "Diwali mela" });
    expect(resolveMarketingEvent("other", "   ")).toEqual({ eventKey: "other", eventLabel: "Other" });
  });

  it("stores nothing when no event is picked or the key is unknown", () => {
    expect(resolveMarketingEvent("", "x")).toBeNull();
    expect(resolveMarketingEvent("nonsense", "x")).toBeNull();
  });
});

describe("attachment ceilings", () => {
  it("lets marketing creatives be larger than ordinary task documents", () => {
    expect(MAX_TASK_ATTACHMENT_BYTES).toBe(25 * 1024 * 1024);
    expect(MAX_MARKETING_ATTACHMENT_BYTES).toBeGreaterThan(MAX_TASK_ATTACHMENT_BYTES);
  });
});
