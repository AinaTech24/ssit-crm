/**
 * Expo push delivery.
 *
 * Sends a notification to a set of users' registered mobile devices via Expo's
 * push service (https://docs.expo.dev/push-notifications/sending-notifications/).
 * No SDK dependency — the HTTP API is a simple JSON POST. We:
 *   - look up the user's live device tokens (tenant-scoped, disabled ones skipped)
 *   - chunk to Expo's 100-message limit
 *   - on a `DeviceNotRegistered` ticket, stamp `devices.disabled_at` so we stop
 *     sending to a token the OS has invalidated (uninstall / token rotation)
 *
 * Called from the `send_push` workflow action, inside the run's tenant tx — the
 * `tx` is already RLS-scoped, so device reads/writes can't cross tenants.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CHUNK_SIZE = 100;

export type PushPayload = {
  title: string;
  body?: string;
  /** Arbitrary data delivered to the app; we use `{ url }` for tap deep-links. */
  data?: Record<string, unknown>;
};

type DeviceRow = { id: string; expo_push_token: string };

/** Live (non-disabled) device tokens for these users in the current tenant. */
async function devicesForUsers(
  tx: Tx,
  tenantId: string,
  userIds: string[]
): Promise<DeviceRow[]> {
  if (!userIds.length) return [];
  const res = await tx.execute(sql`
    SELECT id, expo_push_token
    FROM devices
    WHERE tenant_id = ${tenantId}
      AND disabled_at IS NULL
      AND user_id = ANY(${sql.raw(`ARRAY[${userIds.map((u) => `'${u.replace(/'/g, "''")}'`).join(",")}]::uuid[]`)})
  `);
  return res.rows as DeviceRow[];
}

/** Stamp tokens dead so future sends skip them. */
async function disableDevices(tx: Tx, tenantId: string, deviceIds: string[]) {
  if (!deviceIds.length) return;
  await tx.execute(sql`
    UPDATE devices SET disabled_at = now(), updated_at = now()
    WHERE tenant_id = ${tenantId}
      AND id = ANY(${sql.raw(`ARRAY[${deviceIds.map((d) => `'${d.replace(/'/g, "''")}'`).join(",")}]::uuid[]`)})
  `);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export type PushResult = { targeted: number; sent: number; disabled: number };

/**
 * Deliver `payload` to every live device owned by `userIds`. Returns counts;
 * never throws on a delivery failure (a dead token is normal, not an error) —
 * the workflow step should continue regardless.
 */
export async function sendPushToUsers(
  tx: Tx,
  tenantId: string,
  userIds: string[],
  payload: PushPayload
): Promise<PushResult> {
  const devices = await devicesForUsers(tx, tenantId, Array.from(new Set(userIds)));
  if (!devices.length) return { targeted: 0, sent: 0, disabled: 0 };

  let sent = 0;
  const deadDeviceIds: string[] = [];

  for (const group of chunk(devices, CHUNK_SIZE)) {
    const messages = group.map((d) => ({
      to: d.expo_push_token,
      title: payload.title,
      body: payload.body ?? "",
      data: payload.data ?? {},
      sound: "default",
    }));

    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(messages),
      });
      const json: any = await res.json().catch(() => ({}));
      const tickets: any[] = Array.isArray(json?.data) ? json.data : [];

      // Tickets come back in the same order as the messages we sent.
      group.forEach((device, i) => {
        const ticket = tickets[i];
        if (ticket?.status === "ok") {
          sent += 1;
        } else if (ticket?.details?.error === "DeviceNotRegistered") {
          deadDeviceIds.push(device.id);
        }
      });
    } catch {
      // Network blip — leave tokens alone; the next workflow run retries.
    }
  }

  await disableDevices(tx, tenantId, deadDeviceIds);
  return { targeted: devices.length, sent, disabled: deadDeviceIds.length };
}
