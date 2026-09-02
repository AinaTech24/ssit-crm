import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { pollRtaInboxOnce } from "@/workers/rta-inbox-poller";
import { enforce } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/rta/sync-mailbox
 *
 * Triggers an immediate on-demand check of the RTA mailback catch-all mailbox.
 * Downloads new CAMS/KFintech mailback attachments, decrypts with firm passwords,
 * and enqueues import jobs.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // `requireAny` takes CAPABILITIES, not role names. Gate on the same
    // capability as the manual RTA upload and the mailback settings API
    // (owner + back-office/ops + RM) so the three stay in step.
    requireAny(session.roles, ["transactions.execute"], session.permissions);

    // Limit manual syncs to 12 per hour per user
    const limited = enforce(req, "rta.sync_mailbox", { limit: 12, windowSec: 3600 }, session.userId);
    if (limited) return limited;

    const result = await pollRtaInboxOnce();

    if (result.error) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error,
          configured: result.configured,
        },
        { status: result.configured ? 502 : 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      processed: result.processed,
      message:
        result.processed > 0
          ? `Successfully processed ${result.processed} mailback email(s) and queued file imports.`
          : "Mailbox checked: No new unread RTA mailback emails found.",
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
