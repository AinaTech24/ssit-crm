import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST   /api/devices   Body: { expoPushToken, platform, deviceName?, appVersion? }
 *   Register (or refresh) the calling user's mobile device for push. UPSERTs on
 *   the push token so re-opening the app or an Expo token rotation updates the
 *   existing row instead of piling up duplicates. Also re-points a token at the
 *   current user if someone else previously signed in on the same device.
 *
 * DELETE /api/devices   Body: { expoPushToken }
 *   Unregister on logout so a signed-out phone stops receiving this user's pushes.
 *
 * Both require an authenticated session (Bearer token from the mobile app).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { devices, DEVICE_PLATFORMS } from "@/db/schema";

export const dynamic = "force-dynamic";

const RegisterBody = z.object({
  expoPushToken: z.string().min(10).max(255),
  platform: z.enum(DEVICE_PLATFORMS),
  deviceName: z.string().max(120).optional(),
  appVersion: z.string().max(40).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parse = RegisterBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "expoPushToken + platform required" }, { status: 400 });
    }
    const { expoPushToken, platform, deviceName, appVersion } = parse.data;

    await withTenant(session.tenantId, async (tx) => {
      await tx
        .insert(devices)
        .values({
          tenantId: session.tenantId,
          userId: session.userId,
          expoPushToken,
          platform,
          deviceName,
          appVersion,
        })
        .onConflictDoUpdate({
          // Matches the (tenant_id, expo_push_token) unique index.
          target: [devices.tenantId, devices.expoPushToken],
          set: {
            userId: session.userId,
            platform,
            deviceName,
            appVersion,
            // A re-registering token is alive again — clear any prior disable
            // and bump last-seen so stale-device pruning leaves it be.
            disabledAt: null,
            lastSeenAt: sql`now()`,
            updatedAt: sql`now()`,
          },
        });
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}

const UnregisterBody = z.object({ expoPushToken: z.string().min(10).max(255) });

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    const parse = UnregisterBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "expoPushToken required" }, { status: 400 });
    }

    await withTenant(session.tenantId, async (tx) => {
      // Scope the delete to the caller — a user can only drop their OWN device,
      // never evict another user's registration of the same physical phone.
      await tx
        .delete(devices)
        .where(
          and(
            eq(devices.expoPushToken, parse.data.expoPushToken),
            eq(devices.userId, session.userId)
          )
        );
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
