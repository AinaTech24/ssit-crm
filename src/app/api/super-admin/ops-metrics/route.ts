/**
 * Equitywala Admin → AWS Monitoring (ops tile). App-level operational metrics — user
 * activity, email, background jobs, security, audit feed, Node process health,
 * tenant analytics. Platform-admin only. Polled alongside the CloudWatch snapshot.
 */
import { handleApiError } from "@/lib/api/error-handler";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { getOpsMetrics } from "@/lib/aws/ops-metrics";
import { loadEmailConfig } from "@/lib/comms/email-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 25;

export async function GET() {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    const cfg = await loadEmailConfig().catch(() => null);
    const metrics = await getOpsMetrics(session.userId, !!cfg?.configured);
    return NextResponse.json(metrics);
  } catch (err) {
    return handleApiError(err);
  }
}
