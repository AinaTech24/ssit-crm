/**
 * recordAudit() — single helper every mutation path calls.
 *
 * Writes one row to `audit_log`. Safe to call inside `withTenant` (preferred) or
 * `withSystem` (for cross-tenant ops). Failures are swallowed and logged so a
 * broken audit write never blocks the real business mutation — but every call
 * site should log at least the action + entityId so a missing audit row is
 * easy to spot during inspections.
 *
 * Usage:
 *   await withTenant(session.tenantId, async (tx) => {
 *     await tx.update(investors).set({...}).where(...);
 *     await recordAudit(tx, {
 *       tenantId: session.tenantId,
 *       actorUserId: session.userId,
 *       action: "investor.update",
 *       entityType: "investor",
 *       entityId: investorId,
 *       before, after,
 *     });
 *   });
 */

import { v4 as uuid } from "uuid";
import { auditLog } from "@/db/schema";
import type { Tx } from "@/db/client";

export type AuditAction =
  // Investor / lead
  | "investor.create"
  | "investor.update"
  | "investor.bulk_import"
  | "investor.bulk_export"
  | "investor.tier.recompute"
  | "lead.create"
  | "lead.update"
  | "lead.stage_change"
  | "lead.convert"
  | "lead.note_add"
  | "lead.bulk_import"
  // Family
  | "family.create"
  | "family.member.add"
  | "family.member.remove"
  // Transactions
  | "transaction.bulk_import"
  | "transaction.reconcile"
  // Tasks / SR
  | "task.create"
  | "service_request.create"
  | "service_request.status_change"
  // Templates / workflows / campaigns
  | "template.create"
  | "template.submit"
  | "template.approve"
  | "workflow.create"
  | "workflow.publish"
  | "workflow.install_recipe"
  | "campaign.launch"
  // Employees / roles
  | "employee.invite"
  | "employee.role_change"
  | "employee.deactivate"
  // Documents
  | "document.upload"
  | "document.delete"
  // Tenant / billing
  | "tenant.status_change"
  | "tenant.profile_update"
  | "package.update"
  | "package.delete"
  | "target.update"
  | "business_entry.create"
  | "business_entry.update"
  | "business_entry.delete"
  | "business_entry.email"
  // Generic
  | (string & {}); // allow free-form keys without losing IDE help

export interface RecordAuditInput {
  tenantId: string;
  actorUserId?: string | null;
  actorType?: "user" | "system" | "workflow" | "webhook";
  action: AuditAction;
  entityType?: string | null;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  piiAccessed?: Record<string, unknown> | null;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Hard cap on a single audit row's JSONB payload size. Keeps the
 * compliance trail intact without ballooning into terabytes of storage
 * when callers dump full Drizzle returning() rows. 4 KB per field is
 * enough for diff context; large blobs (proposal HTML, doc payloads)
 * are summarised with a marker so the row is still useful.
 */
const AUDIT_PAYLOAD_CAP_BYTES = 4 * 1024;

function capPayload(value: Record<string, unknown> | null | undefined) {
  if (value == null) return null;
  try {
    const json = JSON.stringify(value);
    if (json.length <= AUDIT_PAYLOAD_CAP_BYTES) return value;
    return {
      __truncated: true,
      __originalSizeBytes: json.length,
      __cap: AUDIT_PAYLOAD_CAP_BYTES,
      preview: json.slice(0, AUDIT_PAYLOAD_CAP_BYTES - 200) + "…",
    } as Record<string, unknown>;
  } catch {
    return { __truncated: true, __reason: "serialisation_error" };
  }
}

export async function recordAudit(tx: Tx, input: RecordAuditInput): Promise<void> {
  try {
    await tx.insert(auditLog).values({
      id: uuid(),
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      actorType: input.actorType ?? "user",
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      // Cap before/after at 4 KB each — keep diff context, drop blob bloat.
      before: capPayload(input.before),
      after: capPayload(input.after),
      meta: capPayload(input.meta),
      piiAccessed: input.piiAccessed ?? null,
      reason: input.reason ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    } as any);
  } catch (err) {
    // Audit writes must never break business flows. Surface in logs only.
    console.error("[audit] write failed", { action: input.action, entityId: input.entityId, err });
  }
}

/**
 * Convenience for routes — pulls IP/UA from a NextRequest if available.
 */
export function clientMetaFromHeaders(headers: Headers) {
  return {
    ipAddress:
      headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      headers.get("x-real-ip") ??
      null,
    userAgent: headers.get("user-agent") ?? null,
  };
}
