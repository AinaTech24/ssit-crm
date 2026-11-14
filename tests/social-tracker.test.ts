import { describe, expect, it } from "vitest";
import { can } from "@/lib/auth/rbac";
import { PostFields, platformLabel, statusLabel, totalsOf, typeLabel } from "@/lib/social/tracker";

const good = {
  postDate: "2026-11-10",
  contentTitle: "Diwali greetings reel",
  contentType: "reel",
  platform: "instagram",
  status: "posted",
};

describe("Social Media Tracker fields", () => {
  it("accepts a full entry and defaults the numbers to 0", () => {
    const r = PostFields.parse(good);
    expect(r).toMatchObject({ views: 0, reach: 0, likes: 0, followersIncrease: 0, leads: 0, postLink: null });
  });

  it("takes numbers as typed in a form (strings), including an empty box as 0", () => {
    const r = PostFields.parse({ ...good, views: "1200", reach: "", likes: "85", followersIncrease: "-3", leads: "4" });
    expect(r).toMatchObject({ views: 1200, reach: 0, likes: 85, followersIncrease: -3, leads: 4 });
  });

  it("rejects a bad date, an empty title, an unknown platform and negative counts", () => {
    expect(PostFields.safeParse({ ...good, postDate: "10-11-2026" }).success).toBe(false);
    expect(PostFields.safeParse({ ...good, contentTitle: "   " }).success).toBe(false);
    expect(PostFields.safeParse({ ...good, platform: "myspace" }).success).toBe(false);
    expect(PostFields.safeParse({ ...good, views: -1 }).success).toBe(false);
    expect(PostFields.safeParse({ ...good, leads: 1.5 }).success).toBe(false);
  });

  it("only lets a web link through, so it is safe to render as a link", () => {
    expect(PostFields.parse({ ...good, postLink: "https://instagram.com/p/abc" }).postLink).toBe("https://instagram.com/p/abc");
    expect(PostFields.parse({ ...good, postLink: "" }).postLink).toBeNull();
    expect(PostFields.safeParse({ ...good, postLink: "javascript:alert(1)" }).success).toBe(false);
    expect(PostFields.safeParse({ ...good, postLink: "www.example.com" }).success).toBe(false);
  });

  it("an edit that sends only some fields leaves the others undefined (not zeroed)", () => {
    const r = PostFields.partial().parse({ likes: "90" });
    expect(r.likes).toBe(90);
    expect(r.views).toBeUndefined();
    expect(r.contentTitle).toBeUndefined();
  });

  it("labels", () => {
    expect(typeLabel("one_pager")).toBe("One pager");
    expect(platformLabel("x")).toBe("X (Twitter)");
    expect(statusLabel("posted")).toBe("Posted");
    expect(typeLabel("brand_new")).toBe("brand new");
  });

  it("adds a month up", () => {
    const t = totalsOf([
      { views: 100, reach: 80, likes: 10, followersIncrease: 5, leads: 1 },
      { views: 50, reach: 40, likes: 4, followersIncrease: -2, leads: 0 },
    ]);
    expect(t).toEqual({ posts: 2, views: 150, reach: 120, likes: 14, followersIncrease: 3, leads: 1 });
  });
});

describe("Social Media Tracker permissions", () => {
  it("marketing can view and edit; owner always can; RMs cannot", () => {
    expect(can(["marketing"], "social_tracker.view")).toBe(true);
    expect(can(["marketing"], "social_tracker.manage")).toBe(true);
    expect(can(["owner"], "social_tracker.manage")).toBe(true);
    expect(can(["rm"], "social_tracker.view")).toBe(false);
    expect(can(["rm"], "social_tracker.manage")).toBe(false);
  });

  it("the owner can hand edit to one person through their custom list", () => {
    expect(can(["rm"], "social_tracker.manage", ["task.view.assigned", "social_tracker.manage"])).toBe(true);
  });
});
