import { describe, it, expect } from "vitest";
import { displayStatus, isApprovedAwaitingPost } from "@/lib/tasks/display-status";
import {
  CONTENT_KIND_KEYS,
  CONTENT_KIND_OPTIONS,
  MARKETING_EVENT_OPTIONS,
  MAX_MARKETING_ATTACHMENT_BYTES,
  MAX_TASK_ATTACHMENT_BYTES,
  contentKindLabel,
  assignedToMarketing,
  marketingApproverFor,
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

describe("who approves a marketing task", () => {
  it("the person who assigned it, not the marketing person", () => {
    expect(marketingApproverFor({ createdById: "palak" })).toBe("palak");
  });
  it("a named approver wins over the assigner", () => {
    expect(marketingApproverFor({ explicitId: "boss", createdById: "palak" })).toBe("boss");
  });
  it("a marketing person who assigned it to themselves approves it themselves", () => {
    expect(marketingApproverFor({ createdById: "dhvani" })).toBe("dhvani");
  });
  it("only a task with no creator (made by an automation) has nobody — the caller falls back", () => {
    expect(marketingApproverFor({ createdById: null })).toBeNull();
    expect(marketingApproverFor({})).toBeNull();
  });
});

describe("a task handed to a marketing person", () => {
  it("follows the marketing flow when someone else assigns it", () => {
    expect(assignedToMarketing(["marketing"], "dhvani", "palak")).toBe(true);
    expect(assignedToMarketing(["rm", "marketing"], "dhvani", "palak")).toBe(true);
  });
  it("is not a hand-off when assigned to yourself, or to a non-marketing person", () => {
    expect(assignedToMarketing(["marketing"], "dhvani", "dhvani")).toBe(false);
    expect(assignedToMarketing(["rm"], "x", "palak")).toBe(false);
    expect(assignedToMarketing(null, "x", "palak")).toBe(false);
  });
});

describe("the status people see", () => {
  it("shows Approved once approved and not yet posted, whatever the stored status", () => {
    expect(isApprovedAwaitingPost({ status: "in_progress", approvalStatus: "approved" })).toBe(true);
    expect(isApprovedAwaitingPost({ status: "open", approvalStatus: "approved" })).toBe(true);
    expect(displayStatus({ status: "in_progress", approvalStatus: "approved" })).toBe("approved");
  });
  it("goes back to the real status when it is posted, cancelled, pending or rejected", () => {
    expect(displayStatus({ status: "completed", approvalStatus: "approved" })).toBe("completed");
    expect(displayStatus({ status: "cancelled", approvalStatus: "approved" })).toBe("cancelled");
    expect(displayStatus({ status: "in_progress", approvalStatus: "pending" })).toBe("in_progress");
    expect(displayStatus({ status: "in_progress", approvalStatus: "rejected" })).toBe("in_progress");
    expect(displayStatus({ status: "open", approvalStatus: null })).toBe("open");
  });
});
