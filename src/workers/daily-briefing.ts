/**
 * Daily morning briefing — at ~8:00 AM IST every working user (owner /
 * branch head / RM) gets an in-app notification + a branded email summarising
 * their day: overdue tasks, meetings today, SIP bounces, birthdays, lead
 * follow-ups — everything the Command Center already computes.
 *
 * Mechanics:
 *   · 15-minute interval tick (unref'd). A tick only does work when the
 *     current IST hour is 8 (fires somewhere in the 08:00–08:59 window).
 *   · Per-user dedupe: a `notifications` row with kind='daily_briefing'
 *     created today (IST) means that user was already briefed — skip. This
 *     makes the 15-min cadence idempotent (exactly one briefing per day).
 *   · Tenant iteration mirrors the daily-ops scanner: withSystem to list
 *     active tenants, then all per-tenant reads/writes inside withTenant so
 *     RLS gives defense-in-depth.
 *   · The digest itself is buildCommandQueue() — the same prioritised
 *     worklist the Command Center page renders. firm-wide for owners /
 *     branch heads, own-book for RMs.
 *   · Email is best-effort (resolveEmailSender + emailAdapter, same direct
 *     pattern as /api/calculators/share). The external send happens AFTER the
 *     tenant transaction commits so a slow SMTP call never holds a DB tx.
 */

import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { buildCommandQueue, type ActionGroup } from "@/lib/command-center/queue";
import { createNotification } from "@/lib/notifications/create";
import { resolveEmailSender, type EmailSender } from "@/lib/comms/sender";
import { emailAdapter } from "@/lib/comms/adapters/resend";
import { captureError } from "@/lib/observability/capture";

const FIRM_WIDE_ROLES = new Set(["owner", "branch_head"]);
const MAX_USERS_PER_TENANT = 50;
const MAX_GROUPS_IN_DIGEST = 4;

/** Absolute origin for email links (worker context — no request headers). */
function appBaseUrl(): string {
  return (
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://crm.equitywala.com"
  ).replace(/\/+$/, "");
}

const esc = (s: string) =>
  (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** "12 Overdue tasks · 2 Meetings today · 1 SIP bounce" from the top groups. */
function oneLineSummary(groups: ActionGroup[]): string {
  return groups
    .slice(0, MAX_GROUPS_IN_DIGEST)
    .map((g) => `${g.count} ${g.label}`)
    .join(" · ");
}

/** Minimal, clean 600px HTML digest — greeting, group headings + top items, CTA. */
function briefingHtml(userName: string, groups: ActionGroup[], totalCount: number): string {
  const url = `${appBaseUrl()}/dashboard/command-center`;
  const sections = groups
    .slice(0, MAX_GROUPS_IN_DIGEST)
    .map((g) => {
      const lines = g.items
        .slice(0, 3)
        .map(
          (it) =>
            `<li style="margin:4px 0;color:#334155;font-size:13px;line-height:1.5;">${esc(it.title)}${
              it.detail ? ` <span style="color:#94a3b8;">— ${esc(it.detail)}</span>` : ""
            }</li>`
        )
        .join("");
      const more = g.count > 3 ? `<li style="margin:4px 0;color:#94a3b8;font-size:12px;">…and ${g.count - 3} more</li>` : "";
      return `<h3 style="margin:18px 0 6px;font-size:14px;color:#0f172a;">${esc(g.label)} <span style="color:#64748b;font-weight:normal;">(${g.count})</span></h3>
        <ul style="margin:0;padding-left:18px;">${lines}${more}</ul>`;
    })
    .join("");
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:600px;margin:0 auto;color:#0f172a;padding:8px 4px;">
    <h2 style="margin:0 0 4px;font-size:18px;">☀️ Good morning, ${esc(userName)}</h2>
    <p style="margin:0 0 8px;color:#475569;font-size:13px;">${totalCount} thing${totalCount === 1 ? "" : "s"} need${totalCount === 1 ? "s" : ""} you today. Here's your day at a glance:</p>
    ${sections}
    <p style="margin:24px 0 0;">
      <a href="${url}" style="display:inline-block;background:#0E2557;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 18px;border-radius:8px;">Open your Command Center</a>
    </p>
    <p style="font-size:11px;color:#94a3b8;margin-top:20px;border-top:1px solid #e2e8f0;padding-top:10px;">You're receiving this daily briefing because you're an active user of your firm's Growth OS.</p>
  </div>`;
}

async function listActiveTenants(): Promise<string[]> {
  return await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT id FROM tenants
      WHERE status IN ('active', 'trial')
    `);
    return (r.rows as Array<{ id: string }>).map((row) => row.id);
  });
}

type PendingEmail = {
  tenantId: string;
  userId: string;
  recipient: string;
  subject: string;
  text: string;
  html: string;
  sender: EmailSender;
  idempotencyKey: string;
};

/** Brief one tenant's users. Returns { sent, skipped } counts. */
async function briefTenant(tenantId: string, istDate: string): Promise<{ sent: number; skipped: number }> {
  let sent = 0;
  let skipped = 0;
  const emails: PendingEmail[] = [];

  await withTenant(
    tenantId,
    async (tx) => {
      // Active working users (owner / branch_head / rm). Investor/platform
      // roles never get a briefing; capped so a mega-tenant can't stall the run.
      const usersRes = await tx.execute(sql`
        SELECT id, name, email, roles
        FROM users
        WHERE status = 'active'
          AND roles && ARRAY['owner','branch_head','rm']::text[]
        ORDER BY name ASC
        LIMIT ${MAX_USERS_PER_TENANT}
      `);
      const users = usersRes.rows as Array<{ id: string; name: string; email: string; roles: string[] }>;
      if (!users.length) return;

      // Dedupe — users already briefed today (IST). One query for the tenant.
      const doneRes = await tx.execute(sql`
        SELECT user_id FROM notifications
        WHERE kind = 'daily_briefing'
          AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
      `);
      const alreadyBriefed = new Set((doneRes.rows as Array<{ user_id: string }>).map((r) => String(r.user_id)));

      for (const user of users) {
        if (alreadyBriefed.has(String(user.id))) {
          skipped++;
          continue;
        }

        // Same call shape as the Command Center page: firm-wide for owners /
        // branch heads, own-book for everyone else.
        const roles = Array.isArray(user.roles) ? user.roles : [];
        const firmWide = roles.some((r) => FIRM_WIDE_ROLES.has(r));
        const groups = await buildCommandQueue(tx as any, { userId: String(user.id), firmWide });
        const totalCount = groups.reduce((n, g) => n + g.count, 0);
        if (totalCount === 0) {
          skipped++; // all clear — no noise
          continue;
        }

        const summary = oneLineSummary(groups);
        await createNotification(tx, {
          tenantId,
          userId: String(user.id),
          kind: "daily_briefing",
          title: "☀️ Your morning briefing",
          body: summary,
          linkUrl: "/dashboard/command-center",
          severity: "info",
          meta: { date: istDate, total: totalCount },
        });
        sent++;

        // Queue the email for after the tx commits (external call outside tx).
        if (user.email) {
          try {
            const sender = await resolveEmailSender(tx as any, tenantId, String(user.id));
            emails.push({
              tenantId,
              userId: String(user.id),
              recipient: user.email,
              subject: `Your morning briefing — ${totalCount} thing${totalCount === 1 ? "" : "s"} need you today`,
              text: summary,
              html: briefingHtml(user.name ?? "there", groups, totalCount),
              sender,
              idempotencyKey: `briefing:${user.id}:${istDate}`,
            });
          } catch (err) {
            captureError("[briefing] sender resolution failed", err, { tenantId, userId: String(user.id) });
          }
        }
      }
    },
    { roles: ["system"] }
  );

  // Best-effort email fan-out — a failed send never fails the briefing (the
  // in-app notification is already committed and is the dedupe anchor).
  for (const e of emails) {
    try {
      await emailAdapter.send({
        tenantId: e.tenantId,
        tokens: {},
        rendered: { subject: e.subject, text: e.text, tokens: {} },
        recipient: e.recipient,
        category: "transactional",
        inlineHtml: e.html,
        idempotencyKey: e.idempotencyKey,
        smtp: (e.sender as any).smtp,
        apiKey: (e.sender as any).apiKey,
        fromOverride: (e.sender as any).fromEmail || undefined,
        fromNameOverride: (e.sender as any).fromName || undefined,
        replyTo: (e.sender as any).replyTo || undefined,
      } as any);
    } catch (err) {
      captureError("[briefing] email send failed", err, { tenantId: e.tenantId, userId: e.userId });
    }
  }

  return { sent, skipped };
}

/**
 * Start the daily-briefing worker: a 15-minute tick that only acts inside the
 * 08:00–08:59 IST window (per-user daily dedupe makes it once/day). Returns a
 * stop function, mirroring the other interval workers.
 */
export function startDailyBriefingWorker(): () => void {
  let running = false;

  const tick = async () => {
    if (running) return; // previous tick still in flight
    running = true;
    try {
      // IST "now" — shift the epoch by +5:30 and read the UTC getters as IST.
      const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
      if (istNow.getUTCHours() !== 8) return;
      const istDate = istNow.toISOString().slice(0, 10);

      let sent = 0;
      let skipped = 0;
      const tenants = await listActiveTenants();
      for (const tenantId of tenants) {
        try {
          const r = await briefTenant(tenantId, istDate);
          sent += r.sent;
          skipped += r.skipped;
        } catch (err) {
          captureError("[briefing] tenant failed", err, { tenantId });
        }
      }
      console.log(`[briefing] sent=${sent} skipped=${skipped}`);
    } catch (err) {
      captureError("[briefing] tick failed", err);
    } finally {
      running = false;
    }
  };

  void tick();
  const t = setInterval(tick, 15 * 60 * 1000);
  t.unref?.();
  console.log("[briefing] daily morning-briefing worker armed (8 AM IST window, 15 min tick)");
  return () => clearInterval(t);
}
