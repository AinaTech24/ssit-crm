import { withTenant } from "@/db/client";
import { resolveEmailSender } from "@/lib/comms/sender";
import { emailAdapter } from "@/lib/comms/adapters/resend";

export type StaffEmailJob = { email: string | null; subject: string; text: string; key: string };

/**
 * Best-effort internal email to staff (task overdue / reminder). Resolves the
 * firm's email sender once, then sends each job. Never throws and no-ops when
 * the tenant has no email configured — the in-app notification is the guaranteed
 * channel; email is an enhancement.
 */
export async function sendStaffEmails(tenantId: string, jobs: StaffEmailJob[]): Promise<void> {
  const valid = jobs.filter((j) => j.email);
  if (!valid.length) return;
  let sender: any = null;
  try {
    sender = await withTenant(tenantId, (tx) => resolveEmailSender(tx, tenantId, null));
  } catch {
    return;
  }
  if (!sender || (!sender.apiKey && !sender.smtp)) return; // email not configured
  for (const j of valid) {
    try {
      await emailAdapter.send({
        tenantId,
        tokens: {},
        rendered: { subject: j.subject, text: j.text, tokens: {} },
        recipient: j.email as string,
        category: "transactional",
        idempotencyKey: j.key,
        smtp: sender.smtp,
        apiKey: sender.apiKey,
        fromOverride: sender.fromEmail || undefined,
        fromNameOverride: sender.fromName || undefined,
        replyTo: sender.replyTo || undefined,
      } as any);
    } catch {
      /* best-effort — a failed email never fails the sweep */
    }
  }
}
