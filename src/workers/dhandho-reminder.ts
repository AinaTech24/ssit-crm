/**
 * Dhandho reminder.
 *
 * Every minute, for each active firm: if today has a speaker on the rota and the
 * reminder window is open (REMINDER_LEAD_MIN before the start, up to
 * REMINDER_GRACE_MIN after), tell every active member who today's speaker is —
 * an in-app notification (which the bell and the pop-ups show) plus an email —
 * and give the speaker their own "you speak today" version.
 *
 * Send-once: the session row is CLAIMED with an atomic
 * `UPDATE … SET reminded_at = now() WHERE reminded_at IS NULL RETURNING`, so two
 * servers (blue/green) or a restart can never send the same day twice. Emails are
 * best-effort and go out after the notifications are committed.
 */

import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { createNotification } from "@/lib/notifications/create";
import { sendStaffEmails, type StaffEmailJob } from "@/lib/tasks/staff-email";
import { istDate, meetingTimeLabel, reminderDue } from "@/lib/dhandho/schedule";

const LINK = "/dashboard/dhandho";

async function listActiveTenants(): Promise<string[]> {
  return withSystem(async (tx) => {
    const r = await tx.execute(sql`SELECT id FROM tenants WHERE status IN ('active', 'trial')`);
    return (r.rows as Array<{ id: string }>).map((row) => row.id);
  });
}

/** Send today's reminder for one firm. Returns how many members were told. */
export async function remindTenant(tenantId: string, now: Date = new Date()): Promise<number> {
  const today = istDate(now);
  if (!reminderDue(today, now)) return 0;
  const time = meetingTimeLabel(today) ?? "10:00 am";

  const emailJobs: StaffEmailJob[] = [];
  const told = await withTenant(tenantId, async (tx) => {
    // Claim today's session — only one worker gets the row back.
    const claimed = await tx.execute(sql`
      UPDATE dhandho_sessions
         SET reminded_at = now()
       WHERE tenant_id = ${tenantId}::uuid
         AND session_date = ${today}::date
         AND reminded_at IS NULL
         AND off_reason IS NULL
      RETURNING speaker_user_id, speaker_name, topic
    `);
    const s = claimed.rows[0] as { speaker_user_id: string | null; speaker_name: string; topic: string | null } | undefined;
    if (!s) return 0;

    const people = (
      await tx.execute(sql`
        SELECT id, name, email FROM users
         WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
      `)
    ).rows as Array<{ id: string; name: string | null; email: string | null }>;

    const topicSentence = s.topic ? ` Topic: ${s.topic}.` : "";
    const topicLine = s.topic ? `\nTopic: ${s.topic}` : "";
    for (const p of people) {
      const isSpeaker = !!s.speaker_user_id && p.id === s.speaker_user_id;
      const title = isSpeaker ? "You are today's Dhandho speaker" : `Today's Dhandho speaker: ${s.speaker_name}`;
      const body = isSpeaker
        ? `Dhandho is at ${time}. You are speaking today — please be ready.${topicSentence}`
        : `Dhandho is at ${time}. ${s.speaker_name} is speaking today.${topicSentence}`;
      await createNotification(tx, {
        tenantId,
        userId: p.id,
        kind: "dhandho.speaker",
        title,
        body,
        linkUrl: LINK,
        severity: isSpeaker ? "warning" : "info",
        meta: { sessionDate: today },
      });
      emailJobs.push({
        email: p.email,
        subject: isSpeaker ? `You are today's Dhandho speaker (${time})` : `Today's Dhandho speaker: ${s.speaker_name} (${time})`,
        text: isSpeaker
          ? `Hi ${p.name ?? ""},\n\nYou are the Dhandho speaker today.\nTime: ${time}${topicLine}\n\nPlease be ready a few minutes early.`
          : `Hi ${p.name ?? ""},\n\nToday's Dhandho speaker: ${s.speaker_name}\nTime: ${time}${topicLine}\n\nSee you there.`,
        key: `dhandho:${tenantId}:${today}:${p.id}`,
      });
    }
    return people.length;
  });

  if (emailJobs.length) {
    try {
      await sendStaffEmails(tenantId, emailJobs);
    } catch (err) {
      console.error(`[dhandho] email send failed for tenant ${tenantId}:`, (err as Error).message);
    }
  }
  return told;
}

export function startDhandhoReminderWorker() {
  const interval = Number(process.env.DHANDHO_SCAN_INTERVAL_MS ?? 60_000);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      // Cheap exit outside the reminder window — no database work on most ticks.
      if (!reminderDue(istDate())) return;
      for (const t of await listActiveTenants()) {
        try {
          const n = await remindTenant(t);
          if (n) console.log(`[dhandho] reminded ${n} member(s) for tenant ${t}`);
        } catch (err) {
          console.error(`[dhandho] tenant ${t} failed:`, (err as Error).message);
        }
      }
    } catch (err) {
      console.error("[dhandho] tick failed:", (err as Error).message);
    } finally {
      running = false;
    }
  };
  const handle = setInterval(tick, interval);
  handle.unref?.();
  console.log(`[dhandho] reminder worker started (interval=${interval}ms)`);
  return () => clearInterval(handle);
}
