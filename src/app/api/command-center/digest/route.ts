import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/command-center/digest
 *
 * Emails the signed-in user a snapshot of their Command Center queue — the
 * on-demand "morning briefing". A daily cron can hit this same logic per user.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { users, tenants } from "@/db/schema";
import { buildCommandQueue } from "@/lib/command-center/queue";
import { emailAdapter } from "@/lib/comms/adapters/resend";
import { resolveEmailSender } from "@/lib/comms/sender";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BAND_LABEL: Record<string, string> = { now: "Act now", today: "Today", soon: "This week" };

export async function POST(_req: NextRequest) {
  try {
    const session = await requireSession();
    const firmWide = can(session.roles, "dashboard.view.owner", session.permissions);
    const origin = process.env.NEXT_PUBLIC_APP_URL || "https://crm.ssit.com";

    const ctx = await withTenant(session.tenantId, async (tx) => {
      const [u] = await tx.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, session.userId)).limit(1);
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
      const groups = await buildCommandQueue(tx as any, { userId: session.userId, firmWide });
      let sender: Awaited<ReturnType<typeof resolveEmailSender>>;
      try {
        sender = await resolveEmailSender(tx, session.tenantId, session.userId);
      } catch {
        sender = { source: "resend" } as any;
      }
      return { user: u, tenant: t, groups, sender };
    }, { userId: session.userId, branchId: session.branchId, roles: session.roles });

    const email = ctx.user?.email;
    if (!email) return NextResponse.json({ error: "No email on your profile." }, { status: 400 });

    const canEmail = !!(ctx.sender.smtp?.host || ctx.sender.apiKey || process.env.RESEND_API_KEY);
    if (!canEmail) return NextResponse.json({ error: "No mailbox connected (Settings → Email)." }, { status: 400 });

    const total = ctx.groups.reduce((n, g) => n + g.count, 0);
    const nowCount = ctx.groups.filter((g) => g.severity === "now").reduce((n, g) => n + g.count, 0);
    const firmName = (ctx.tenant as any)?.displayName ?? (ctx.tenant as any)?.legalName ?? "Your firm";
    const first = (ctx.user?.name ?? "there").split(" ")[0];

    const rows = ctx.groups
      .map(
        (g) =>
          `<tr><td style="padding:6px 10px;border-bottom:1px solid #eef2f7;">${esc(g.label)}</td>
           <td style="padding:6px 10px;border-bottom:1px solid #eef2f7;color:#64748b;">${BAND_LABEL[g.severity] ?? g.severity}</td>
           <td style="padding:6px 10px;border-bottom:1px solid #eef2f7;text-align:right;font-weight:600;">${g.count}</td></tr>`
      )
      .join("");

    const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#0f172a;">
      <h2 style="margin:0 0 4px;">Good morning, ${esc(first)} 👋</h2>
      <p style="color:#475569;margin:0 0 14px;">Your Command Center — <strong>${total}</strong> open action${total === 1 ? "" : "s"}${nowCount ? `, <strong style="color:#e11d48;">${nowCount} need attention now</strong>` : ""}.</p>
      ${total === 0
        ? `<p style="padding:14px;background:#ecfdf5;border-radius:8px;color:#047857;">All clear — nothing open. 🎉</p>`
        : `<table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #eef2f7;border-radius:8px;overflow:hidden;">
             <thead><tr style="background:#f8fafc;text-align:left;">
               <th style="padding:8px 10px;">What</th><th style="padding:8px 10px;">When</th><th style="padding:8px 10px;text-align:right;">Count</th>
             </tr></thead><tbody>${rows}</tbody></table>`}
      <p style="margin:18px 0;"><a href="${origin}/dashboard/command-center" style="background:#0e2557;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;display:inline-block;">Open Command Center</a></p>
      <div style="margin-top:18px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;">${esc(firmName)} · automated daily briefing</div>
    </div>`;

    const text = `Good morning, ${first}. Your Command Center: ${total} open action(s)${nowCount ? `, ${nowCount} need attention now` : ""}.\n\n` +
      ctx.groups.map((g) => `• ${g.label} (${BAND_LABEL[g.severity] ?? g.severity}): ${g.count}`).join("\n") +
      `\n\nOpen: ${origin}/dashboard/command-center`;

    const ymd = new Date().toISOString().slice(0, 10);
    await emailAdapter.send({
      tenantId: session.tenantId,
      recipient: email,
      category: "transactional",
      tokens: {},
      rendered: { subject: `Your Command Center — ${total} open${nowCount ? `, ${nowCount} urgent` : ""}`, text, tokens: {} },
      inlineHtml: html,
      smtp: ctx.sender.smtp,
      apiKey: ctx.sender.apiKey,
      fromOverride: ctx.sender.fromEmail || undefined,
      fromNameOverride: ctx.sender.fromName || firmName,
      replyTo: ctx.sender.replyTo || undefined,
      idempotencyKey: `cc-digest:${session.userId}:${ymd}`,
    } as any);

    return NextResponse.json({ ok: true, total, nowCount });
  } catch (err: any) {
    return handleApiError(err);
  }
}

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
