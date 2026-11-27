import { describe, it, expect } from "vitest";
import { TASK_BUCKETS, activeBucket, bucketStatuses, parseBucket } from "@/lib/tasks/buckets";

describe("task list status buttons", () => {
  it("opens on Open, which holds everything still to be done", () => {
    expect(parseBucket(undefined)).toBe("open");
    expect(parseBucket("nonsense")).toBe("open");
    expect(bucketStatuses("open")).toEqual(["open", "in_progress", "blocked"]);
  });
  it("puts every status under exactly one button, besides All", () => {
    const listed = TASK_BUCKETS.flatMap((b) => b.statuses ?? []).sort();
    expect(listed).toEqual(["blocked", "cancelled", "completed", "in_progress", "open"]);
    expect(bucketStatuses("all")).toBeNull();
  });
  it("lights the button that matches a Status filter, and none for a mix or an approval view", () => {
    expect(activeBucket(undefined, ["completed"], "")).toBe("completed");
    expect(activeBucket("completed", ["open"], "")).toBe("open");
    expect(activeBucket(undefined, ["open", "completed"], "")).toBeNull();
    expect(activeBucket(undefined, [], "mine")).toBeNull();
    expect(activeBucket("closed", [], "")).toBe("closed");
  });
});
