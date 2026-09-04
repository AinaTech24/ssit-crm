/**
 * "What's new" release notes (migration 0197).
 *
 * release_notes is PLATFORM-level — no tenant_id, no RLS, same convention as
 * platformSettings. Equitywala publishes an entry once and every firm sees it, so the
 * changelog can't drift per tenant.
 *
 * releaseNoteReads IS tenant-scoped (a read receipt belongs to a user inside a
 * firm) and drives the unread badge in the dashboard header.
 */

import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";

export const RELEASE_CATEGORIES = ["feature", "improvement", "fix", "compliance"] as const;

export const releaseNotes = pgTable(
  "release_notes",
  {
    id,
    /** Optional label shown as a chip, e.g. "Aug 2026". */
    version: text("version"),
    title: text("title").notNull(),
    /** Markdown — rendered with the same tiny renderer the copilot uses. */
    body: text("body").notNull(),
    category: text("category", { enum: RELEASE_CATEGORIES }).notNull().default("feature"),
    /** Which CRM area it touches, e.g. "Compliance". */
    module: text("module"),
    /** Deep-link so the reader can jump straight to the change. */
    href: text("href"),
    /** Null = draft; set = live for every tenant. */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    ...timestamps,
  },
  (t) => ({
    publishedIdx: index("release_notes_published_idx").on(t.publishedAt),
  })
);

export const releaseNoteReads = pgTable(
  "release_note_reads",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    userId: uuid("user_id").notNull(),
    releaseNoteId: uuid("release_note_id")
      .notNull()
      .references(() => releaseNotes.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("release_note_reads_unique").on(t.tenantId, t.userId, t.releaseNoteId),
  })
);
