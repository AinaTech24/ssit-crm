/**
 * Weekly firm digest — every Monday ~9:00 AM IST, owners and branch heads get
 * "Your firm this week": a look BACK at the last 7 days (business booked, SIPs
 * added/stopped, leads in/converted, reviews held, tickets resolved) plus the
 * week ahead (reviews scheduled, open tickets). The daily briefing (8 AM) says
 * "here's what needs you today"; this says "here's how the firm is doing".
 *
 * Mechanics mirror daily-briefing.ts exactly:
 *   · 15-minute interval tick; acts only when IST is Monday 09:00–09:59.
 *   · Dedupe: a notifications row kind='weekly_digest' created today (IST)
 *     means that user already got this week's digest.
 *   · withSystem to list tenants, withTenant for all per-tenant work.
 *   · Email is best-effort and sent AFTER the tenant tx commits.
 */

import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { createNotification } from "@/lib/notifications/create";
import { resolveEmailSender, type EmailSender } from "@/lib/comms/sender";
import { emailAdapter } from "@/lib/comms/adapters/resend";
import { captureError } from "@/lib/observability/capture";

const MAX_USERS_PER_TENANT = 25;

type WeekStats = {
  business_amt: number;
  business_count: number;
  sips_added: number;
  sips_added_amt: number;
  sips_stopped: number;
  leads_new: number;
  leads_converted: number;
  clients_new: number;
  reviews_done: number;
  reviews_upcoming: number;
  srs_opened: number;
  srs_resolved: number;
  srs_open_now: number;
  tasks_done: number;
};

function appBaseUrl(): string {
  return (
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://crm.equitywala.com"
  ).replace(/\/+$/, "");
}

const esc = (s: string) =>
  (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** ₹12,34,567 (en-IN grouping, no decimals). */
function inr(n: number): string {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

/** The 7-day pulse for one tenant — a single round trip of scalar subqueries. */
async function weekStats(tx: any): Promise<WeekStats> {
  const r = await tx.execute(sql`
    SELECT
      (SELECT COALESCE(sum(total_amount), 0) FROM business_entries WHERE created_at >= now() - interval '7 days')::float8 AS business_amt,
      (SELECT count(*) FROM business_entries WHERE created_at >= now() - interval '7 days')::int AS business_count,
      (SELECT count(*) FROM sips WHERE created_at >= now() - interval '7 days')::int AS sips_added,
      (SELECT COALESCE(sum(amount), 0) FROM sips WHERE created_at >= now() - interval '7 days')::float8 AS sips_added_amt,
      (SELECT count(*) FROM sips WHERE status IN ('stopped', 'rejected') AND updated_at >= now() - interval '7 days')::int AS sips_stopped,
      (SELECT count(*) FROM leads WHERE created_at >= now() - interval '7 days')::int AS leads_new,
      (SELECT count(*) FROM leads WHERE converted_at >= now() - interval '7 days')::int AS leads_converted,
      (SELECT count(*) FROM investors WHERE created_at >= now() - interval '7 days' AND deleted_at IS NULL)::int AS clients_new,
      (SELECT count(*) FROM review_meetings WHERE status = 'completed' AND updated_at >= now() - interval '7 days')::int AS reviews_done,
      (SELECT count(*) FROM review_meetings WHERE status = 'scheduled' AND meeting_date BETWEEN now() AND now() + interval '7 days')::int AS reviews_upcoming,
      (SELECT count(*) FROM service_requests WHERE created_at >= now() - interval '7 days')::int AS srs_opened,
      (SELECT count(*) FROM service_requests WHERE resolved_at >= now() - interval '7 days')::int AS srs_resolved,
      (SELECT count(*) FROM service_requests WHERE status NOT IN ('resolved', 'closed'))::int AS srs_open_now,
      (SELECT count(*) FROM tasks WHERE completed_at >= now() - interval '7 days')::int AS tasks_done
  `);
  const row = (r.rows?.[0] ?? {}) as Record<string, unknown>;
  const n = (k: string) => Number(row[k] ?? 0);
  return {
    business_amt: n("business_amt"),
    business_count: n("business_count"),
    sips_added: n("sips_added"),
    sips_added_amt: n("sips_added_amt"),
    sips_stopped: n("sips_stopped"),
    leads_new: n("leads_new"),
    leads_converted: n("leads_converted"),
    clients_new: n("clients_new"),
    reviews_done: n("reviews_done"),
    reviews_upcoming: n("reviews_upcoming"),
    srs_opened: n("srs_opened"),
    srs_resolved: n("srs_resolved"),
    srs_open_now: n("srs_open_now"),
    tasks_done: n("tasks_done"),
  };
}

/** "₹4.2L business · 6 new SIPs · 3 leads converted" — the notification body. */
function oneLine(s: WeekStats): string {
  const parts: string[] = [];
  if (s.business_amt > 0) parts.push(`${inr(s.business_amt)} business booked`);
  if (s.sips_added > 0) parts.push(`${s.sips_added} new SIP${s.sips_added === 1 ? "" : "s"}`);
  if (s.leads_converted > 0) parts.push(`${s.leads_converted} lead${s.leads_converted === 1 ? "" : "s"} converted`);
  if (s.reviews_done > 0) parts.push(`${s.reviews_done} review${s.reviews_done === 1 ? "" : "s"} held`);
  if (parts.length === 0) parts.push(`${s.leads_new} new leads · ${s.tasks_done} tasks completed`);
  return parts.slice(0, 3).join(" · ");
}

function digestHtml(userName: string, s: WeekStats): string {
  const url = `${appBaseUrl()}/dashboard/reports`;
  const row = (label: string, value: string, quiet = false) =>
    `<tr>
      <td style="padding:7px 0;color:${quiet ? "#94a3b8" : "#475569"};font-size:13px;border-bottom:1px solid #f1f5f9;">${esc(label)}</td>
      <td style="padding:7px 0;color:#0f172a;font-size:13px;font-weight:600;text-align:right;border-bottom:1px solid #f1f5f9;font-variant-numeric:tabular-nums;">${esc(value)}</td>
    </tr>`;

  const lastWeek = [
    row("Business booked", `${inr(s.business_amt)} · ${s.business_count} entr${s.business_count === 1 ? "y" : "ies"}`),
    row("New SIPs registered", `${s.sips_added} · ${inr(s.sips_added_amt)}/mo`),
    s.sips_stopped > 0 ? row("SIPs stopped / bounced", String(s.sips_stopped)) : "",
    row("Leads added", String(s.leads_new)),
    row("Leads converted to clients", String(s.leads_converted)),
    s.clients_new > 0 ? row("New clients onboarded", String(s.clients_new)) : "",
    row("Review meetings held", String(s.reviews_done)),
    row("Tickets resolved", `${s.srs_resolved} of ${s.srs_opened} opened`),
    row("Tasks completed", String(s.tasks_done)),
  ].join("");

  const nextWeek = [
    row("Reviews scheduled", String(s.reviews_upcoming), true),
    row("Tickets still open", String(s.srs_open_now), true),
  ].join("");

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:600px;margin:0 auto;color:#0f172a;padding:8px 4px;">
    <h2 style="margin:0 0 4px;font-size:18px;">Your firm this week</h2>
    <p style="margin:0 0 14px;color:#475569;font-size:13px;">Good morning, ${esc(userName)} — the last 7 days at a glance.</p>
    <table style="width:100%;border-collapse:collapse;">${lastWeek}</table>
    <h3 style="margin:20px 0 4px;font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">The week ahead</h3>
    <table style="width:100%;border-collapse:collapse;">${nextWeek}</table>
    <p style="margin:24px 0 0;">
      <a href="${url}" style="display:inline-block;background:#841F21;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 18px;border-radius:8px;">Open Reports &amp; MIS</a>
    </p>
    <p style="font-size:11px;color:#94a3b8;margin-top:20px;border-top:1px solid #e2e8f0;padding-top:10px;">You receive this every Monday because you manage this firm on Growth OS.</p>
  </div>`;
}

async function listActiveTenants(): Promise<string[]> {
  return await withSystem(async (tx) => {
    const r = await tx.execute(sql`SELECT id FROM tenants WHERE status IN ('active', 'trial')`);
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

async function digestTenant(tenantId: string, istDate: string): Promise<{ sent: number; skipped: number }> {
  let sent = 0;
  let skipped = 0;
  const emails: PendingEmail[] = [];

  await withTenant(
    tenantId,
    async (tx) => {
      const usersRes = await tx.execute(sql`
        SELECT id, name, email
        FROM users
        WHERE status = 'active'
          AND roles && ARRAY['owner','branch_head']::text[]
        ORDER BY name ASC
        LIMIT ${MAX_USERS_PER_TENANT}
      `);
      const users = usersRes.rows as Array<{ id: string; name: string; email: string }>;
      if (!users.length) return;

      const doneRes = await tx.execute(sql`
        SELECT user_id FROM notifications
        WHERE kind = 'weekly_digest'
          AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
      `);
      const alreadySent = new Set((doneRes.rows as Array<{ user_id: string }>).map((r) => String(r.user_id)));

      const pending = users.filter((u) => !alreadySent.has(String(u.id)));
      if (!pending.length) {
        skipped += users.length;
        return;
      }

      // Firm-wide stats — computed once per tenant, shared by every recipient.
      const s = await weekStats(tx);
      const anyActivity =
        s.business_count + s.sips_added + s.leads_new + s.leads_converted + s.clients_new +
        s.reviews_done + s.srs_opened + s.srs_resolved + s.tasks_done > 0;
      if (!anyActivity) {
        skipped += pending.length; // dormant tenant — no noise
        return;
      }

      const summary = oneLine(s);
      for (const user of pending) {
        await createNotification(tx, {
          tenantId,
          userId: String(user.id),
          kind: "weekly_digest",
          title: "📈 Your firm this week",
          body: summary,
          linkUrl: "/dashboard/reports",
          severity: "info",
          meta: { date: istDate },
        });
        sent++;

        if (user.email) {
          try {
            const sender = await resolveEmailSender(tx as any, tenantId, String(user.id), { allowFirmFallback: true });
            emails.push({
              tenantId,
              userId: String(user.id),
              recipient: user.email,
              subject: `Your firm this week — ${summary}`,
              text: summary,
              html: digestHtml(user.name ?? "there", s),
              sender,
              idempotencyKey: `weekly-digest:${user.id}:${istDate}`,
            });
          } catch (err) {
            captureError("[weekly-digest] sender resolution failed", err, { tenantId, userId: String(user.id) });
          }
        }
      }
    },
    { roles: ["system"] }
  );

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
        fromOverride: (e.sender as any).fromEmail || undefined,
        fromNameOverride: (e.sender as any).fromName || undefined,
        replyTo: (e.sender as any).replyTo || undefined,
      } as any);
    } catch (err) {
      captureError("[weekly-digest] email send failed", err, { tenantId: e.tenantId, userId: e.userId });
    }
  }

  return { sent, skipped };
}

/**
 * Start the weekly-digest worker: 15-minute tick, acts only Monday 09:00–09:59
 * IST (per-user daily dedupe makes it once per week). Returns a stop function.
 */
export function startWeeklyDigestWorker(): () => void {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
      // getUTCDay on the shifted date = IST weekday. 1 = Monday.
      if (istNow.getUTCDay() !== 1 || istNow.getUTCHours() !== 9) return;
      const istDate = istNow.toISOString().slice(0, 10);

      let sent = 0;
      let skipped = 0;
      for (const tenantId of await listActiveTenants()) {
        try {
          const r = await digestTenant(tenantId, istDate);
          sent += r.sent;
          skipped += r.skipped;
        } catch (err) {
          captureError("[weekly-digest] tenant failed", err, { tenantId });
        }
      }
      console.log(`[weekly-digest] sent=${sent} skipped=${skipped}`);
    } catch (err) {
      captureError("[weekly-digest] tick failed", err);
    } finally {
      running = false;
    }
  };

  void tick();
  const t = setInterval(tick, 15 * 60 * 1000);
  t.unref?.();
  console.log("[weekly-digest] Monday firm-digest worker armed (9 AM IST window, 15 min tick)");
  return () => clearInterval(t);
}
