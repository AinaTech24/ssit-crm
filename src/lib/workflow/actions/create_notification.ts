/**
 * `create_notification` — fan out in-app notifications to users by role or
 * explicit user ids. Writes one `notifications` row per recipient.
 *
 * This is the dedicated path for the bell icon. For SLAs, alerts, escalations,
 * and "FYI" surfacing inside the app. Use `raise_alert` when you also want an
 * audit_log row attached; use `send_whatsapp` / `send_email` for external
 * channels.
 *
 * Audience resolution:
 *   - roles: ["owner", "rm"]                — every active user with any of these roles
 *   - users: ["<userId>", "subject.rm_id"]  — explicit ids; tokens are resolved against context
 *   - subjectRm: true                       — convenience for "the subject investor's RM"
 *
 * Idempotency: the runner retries handlers with a stable (runId, nodeId, attempt)
 * tuple. We dedupe inserts by writing a deterministic `meta.idempotency_key` and
 * skipping if one exists for the same (userId, kind, key).
 */

import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import { notifications } from "@/db/schema";
import { resolveExpression } from "../context";
import type { ActionHandler } from "./index";

export const createNotificationHandler: ActionHandler<any> = {
  type: "create_notification",
  async execute(ctx, node, tx) {
    const cfg = node.config ?? {};
    const title = String(resolveExpression(cfg.title ?? "Notification", ctx));
    const body = cfg.body ? String(resolveExpression(cfg.body, ctx)) : null;
    const kind = String(cfg.kind ?? "workflow.alert");
    const severity = (cfg.severity ?? "info") as "info" | "success" | "warning" | "critical";
    const linkUrl = cfg.linkUrl ? String(resolveExpression(cfg.linkUrl, ctx)) : null;

    const recipientIds = await resolveRecipients(ctx, tx, cfg.audience ?? {});
    if (!recipientIds.length) {
      return { kind: "continue", output: { delivered: 0, reason: "no_recipients" } };
    }

    const idempotencyKey = `${ctx.runId}:${node.id}:${ctx.subjectId ?? "no_subject"}`;

    let delivered = 0;
    for (const userId of recipientIds) {
      // Dedupe: skip if a notification with this idempotency key already exists.
      const exists = await tx.execute(sql`
        SELECT 1 FROM notifications
        WHERE tenant_id = ${ctx.tenantId}
          AND user_id = ${userId}
          AND kind = ${kind}
          AND meta->>'idempotency_key' = ${idempotencyKey}
        LIMIT 1
      `);
      if (exists.rows.length) continue;

      await tx.insert(notifications).values({
        id: uuid(),
        tenantId: ctx.tenantId,
        userId,
        kind,
        title,
        body,
        linkUrl,
        severity,
        meta: {
          idempotency_key: idempotencyKey,
          workflow_run_id: ctx.runId,
          node_id: node.id,
          subject_type: ctx.subjectType ?? null,
          subject_id: ctx.subjectId ?? null,
        },
      } as any);
      delivered += 1;
    }

    return {
      kind: "continue",
      output: { delivered, recipientCount: recipientIds.length, kind, severity },
    };
  },
};

/**
 * Resolve an audience config block to a list of user ids in the current tenant.
 * Exported so `raise_alert` shares the exact same resolution logic.
 */
export async function resolveRecipients(
  ctx: { tenantId: string; subjectType?: string | null; subjectId?: string | null; variables?: any; subject?: any },
  tx: any,
  audience: {
    roles?: string[];
    users?: string[];
    subjectRm?: boolean;
  }
): Promise<string[]> {
  const ids = new Set<string>();

  // Explicit user ids (possibly with template tokens like "subject.rm_id")
  for (const raw of audience.users ?? []) {
    const resolved = String(resolveExpression(raw, ctx as any) ?? "").trim();
    if (looksLikeUuid(resolved)) ids.add(resolved);
  }

  // Subject investor's RM
  if (audience.subjectRm) {
    const rmId = (ctx as any).subject?.rm_id ?? (ctx as any).subject?.rmId ?? null;
    if (looksLikeUuid(rmId)) ids.add(rmId);
  }

  // Role-based
  const roles = audience.roles ?? [];
  if (roles.length) {
    const rows = await tx.execute(sql`
      SELECT id FROM users
      WHERE tenant_id = ${ctx.tenantId}
        AND status = 'active'
        AND roles && ${sql.raw(`ARRAY[${roles.map((r) => `'${escapeSql(r)}'`).join(",")}]::text[]`)}
    `);
    for (const r of rows.rows as any[]) ids.add(String(r.id));
  }

  return Array.from(ids);
}

function looksLikeUuid(s: any): boolean {
  return typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function escapeSql(s: string): string {
  return s.replace(/'/g, "''");
}
