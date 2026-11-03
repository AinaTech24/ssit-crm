/**
 * Marketing content requests — what is being made, and what it is for.
 *
 * Shared by the New task form, the task drawer and POST /api/tasks so the three
 * cannot drift. The stored value is `tasks.meta.contentKind` / `meta.eventKey` /
 * `meta.eventLabel` (no schema change).
 */

/** Every kind a stored task may carry. `carousel` is legacy: still readable, no longer offered. */
export const CONTENT_KIND_KEYS = [
  "invite_image",
  "video",
  "reel",
  "post",
  "one_pager",
  "newsletter",
  "other",
  "carousel",
] as const;

export type ContentKind = (typeof CONTENT_KIND_KEYS)[number];

/** What the New task form offers, in the order marketing asked for. */
export const CONTENT_KIND_OPTIONS: ReadonlyArray<{ key: ContentKind; label: string }> = [
  { key: "invite_image", label: "Invite image" },
  { key: "video", label: "Video" },
  { key: "reel", label: "Reel" },
  { key: "post", label: "Post" },
  { key: "one_pager", label: "One pager" },
  { key: "newsletter", label: "Newsletter" },
  { key: "other", label: "Other creative" },
];

const KIND_LABEL: Record<string, string> = {
  ...Object.fromEntries(CONTENT_KIND_OPTIONS.map((o) => [o.key, o.label])),
  carousel: "Carousel",
};

export function contentKindLabel(kind: string | null | undefined): string {
  if (!kind) return "";
  return KIND_LABEL[kind] ?? kind.replace(/_/g, " ");
}

/** The occasion a creative is made for. "other" lets the requester type their own. */
export const MARKETING_EVENT_OPTIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "masterclass", label: "Masterclass" },
  { key: "b2c", label: "B2C" },
  { key: "staff_training", label: "Staff training" },
  { key: "other", label: "Other" },
];

export const OTHER_EVENT_KEY = "other";

/**
 * The key + label to store for a picked event. For "Other" the typed text is the
 * label (falling back to "Other" so the drawer never shows an empty event).
 */
export function resolveMarketingEvent(
  eventKey: string,
  typedOther: string
): { eventKey: string; eventLabel: string } | null {
  if (!eventKey) return null;
  if (eventKey === OTHER_EVENT_KEY) {
    return { eventKey, eventLabel: typedOther.trim().slice(0, 200) || "Other" };
  }
  const hit = MARKETING_EVENT_OPTIONS.find((e) => e.key === eventKey);
  return hit ? { eventKey: hit.key, eventLabel: hit.label } : null;
}

/** Marketing creatives (videos, reels) are far bigger than ordinary task documents. */
export const MAX_TASK_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_MARKETING_ATTACHMENT_BYTES = 100 * 1024 * 1024;
