/**
 * The gift catalogue.
 *
 * Shared by the engagement form, the engagement API and the reporting queries
 * so the three can never disagree about what a valid gift is. Grades differ per
 * category on purpose — a cake has no AAA tier.
 */

export const GIFT_CATEGORIES = ["hamper", "cake", "plant"] as const;
export type GiftCategory = (typeof GIFT_CATEGORIES)[number];

export const GIFT_GRADES_BY_CATEGORY: Record<GiftCategory, readonly string[]> = {
  hamper: ["A", "AA", "AAA"],
  cake: ["A", "AA"],
  plant: ["A", "AA", "AAA"],
};

export const GIFT_CATEGORY_LABEL: Record<GiftCategory, string> = {
  hamper: "Hamper",
  cake: "Cake",
  plant: "Plant",
};

export function isGiftCategory(v: unknown): v is GiftCategory {
  return typeof v === "string" && (GIFT_CATEGORIES as readonly string[]).includes(v);
}

/** Grade valid for the category? An absent grade is allowed (older rows). */
export function isValidGrade(category: string | null | undefined, grade: string | null | undefined): boolean {
  if (!grade) return true;
  if (!isGiftCategory(category)) return false;
  return GIFT_GRADES_BY_CATEGORY[category].includes(grade);
}

/** "Hamper · AA" — one label for tables and calendar cells. */
export function giftLabel(category: string | null | undefined, grade: string | null | undefined): string {
  const cat = isGiftCategory(category) ? GIFT_CATEGORY_LABEL[category] : (category ?? "Gift");
  return grade ? `${cat} · ${grade}` : cat;
}
