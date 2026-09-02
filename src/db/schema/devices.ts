/**
 * Devices — registered mobile push targets.
 *
 * One row per (user, physical device). Holds the Expo push token the workflow
 * engine's `send_push` action delivers to. Tenant-scoped like every domain
 * table so RLS keeps one firm's tokens invisible to another.
 *
 * The push token is the natural key: Expo can rotate it, and the same person
 * may sign in on a new phone, so registration UPSERTs on `expo_push_token` and
 * re-points it at the current user. A token that stops delivering (Expo returns
 * DeviceNotRegistered) gets `disabled_at` stamped so we stop sending to it.
 */

import { index, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

export const DEVICE_PLATFORMS = ["ios", "android"] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export const devices = pgTable(
  "devices",
  {
    id,
    tenantId,
    /** Owning user (the RM/ops/owner signed in on this device). */
    userId: uuid("user_id").notNull(),

    /** Expo push token — the delivery address. Globally unique per device. */
    expoPushToken: text("expo_push_token").notNull(),

    platform: text("platform", { enum: DEVICE_PLATFORMS }).notNull(),
    /** Human label for the settings "your devices" list ("Pixel 8", "iPhone 15"). */
    deviceName: text("device_name"),
    /** App build for debugging delivery issues across versions. */
    appVersion: text("app_version"),

    /** Touched on every app open / token refresh — lets us prune stale devices. */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    /** Stamped when Expo reports the token is dead (DeviceNotRegistered). */
    disabledAt: timestamp("disabled_at", { withTimezone: true }),

    ...timestamps,
  },
  (t) => ({
    // Tenant-scoped unique (not global) so registration can UPSERT inside the
    // tenant under RLS. A globally-unique token would let the conflict row live
    // in another tenant — invisible to the policy — and ON CONFLICT DO UPDATE
    // would then error. Same physical device re-used across firms simply gets
    // one row per tenant; the send path targets by (tenant, user) so they never
    // cross-deliver, and dead rows self-heal on the first DeviceNotRegistered.
    tokenUnique: uniqueIndex("devices_token_unique").on(t.tenantId, t.expoPushToken),
    userIdx: index("devices_user_idx").on(t.tenantId, t.userId),
  })
);

export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
