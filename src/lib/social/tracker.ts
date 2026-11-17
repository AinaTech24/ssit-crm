/**
 * Social Media Tracker — one row per piece of content the marketing team posts,
 * with how it performed.
 *
 * The lists below are what the form offers and what the API accepts. They are
 * stored as plain text, so adding an option here needs no migration.
 */

import { z } from "zod";
import { isIsoDate } from "@/lib/dhandho/schedule";

export const POST_TYPES = [
  { key: "post", label: "Post" },
  { key: "reel", label: "Reel" },
  { key: "video", label: "Video" },
  { key: "carousel", label: "Carousel" },
  { key: "story", label: "Story" },
  { key: "invite_image", label: "Invite image" },
  { key: "one_pager", label: "One pager" },
  { key: "newsletter", label: "Newsletter" },
  { key: "other", label: "Other" },
] as const;

export const PLATFORMS = [
  { key: "instagram", label: "Instagram" },
  { key: "facebook", label: "Facebook" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "youtube", label: "YouTube" },
  { key: "x", label: "X (Twitter)" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "other", label: "Other" },
] as const;

export const POST_STATUSES = [
  { key: "planned", label: "Planned" },
  { key: "scheduled", label: "Scheduled" },
  { key: "posted", label: "Posted" },
  { key: "cancelled", label: "Cancelled" },
] as const;

const keys = <T extends ReadonlyArray<{ key: string }>>(xs: T) => xs.map((x) => x.key) as [T[number]["key"], ...T[number]["key"][]];

const labelOf = (xs: ReadonlyArray<{ key: string; label: string }>, key: string | null | undefined) =>
  xs.find((x) => x.key === key)?.label ?? (key ? key.replace(/_/g, " ") : "");

export const typeLabel = (k: string | null | undefined) => labelOf(POST_TYPES, k);
export const platformLabel = (k: string | null | undefined) => labelOf(PLATFORMS, k);
export const statusLabel = (k: string | null | undefined) => labelOf(POST_STATUSES, k);

/** A count: a whole number, never negative, with a sane ceiling. Empty means 0. */
const count = z.coerce.number().int().min(0).max(2_000_000_000).default(0);

/** The fields of one entry, as the form and the API exchange them. */
export const PostFields = z.object({
  postDate: z.string().refine(isIsoDate, "Use a valid date"),
  contentTitle: z.string().trim().min(1, "Enter the content title").max(300),
  contentType: z.enum(keys(POST_TYPES)),
  platform: z.enum(keys(PLATFORMS)),
  status: z.enum(keys(POST_STATUSES)),
  /** A web link, or empty. Only http(s) is accepted so it is safe to render as a link. */
  postLink: z
    .string()
    .trim()
    .max(1000)
    .refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), "The post link must start with http:// or https://")
    .optional()
    .transform((v) => (v ? v : null)),
  views: count,
  reach: count,
  likes: count,
  /** Net new followers the post brought. A drop is allowed (negative). */
  followersIncrease: z.coerce.number().int().min(-2_000_000_000).max(2_000_000_000).default(0),
  leads: count,
});

export type PostInput = z.infer<typeof PostFields>;

/** Most entries one "Save" may add — the tracker's entry sheet takes several rows at once. */
export const MAX_ENTRIES_PER_SAVE = 50;

/**
 * Validate a batch row by row so the message can say WHICH row is wrong
 * ("Row 2: Enter the content title"). All-or-nothing: one bad row adds none.
 */
export function parseBatch(
  raw: unknown
): { ok: true; entries: PostInput[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "Add at least one entry." };
  if (raw.length > MAX_ENTRIES_PER_SAVE) {
    return { ok: false, error: `Add at most ${MAX_ENTRIES_PER_SAVE} entries at a time.` };
  }
  const entries: PostInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = PostFields.safeParse(raw[i]);
    if (!r.success) {
      const msg = r.error.issues[0]?.message ?? "Check the fields";
      return { ok: false, error: raw.length > 1 ? `Row ${i + 1}: ${msg}` : msg };
    }
    entries.push(r.data);
  }
  return { ok: true, entries };
}

// ── One entry per day ────────────────────────────────────────────────────────
// An ENTRY is a day's content: its date, title and type are fixed, and it holds one
// line per platform it went out on (stored as one row per platform sharing those
// three). A day may hold only ONE entry, and a platform appears once in it.

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

type DayRow = { contentTitle: string; contentType: string; platform: string };

/** Every row of one entry must carry the same date, title and type. */
export function sameEntryError(rows: Array<{ postDate: string; contentTitle: string; contentType: string }>): string | null {
  const first = rows[0];
  if (!first) return null;
  for (const r of rows) {
    if (r.postDate !== first.postDate || !sameText(r.contentTitle, first.contentTitle) || r.contentType !== first.contentType) {
      return "The date, content title and type are the same for every platform in an entry.";
    }
  }
  return null;
}

/** The same platform twice in one entry. */
export function duplicatePlatformError(rows: Array<{ platform: string }>): string | null {
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.platform)) return `${platformLabel(r.platform)} is in this entry twice - one line per platform.`;
    seen.add(r.platform);
  }
  return null;
}

/**
 * May `incoming` be saved onto a day that already holds `existing` (rows on that day
 * that are NOT being replaced)? One entry per day:
 *   - nothing there: fine;
 *   - the day's entry has the same title and type and `join` is true (adding more
 *     platforms to it): fine, as long as no platform repeats;
 *   - anything else: refused, with a message that says what to do.
 */
export function dayRuleError(existing: DayRow[], incoming: DayRow[], opts: { join: boolean; date: string }): string | null {
  if (existing.length === 0) return null;
  const head = existing[0];
  const same = incoming.every((r) => sameText(r.contentTitle, head.contentTitle) && r.contentType === head.contentType);
  if (!(opts.join && same)) {
    return `${opts.date} already has an entry ("${head.contentTitle}"). Only one entry can be created per day - open it and add the platform there, or pick another date.`;
  }
  return duplicatePlatformError([...existing, ...incoming]);
}

/** The numbers a row carries, for totals. */
export interface Metrics {
  views: number;
  reach: number;
  likes: number;
  followersIncrease: number;
  leads: number;
}

export function totalsOf(rows: Metrics[]): Metrics & { posts: number } {
  return rows.reduce<Metrics & { posts: number }>(
    (t, r) => ({
      posts: t.posts + 1,
      views: t.views + (r.views || 0),
      reach: t.reach + (r.reach || 0),
      likes: t.likes + (r.likes || 0),
      followersIncrease: t.followersIncrease + (r.followersIncrease || 0),
      leads: t.leads + (r.leads || 0),
    }),
    { posts: 0, views: 0, reach: 0, likes: 0, followersIncrease: 0, leads: 0 }
  );
}
