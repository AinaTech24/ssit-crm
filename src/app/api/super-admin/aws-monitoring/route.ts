/**
 * Equitywala Admin → AWS Monitoring. Returns a live snapshot of EC2 / RDS / S3 / IAM
 * metrics + app counts. Platform-admin only. Polled by the dashboard.
 */
import { handleApiError } from "@/lib/api/error-handler";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { getAwsSnapshot } from "@/lib/aws/monitoring";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    const snapshot = await getAwsSnapshot(session.userId);
    return NextResponse.json(snapshot);
  } catch (err) {
    return handleApiError(err);
  }
}
