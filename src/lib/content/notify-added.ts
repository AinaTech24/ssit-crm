/**
 * Tell the team when somebody adds to the Content Library.
 *
 * Whoever uploads - the marketing person today, anyone the firm grants the
 * "content_library.add" capability tomorrow - triggers this from the add route, so it
 * follows the permission, not a role: grant it to a person and their uploads notify
 * everyone the same way.
 *
 * Everyone active in the firm hears about it (owner, RIA, branch heads, RMs, the lot),
 * except the person who added it: an in-app notification for each, and an email to each
 * from the firm's own mailbox. Email is best-effort and runs AFTER the upload has been
 * saved - a mail problem never fails the upload.
 */

import { sql } from "drizzle-orm";
import { createNotification } from "@/lib/notifications/create";
import { sendSystemEmail } from "@/lib/comms/system-email";

export type ContentRecipient = { id: string; name: string | null; email: string | null };

export type ContentAdded = {
  title: string;
  /** Asset type key, e.g. "image" | "video" | "pdf". */
  type: string;
  category: string;
  addedByName: string;
  /** The app's origin, for the link in the email. */
  origin: string;
};

const label = (k: string) => (k ?? "").replace(/_/g, " ").trim();
const esc = (s: string) => (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** The words used in the in-app notification and the email. Pure, so it is testable. */
export function contentAddedMessage(a: ContentAdded) {
  const what = [label(a.type), a.category && a.category !== "general" ? `in ${label(a.category)}` : ""].filter(Boolean).join(" ");
  const url = `${a.origin.replace(/\/+$/, "")}/dashboard/content-library`;
  const title = `New in the Content Library: ${a.title}`;
  const body = `${a.addedByName} added ${what ? `a ${what}` : "a new item"}.`;
  return {
    title,
    body,
    url,
    subject: `New content added to the Content Library - ${a.title}`,
    text: `${body}\n\n${a.title}\n\nOpen the Content Library: ${url}`,
    html:
      `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#0f172a">` +
      `<p style="font-size:15px;margin:0 0 12px"><strong>${esc(a.addedByName)}</strong> added ${what ? `a ${esc(what)}` : "a new item"} to the Content Library.</p>` +
      `<p style="font-size:16px;margin:0 0 16px"><strong>${esc(a.title)}</strong></p>` +
      `<p style="margin:0"><a href="${esc(url)}" style="background:#841f21;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block;font-weight:600">Open the Content Library</a></p>` +
      `</div>`,
  };
}

/**
 * Create the in-app notifications (inside the caller's tenant transaction) and
 * return who should also get an email.
 */
export async function notifyContentAdded(
  tx: any,
  a: ContentAdded & { tenantId: string; assetId: string; addedByUserId: string }
): Promise<ContentRecipient[]> {
  const r = await tx.execute(sql`
    SELECT id, name, email FROM users
     WHERE tenant_id = ${a.tenantId}::uuid
       AND status = 'active'
       AND deleted_at IS NULL
       AND id <> ${a.addedByUserId}::uuid
       AND NOT (roles <@ ARRAY['investor', 'platform_admin']::text[])
  `);
  const recipients = r.rows as ContentRecipient[];
  const m = contentAddedMessage(a);
  for (const u of recipients) {
    await createNotification(tx, {
      tenantId: a.tenantId,
      userId: String(u.id),
      kind: "content_library.added",
      title: m.title,
      body: m.body,
      linkUrl: "/dashboard/content-library",
      severity: "info",
      meta: { assetId: a.assetId, by: a.addedByUserId },
    });
  }
  return recipients;
}

/** Email each recipient. Never throws; run it after the upload has been committed. */
export async function emailContentAdded(
  tenantId: string,
  assetId: string,
  recipients: ContentRecipient[],
  a: ContentAdded
): Promise<{ sent: number; failed: number }> {
  const m = contentAddedMessage(a);
  let sent = 0;
  let failed = 0;
  for (const u of recipients) {
    if (!u.email) continue;
    try {
      const res = await sendSystemEmail({
        tenantId,
        to: u.email,
        subject: m.subject,
        text: m.text,
        html: m.html,
        identity: "firm",
        idempotencyKey: `content-added:${assetId}:${u.id}`,
      });
      if (res.sent) sent += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }
  if (failed) console.warn(`[content-library] ${failed} of ${sent + failed} "new content" emails were not sent`);
  return { sent, failed };
}
