/**
 * GET /api/notifications/stream — live notification feed (Server-Sent Events).
 *
 * The bell used to poll every 90 seconds, so "you've been assigned a task"
 * could sit invisible for a minute and a half. That reads as notifications not
 * working, and it is the reason people refresh the page to check.
 *
 * Why SSE and not websockets or LISTEN/NOTIFY:
 *   - one-way server→client is all this needs, and SSE reconnects on its own
 *   - a websocket would need a second server and a new dependency
 *   - Postgres LISTEN/NOTIFY needs a dedicated connection HELD OPEN per viewer.
 *     On one box with a bounded pool, a few dozen open tabs would exhaust it and
 *     take the app down — a worse failure than a slow badge.
 *
 * So the server polls on the client's behalf, on a short interval, and writes a
 * frame ONLY when something actually changed. The client holds one connection
 * instead of issuing a request every 90s, and sees changes within seconds.
 */

import { NextRequest } from "next/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { notifications } from "@/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** How often the server re-checks. Fast enough to feel immediate. */
const TICK_MS = 4_000;
/** Comment frame so proxies and load balancers don't idle the stream out. */
const HEARTBEAT_MS = 25_000;
/** Hard cap on one connection. EventSource reconnects by itself, and this stops
 *  a forgotten tab holding a handle open for days. */
const MAX_LIFETIME_MS = 30 * 60 * 1000;

type Snapshot = { unread: number; latestId: string | null };

async function readSnapshot(tenantId: string, userId: string): Promise<Snapshot> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({
        unread: sql<number>`count(*) FILTER (WHERE ${notifications.readAt} IS NULL)::int`,
        latestId: sql<string | null>`(
          SELECT n2.id FROM notifications n2
           WHERE n2.user_id = ${userId}::uuid AND n2.archived_at IS NULL
           ORDER BY n2.created_at DESC LIMIT 1
        )`,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, tenantId),
          eq(notifications.userId, userId),
          isNull(notifications.archivedAt)
        )
      );
    return { unread: Number(row?.unread ?? 0), latestId: (row?.latestId as string | null) ?? null };
  });
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // Tell the browser how soon to come back if the connection drops.
      controller.enqueue(encoder.encode("retry: 5000\n\n"));

      let last: Snapshot | null = null;
      const tick = async () => {
        if (closed) return;
        try {
          const snap = await readSnapshot(session.tenantId, session.userId);
          // Only write when something moved — an idle bell costs one heartbeat
          // every 25s, not a frame every 4.
          if (!last || last.unread !== snap.unread || last.latestId !== snap.latestId) {
            last = snap;
            send("notifications", snap);
          }
        } catch {
          // A transient DB blip must not kill the stream; the next tick retries.
        }
      };

      await tick(); // prime immediately so the badge is right on connect

      const ticker = setInterval(() => void tick(), TICK_MS);
      const beat = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          } catch {
            closed = true;
          }
        }
      }, HEARTBEAT_MS);
      const lifetime = setTimeout(() => cleanup(), MAX_LIFETIME_MS);

      function cleanup() {
        if (closed) return;
        closed = true;
        clearInterval(ticker);
        clearInterval(beat);
        clearTimeout(lifetime);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }

      req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx buffers proxied responses by default, which would hold every
      // frame back until the buffer filled — i.e. no live updates at all.
      "X-Accel-Buffering": "no",
    },
  });
}
