/**
 * GET /api/diagnostics/storage          — non-secret storage config snapshot
 * GET /api/diagnostics/storage?test=1   — live round-trip test (owner only)
 *
 * Lets you confirm, from the browser, whether the *running server* actually sees
 * your S3 credentials and can write to the bucket — instead of guessing why
 * files keep landing on local disk (/api/upload-local/...). The ?test=1 form
 * PUTs a tiny object, reads it back, and deletes it, reporting the exact AWS
 * error (AccessDenied / NoSuchBucket / wrong region) when it fails.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { storageStatus, isS3Configured, putObject, getObjectBytes, deleteObject } from "@/lib/storage/s3";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    // Reading the (non-secret) status is allowed for anyone who can upload, so
    // the upload-page badge works for every RM. The live write test is owner-gated.
    requireCap(session.roles, "document.upload", session.permissions);

    const status = storageStatus();
    const wantsTest = new URL(req.url).searchParams.get("test") === "1";
    if (!wantsTest) {
      return NextResponse.json({ ...status, hint: hintFor(status) });
    }

    // Live round-trip — restricted to admins (writes a throwaway object).
    requireCap(session.roles, "settings.security", session.permissions);

    const key = `tenants/${session.tenantId}/general/_diag-storage-check.txt`;
    const stamp = `storage-check ${session.tenantId}`;
    const test: { step: string; ok: boolean; error?: string } = { step: "start", ok: false };
    try {
      test.step = "put";
      await putObject(key, Buffer.from(stamp, "utf8"), "text/plain");
      test.step = "get";
      const back = await getObjectBytes(key);
      const roundTripped = back.toString("utf8") === stamp;
      test.step = "delete";
      await deleteObject(key);
      test.ok = roundTripped;
      if (!roundTripped) test.error = "object read back did not match what was written";
    } catch (e: any) {
      test.ok = false;
      test.error = e?.Code || e?.name || e?.message || "unknown error";
    }

    return NextResponse.json({
      ...status,
      hint: hintFor(status),
      test: {
        ...test,
        target: isS3Configured() ? `s3://${status.bucket}/${key}` : `local:node-local/uploads/${key}`,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

function hintFor(s: ReturnType<typeof storageStatus>): string {
  if (s.configured) {
    return `Uploads go to S3 bucket "${s.bucket}" (${s.region}). Run ?test=1 to verify the key can actually write.`;
  }
  return "No S3 credentials visible to the server — uploads are saved to local disk (/api/upload-local/...). Set S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET and S3_REGION in the server's .env, then restart/redeploy.";
}
