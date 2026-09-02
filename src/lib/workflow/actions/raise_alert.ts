import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import { auditLog, notifications } from "@/db/schema";
import { resolveExpression } from "../context";
import { resolveRecipients } from "./create_notification";
import { sendSystemEmail } from "@/lib/comms/system-email";
import type { ActionHandler } from "./index";

/**
 * Raise an alert to a set of users (by role or id). Always writes an audit_log
 * row, then fans out to the configured channels:
 *   - inapp (default): one notifications row per recipient (the bell icon)
 *   - email:           best-effort transactional email to each recipient
 *   - whatsapp / sms:  not wired here — staff alerts over those channels need
 *                      an approved template + consent; surfaced in output as skipped.
 */
export const raiseAlertHandler: ActionHandler<any> = {
  type: "raise_alert",
  async execute(ctx, node, tx) {
    const cfg = node.config;
    const title = String(resolveExpression(cfg.title, ctx));
    const body = cfg.body ? String(resolveExpression(cfg.body, ctx)) : null;
    const severity = (cfg.severity ?? "warning") as "info" | "warning" | "critical";
    const channels: string[] = cfg.channels ?? ["inapp"];

    await tx.insert(auditLog).values({
      id: uuid(),
      tenantId: ctx.tenantId,
      actorType: "workflow",
      action: `alert.${severity}`,
      entityType: ctx.subjectType ?? null,
      entityId: ctx.subjectId ?? null,
      meta: { title, body, audience: cfg.audience, channels },
      reason: title,
    });

    const recipientIds = await resolveRecipients(ctx as any, tx, cfg.audience ?? {});
    const linkUrl = subjectLink(ctx.subjectType, ctx.subjectId);
    const idempotencyKey = `${(ctx as any).runId}:${node.id}:${ctx.subjectId ?? "no_subject"}`;

    // ── In-app notifications ──────────────────────────────────────────────
    let inappDelivered = 0;
    if (channels.includes("inapp")) {
      for (const userId of recipientIds) {
        const exists = await tx.execute(sql`
          SELECT 1 FROM notifications
          WHERE tenant_id = ${ctx.tenantId} AND user_id = ${userId}
            AND kind = ${`alert.${severity}`}
            AND meta->>'idempotency_key' = ${idempotencyKey}
          LIMIT 1
        `);
        if (exists.rows.length) continue;
        await tx.insert(notifications).values({
          id: uuid(),
          tenantId: ctx.tenantId,
          userId,
          kind: `alert.${severity}`,
          title,
          body,
          linkUrl,
          severity,
          meta: {
            idempotency_key: idempotencyKey,
            workflow_run_id: (ctx as any).runId ?? null,
            node_id: node.id,
            subject_type: ctx.subjectType ?? null,
            subject_id: ctx.subjectId ?? null,
          },
        } as any);
        inappDelivered += 1;
      }
    }

    // ── Best-effort email ─────────────────────────────────────────────────
    let emailsSent = 0;
    if (channels.includes("email") && recipientIds.length) {
      const rows = await tx.execute(sql`
        SELECT email FROM users
        WHERE tenant_id = ${ctx.tenantId}
          AND id = ANY(${sql.raw(`ARRAY[${recipientIds.map((r) => `'${r.replace(/'/g, "''")}'`).join(",")}]::uuid[]`)})
          AND email IS NOT NULL
      `);
      for (const r of rows.rows as any[]) {
        const res = await sendSystemEmail({
          tenantId: ctx.tenantId,
          to: r.email,
          subject: `[${severity.toUpperCase()}] ${title}`,
          text: `${title}\n\n${body ?? ""}`.trim(),
          idempotencyKey: `${idempotencyKey}:${r.email}`,
        });
        if (res.sent) emailsSent += 1;
      }
    }

    const skippedChannels = channels.filter((c) => c === "whatsapp" || c === "sms");

    return {
      kind: "continue",
      output: {
        severity,
        title,
        recipients: recipientIds.length,
        inappDelivered,
        emailsSent,
        skippedChannels,
      },
    };
  },
};

/** Deep link for the bell, derived from the workflow subject. */
function subjectLink(subjectType?: string | null, subjectId?: string | null): string | null {
  if (!subjectId) return null;
  switch (subjectType) {
    case "investor":
      return `/dashboard/investors/${subjectId}`;
    case "lead":
      return `/dashboard/leads/${subjectId}`;
    case "service_request":
      return `/dashboard/service-requests/${subjectId}`;
    case "task":
      return `/dashboard/tasks`;
    default:
      return null;
  }
}
