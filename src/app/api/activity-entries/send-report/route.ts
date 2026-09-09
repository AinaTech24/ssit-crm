import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/activity-entries/send-report
 *
 * "Send report": an RIA / research user picks an RM, attaches files, and mails
 * them the work. Multipart, because the whole point is the attachments.
 *
 * Fields: rmUserId, subject, message, files[] (repeated)
 *
 * The recipient is resolved from the RM's user record rather than taken from
 * the request, so this cannot be turned into a way to mail an arbitrary
 * address from the firm's mailbox.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { users } from "@/db/schema";
import { sendSystemEmail } from "@/lib/comms/system-email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 10;

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // Anyone who can send a client communication can send an internal report.
    requireAny(session.roles, ["communication.send"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);

    const form = await req.formData().catch(() => null);
    const rmUserId = String(form?.get("rmUserId") ?? "").trim();
    const subject = String(form?.get("subject") ?? "").trim();
    const message = String(form?.get("message") ?? "").trim();
    if (!rmUserId) return NextResponse.json({ error: "Choose an RM to send to." }, { status: 400 });
    if (!subject) return NextResponse.json({ error: "Give the report a subject." }, { status: 400 });

    const picked = (form?.getAll("files") ?? []).filter(
      (v): v is File => typeof v !== "string" && v != null
    );
    if (picked.length > MAX_FILES) {
      return NextResponse.json({ error: `At most ${MAX_FILES} files per report.` }, { status: 400 });
    }
    const tooBig = picked.find((f) => f.size > MAX_BYTES);
    if (tooBig) {
      return NextResponse.json({ error: `"${tooBig.name}" exceeds 25 MB.` }, { status: 400 });
    }

    // Resolve the recipient in-tenant. An id for someone in another firm simply
    // does not resolve, so RLS + this lookup are the whole guard.
    const rm = await withTenant(session.tenantId, async (tx) => {
      const [u] = await tx
        .select({ id: users.id, name: users.name, email: users.email, status: users.status })
        .from(users)
        .where(and(eq(users.id, rmUserId), eq(users.tenantId, session.tenantId)))
        .limit(1);
      return u ?? null;
    });
    if (!rm?.email) {
      return NextResponse.json({ error: "That RM has no email address on file." }, { status: 404 });
    }
    if (rm.status !== "active") {
      return NextResponse.json({ error: "That RM's account is not active." }, { status: 409 });
    }

    const attachments = await Promise.all(
      picked.map(async (f) => ({
        filename: (f.name || "attachment").replace(/[^\w.\- ]+/g, "_").slice(0, 180),
        content: Buffer.from(await f.arrayBuffer()),
      }))
    );

    const body =
      `${message || "Please find the attached report."}\n\n` +
      `— ${session.name ?? session.email}\n` +
      (attachments.length
        ? `\nAttached: ${attachments.map((a) => a.filename).join(", ")}\n`
        : "\n(No files attached.)\n");

    const result = await sendSystemEmail({
      tenantId: session.tenantId,
      to: rm.email,
      subject,
      text: body,
      attachments,
    });

    if (!result.sent) {
      // The mailbox is the usual cause. Say so rather than a bare failure —
      // the sender can do something about "no mailbox configured".
      return NextResponse.json(
        {
          error:
            result.reason === "email_not_configured"
              ? "No mailbox is configured for your firm, so the report could not be sent. Ask your admin to connect one under Settings → Email."
              : "The report could not be sent. Try again, or check the mailbox settings.",
        },
        { status: 502 }
      );
    }

    await withTenant(session.tenantId, async (tx) => {
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "activity.report.send",
        entityType: "user",
        entityId: rm.id,
        after: { to: rm.email, subject, files: attachments.length },
        ...clientMeta,
      });
    });

    return NextResponse.json({ ok: true, to: rm.name ?? rm.email, files: attachments.length });
  } catch (err: any) {
    return handleApiError(err);
  }
}
