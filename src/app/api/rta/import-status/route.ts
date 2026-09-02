import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/rta/import-status?jobId=…
 *
 * Polled by the rich importer after enqueuing. Returns the BullMQ job state and,
 * once complete, the import summary (the worker's return value). Tenant-scoped:
 * a job's result is only returned to the tenant that created it.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Q } from "@/workers/queues";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const allowed =
      can(session.roles, "investor.edit.all", session.permissions) ||
      can(session.roles, "dashboard.view.owner", session.permissions);
    if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const jobId = req.nextUrl.searchParams.get("jobId");
    if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

    const job = await Q.rtaImport().getJob(jobId);
    if (!job) return NextResponse.json({ state: "unknown" });
    // Don't leak another tenant's import across a guessed job id.
    if ((job.data as any)?.tenantId !== session.tenantId) {
      return NextResponse.json({ state: "unknown" });
    }

    const state = await job.getState();
    if (state === "completed") {
      return NextResponse.json({ state, result: job.returnvalue ?? null });
    }
    if (state === "failed") {
      return NextResponse.json({ state, error: job.failedReason ?? "import failed" });
    }
    // waiting | active | delayed | … — include live progress (phase + pct + counts)
    // so the UI can render a bar + ETA instead of an indeterminate spinner.
    return NextResponse.json({ state, progress: job.progress ?? null });
  } catch (err: any) {
    return handleApiError(err);
  }
}
