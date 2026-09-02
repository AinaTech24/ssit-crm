/**
 * SSIT Admin → AWS Monitoring (live tile). Real-time host metrics read from
 * /proc — CPU, memory, swap, disk, load, network rate, uptime. Lightweight
 * (no AWS calls), so the dashboard can poll it every second. Platform-admin only.
 */
import { handleApiError } from "@/lib/api/error-handler";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { getLiveSystem } from "@/lib/aws/live-system";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    const live = await getLiveSystem();
    return NextResponse.json(live);
  } catch (err) {
    return handleApiError(err);
  }
}
