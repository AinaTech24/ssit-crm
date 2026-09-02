import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { withTenant } from "@/db/client";
import { saveDailyTracker, loadDailyTracker, type FocusItem } from "@/lib/daily-tracker";

export const dynamic = "force-dynamic";

/**
 * GET /api/daily-tracker?date=YYYY-MM-DD
 * The Daily Job Tracker for the signed-in user: their saved reflection + focus
 * list, plus auto-derived task context (completed yesterday, carried-over,
 * due today, productivity %). Powers the mobile Daily Plan screen.
 */
export async function GET(req: Request) {
  const session = await requireSession();
  const url = new URL(req.url);
  const raw = url.searchParams.get("date") ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 10);
  const data = await withTenant(session.tenantId, async (tx) =>
    loadDailyTracker(tx as any, session.tenantId, session.userId, date)
  );
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const session = await requireSession();
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const date = String(body.date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Invalid date" }, { status: 400 });

  const todayFocus: FocusItem[] = Array.isArray(body.todayFocus)
    ? body.todayFocus
        .filter((f: any) => f && typeof f.text === "string" && f.text.trim())
        .slice(0, 50)
        .map((f: any) => ({
          text: String(f.text).slice(0, 500),
          taskId: f.taskId ? String(f.taskId) : undefined,
          done: !!f.done,
          forType: ["client", "lead", "other"].includes(f.forType) ? f.forType : undefined,
        }))
    : [];

  // A user only ever writes their OWN tracker (owners view others read-only).
  await withTenant(session.tenantId, async (tx) =>
    saveDailyTracker(tx as any, session.tenantId, session.userId, date, {
      keyLearning: String(body.keyLearning ?? "").slice(0, 4000),
      breakdown: String(body.breakdown ?? "").slice(0, 4000),
      breakthrough: String(body.breakthrough ?? "").slice(0, 4000),
      todayFocus,
    })
  );

  return NextResponse.json({ ok: true });
}
