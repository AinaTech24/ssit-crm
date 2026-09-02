/**
 * Best-effort usage logging for content-library assets. Never throws — analytics
 * must not break the co-brand / download / send it's measuring.
 */

import { withTenant } from "@/db/client";
import { contentLibraryEvents } from "@/db/schema";

export async function recordContentEvent(opts: {
  assetId: string;
  tenantId: string;
  userId?: string | null;
  eventType: "view" | "cobrand" | "download" | "send";
  channel?: string | null;
}): Promise<void> {
  try {
    await withTenant(opts.tenantId, async (tx) => {
      await tx.insert(contentLibraryEvents).values({
        assetId: opts.assetId,
        tenantId: opts.tenantId,
        userId: opts.userId ?? null,
        eventType: opts.eventType,
        channel: opts.channel ?? null,
      } as any);
    });
  } catch {
    /* analytics is best-effort */
  }
}
