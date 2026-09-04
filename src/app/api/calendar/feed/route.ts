import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { withSystem, withTenant } from "@/db/client";
import { users } from "@/db/schema";
import { can } from "@/lib/auth/rbac";
import { getCalendarItems } from "@/lib/calendar/items";

export const dynamic = "force-dynamic";

const pad = (n: number) => String(n).padStart(2, "0");

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const userId = sp.get("userId");
    const token = sp.get("token");

    if (!userId || !token) {
      return new NextResponse("Bad Request: missing params", { status: 400 });
    }

    // Fail closed: this feed is auth-bearing, so refuse to verify against a
    // public default secret. Without a configured secret, no token is valid.
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) {
      return new NextResponse("Calendar feed not configured", { status: 503 });
    }

    const expectedSignature = crypto.createHmac("sha256", secret).update(userId).digest("hex");
    // Constant-time comparison — avoid leaking the signature via timing.
    const a = Buffer.from(token);
    const b = Buffer.from(expectedSignature);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const user = await withSystem(async (tx) => {
      return (await tx.select().from(users).where(eq(users.id, userId)).limit(1))[0];
    });
    if (!user) {
      return new NextResponse("User not found", { status: 404 });
    }

    // Rolling window: start of this month through ~4 months out (UTC-safe).
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth(); // 0-based
    const fromIso = `${y}-${pad(m + 1)}-01`;
    const toIso = new Date(Date.UTC(y, m + 4, 0)).toISOString().slice(0, 10);

    const roles = (user.roles as string[] | null) ?? [];
    const perms = (user as any).permissions ?? null;

    const items = await withTenant(user.tenantId, async (tx) =>
      getCalendarItems(tx, {
        fromIso,
        toIso,
        scope: {
          userId: user.id,
          tasksAll: can(roles, "task.view.all", perms),
          leadsAll: can(roles, "lead.view.all", perms),
          investorsAll: can(roles, "investor.view.all", perms),
        },
      })
    );

    const clean = (str: string) => str.replace(/[\n\r]/g, " ").replace(/[,;]/g, "\\$&");
    const icalDateTime = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    const icalDate = (ymd: string) => ymd.replace(/-/g, "");
    const nextDay = (ymd: string) => {
      const d = new Date(`${ymd}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10).replace(/-/g, "");
    };
    const stampStr = icalDateTime(new Date());

    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Equitywala//EquitywalaCRM//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
    ];

    for (const item of items) {
      if (!item.date && !item.at) continue;
      ics.push("BEGIN:VEVENT");
      // Stable UID (source row id) so calendar clients UPDATE events on refresh
      // instead of duplicating them.
      ics.push(`UID:${item.id}@ssitcrm.com`);
      ics.push(`DTSTAMP:${stampStr}`);
      if (item.at) {
        // Timed event (task due time, campaign send time).
        const start = new Date(item.at);
        ics.push(`DTSTART:${icalDateTime(start)}`);
        ics.push(`DTEND:${icalDateTime(new Date(start.getTime() + 60 * 60 * 1000))}`);
      } else {
        // All-day event (reviews, follow-ups, expiries) — no spurious clock time.
        ics.push(`DTSTART;VALUE=DATE:${icalDate(item.date)}`);
        ics.push(`DTEND;VALUE=DATE:${nextDay(item.date)}`);
      }
      ics.push(`SUMMARY:[${item.kind.toUpperCase()}] ${clean(item.title)}`);
      if (item.description) ics.push(`DESCRIPTION:${clean(item.description)}`);
      ics.push("END:VEVENT");
    }

    ics.push("END:VCALENDAR");

    return new NextResponse(ics.join("\r\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="ssitcrm-feed.ics"`,
        // Calendar clients poll often; let them cache briefly.
        "Cache-Control": "private, max-age=900",
      },
    });
  } catch {
    // Don't leak internals to an unauthenticated feed consumer.
    return new NextResponse("Error generating calendar feed", { status: 500 });
  }
}
