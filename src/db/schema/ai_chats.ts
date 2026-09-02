/**
 * AI Assistant chat persistence — per-user conversations with the CRM assistant.
 * `aiChats` is one conversation; `aiChatMessages` are its turns. Tenant-scoped
 * (RLS) and owned by a single user. See migration 0177.
 */

import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

export const aiChats = pgTable(
  "ai_chats",
  {
    id,
    tenantId,
    userId: uuid("user_id").notNull(),
    title: text("title").notNull().default("New chat"),
    /** Tier used for the last turn: "fast" | "reasoning". */
    model: text("model").notNull().default("reasoning"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    userIdx: index("ai_chats_user_idx").on(t.tenantId, t.userId, t.archivedAt, t.lastMessageAt),
  })
);

export const aiChatMessages = pgTable(
  "ai_chat_messages",
  {
    id,
    tenantId,
    chatId: uuid("chat_id").notNull(),
    /** "user" | "assistant". */
    role: text("role").notNull(),
    /** Markdown body. */
    content: text("content").notNull(),
    /** Live-data snapshot the assistant grounded this reply on (assistant turns). */
    metrics: jsonb("metrics").$type<Record<string, any> | null>(),
    /** Tier used for an assistant turn. */
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    chatIdx: index("ai_chat_messages_chat_idx").on(t.tenantId, t.chatId, t.createdAt),
  })
);

export type AiChat = typeof aiChats.$inferSelect;
export type AiChatMessage = typeof aiChatMessages.$inferSelect;
