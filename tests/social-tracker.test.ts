import { describe, expect, it } from "vitest";
import { can } from "@/lib/auth/rbac";
import { MAX_ENTRIES_PER_SAVE, PostFields, dayRuleError, entryKey, groupEntries, duplicateLineError, parseBatch, sameEntryError, platformLabel, statusLabel, totalsOf, typeLabel } from "@/lib/social/tracker";

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

describe("adding several entries at once", () => {
  const row = { postDate: "2026-11-10", contentTitle: "A", contentType: "post", platform: "instagram", status: "posted" };

  it("accepts a batch and defaults each row's numbers", () => {
    const r = parseBatch([row, { ...row, contentTitle: "B", platform: "linkedin", views: "50" }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.entries).toHaveLength(2);
      expect(r.entries[1]).toMatchObject({ platform: "linkedin", views: 50, leads: 0 });
    }
  });

  it("names the bad row and adds none when one row is wrong", () => {
    const r = parseBatch([row, { ...row, contentTitle: "  " }]);
    expect(r).toEqual({ ok: false, error: "Row 2: Enter the content title" });
  });

  it("does not prefix the row number for a single entry", () => {
    expect(parseBatch([{ ...row, contentTitle: "" }])).toEqual({ ok: false, error: "Enter the content title" });
  });

  it("rejects an empty batch and an oversized one", () => {
    expect(parseBatch([]).ok).toBe(false);
    expect(parseBatch(Array.from({ length: MAX_ENTRIES_PER_SAVE + 1 }, () => row)).ok).toBe(false);
    expect(parseBatch(Array.from({ length: MAX_ENTRIES_PER_SAVE }, () => row)).ok).toBe(true);
  });
});

describe("one entry per day", () => {
  const row = (title: string, platform: string, type = "reel") => ({ contentTitle: title, contentType: type, platform });
  const day = "17 Nov 2026";

  it("an empty day takes any entry", () => {
    expect(dayRuleError([], [row("A", "instagram")], { join: false, date: day })).toBeNull();
  });

  it("a day that has a different entry refuses a second one, and says what to do", () => {
    const msg = dayRuleError([row("Large cap", "instagram")], [row("Other post", "facebook")], { join: true, date: day });
    expect(msg).toMatch(/Only one entry can be created per day/);
    expect(msg).toContain("Large cap");
  });

  it("more posts may join the same entry (same title), each with its own type", () => {
    // Instagram Reel + Facebook Video + an Instagram Post, all one day's entry.
    expect(dayRuleError([row("Large cap", "instagram", "reel")], [row("large cap ", "facebook", "video")], { join: true, date: day })).toBeNull();
    expect(dayRuleError([row("Large cap", "instagram", "reel")], [row("Large cap", "instagram", "post")], { join: true, date: day })).toBeNull();
  });

  it("the same platform with the same type twice is refused", () => {
    expect(dayRuleError([row("Large cap", "instagram", "reel")], [row("Large cap", "instagram", "reel")], { join: true, date: day })).toMatch(/twice/);
  });

  it("when replacing an entry (join off) another entry on the target day is refused even if it looks the same", () => {
    expect(dayRuleError([row("Large cap", "instagram")], [row("Large cap", "facebook")], { join: false, date: day })).toMatch(/already has an entry/);
  });

  it("every post of an entry shares the date and title - the type may differ", () => {
    const a = { postDate: "2026-11-17", contentTitle: "T" };
    expect(sameEntryError([a, { ...a }])).toBeNull();
    expect(sameEntryError([a, { ...a, contentTitle: "t " }])).toBeNull();
    expect(sameEntryError([a, { ...a, contentTitle: "Other" }])).toMatch(/same for every platform/);
    expect(sameEntryError([a, { ...a, postDate: "2026-11-18" }])).toMatch(/same for every platform/);
  });

  it("a platform may repeat with a different type, but not with the same one", () => {
    expect(duplicateLineError([{ platform: "instagram", contentType: "reel" }, { platform: "facebook", contentType: "reel" }])).toBeNull();
    expect(duplicateLineError([{ platform: "instagram", contentType: "reel" }, { platform: "instagram", contentType: "post" }])).toBeNull();
    expect(duplicateLineError([{ platform: "instagram", contentType: "reel" }, { platform: "instagram", contentType: "reel" }])).toMatch(/Instagram Reel/);
  });
});

describe("grouping rows into entries", () => {
  const r = (id: string, date: string, title: string, platform: string, type = "reel") => ({
    id,
    postDate: date,
    contentTitle: title,
    contentType: type,
    platform,
  });

  it("shows one entry per day with every post it went out as, whatever each one's type", () => {
    const g = groupEntries([
      r("1", "2026-11-18", "Demo Task", "youtube", "reel"),
      r("2", "2026-11-18", "Demo Task", "facebook", "video"),
      r("3", "2026-11-17", "Large cap", "instagram"),
    ]);
    expect(g).toHaveLength(2);
    expect(g[0].lines.map((l) => `${l.platform}:${l.contentType}`)).toEqual(["youtube:reel", "facebook:video"]);
    expect(g[1].lines).toHaveLength(1);
  });

  it("keeps the order of the first row of each entry", () => {
    const g = groupEntries([r("1", "2026-11-18", "A", "x"), r("2", "2026-11-17", "B", "x"), r("3", "2026-11-18", "A", "youtube")]);
    expect(g.map((e) => e.contentTitle)).toEqual(["A", "B"]);
    expect(g[0].lines.map((l) => l.id)).toEqual(["1", "3"]);
  });

  it("matches the title without regard to case or stray spaces", () => {
    expect(entryKey(r("1", "2026-11-18", " Demo Task ", "x"))).toBe(entryKey(r("2", "2026-11-18", "demo task", "y")));
    expect(entryKey(r("1", "2026-11-18", "Demo", "x"))).not.toBe(entryKey(r("2", "2026-11-19", "Demo", "x")));
  });
});
