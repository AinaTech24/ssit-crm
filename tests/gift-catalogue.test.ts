import { describe, it, expect } from "vitest";
import { GIFT_CATEGORIES, giftLabel, isValidGrade } from "@/lib/gifts/catalogue";

describe("gift catalogue", () => {
  it("has Books and Other, each with grades", () => {
    expect(GIFT_CATEGORIES).toContain("books");
    expect(GIFT_CATEGORIES).toContain("other");
    expect(isValidGrade("books", "AA")).toBe(true);
    expect(isValidGrade("other", "A")).toBe(true);
    expect(isValidGrade("cake", "AAA")).toBe(false);
  });
  it("labels Other with what was typed", () => {
    expect(giftLabel("other", "A", "Pen set")).toBe("Other (Pen set) · A");
    expect(giftLabel("other", "A", "  ")).toBe("Other · A");
    expect(giftLabel("books", "AA")).toBe("Books · AA");
    expect(giftLabel("hamper", "A", "ignored")).toBe("Hamper · A");
  });
});
