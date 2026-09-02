/**
 * Recurring-task chain-on-completion. SERVER-ONLY (writes via a tx).
 *
 * When a recurring task is completed we spawn its next occurrence with the due
 * date advanced by the cadence. Shared by the single-task PATCH and the bulk
 * route so both behave identically — previously only the single PATCH chained,
 * so bulk-completing a recurring task silently ended the series.
 */

import { v4 as uuid } from "uuid";
import type { Tx } from "@/db/client";
import { tasks, type Task } from "@/db/schema";
import { recordAudit } from "@/lib/audit";

/** Internal SLA window by priority (hours) — mirrors the create route. */
const SLA_HOURS_BY_PRIORITY: Record<string, number> = { urgent: 4, high: 24, normal: 72, low: 168 };

/** Advance a date by one recurrence cadence. */
export function advanceDue(base: Date, freq: string): Date {
  const d = new Date(base);
  switch (freq) {
    case "daily": d.setDate(d.getDate() + 1); break;
    case "weekly": d.setDate(d.getDate() + 7); break;
    case "monthly": d.setMonth(d.getMonth() + 1); break;
    case "quarterly": d.setMonth(d.getMonth() + 3); break;
    case "yearly": d.setFullYear(d.getFullYear() + 1); break;
  }
  return d;
}

/**
 * Spawn the next occurrence of a recurring task. Returns the new task id, or
 * null when the task isn't recurring or the next due date is past the optional
 * recurrence end. The caller must only invoke this on a genuine
 * not-completed → completed transition (idempotency is the caller's concern).
 */
export async function spawnNextOccurrence(
  tx: Tx,
  before: Task,
  actorUserId: string,
  clientMeta: Record<string, unknown> = {}
): Promise<string | null> {
  if (!before.recurrence) return null;
  const baseDue = before.dueAt ? new Date(before.dueAt as any) : new Date();
  const nextDue = advanceDue(baseDue, before.recurrence);
  const until = before.recurrenceUntil ? new Date(before.recurrenceUntil as any) : null;
  if (until && nextDue > until) return null;

  const spawnedId = uuid();
  // Give the new occurrence an SLA target so "SLA at risk" works for it (the
  // create route sets slaDueAt from priority; the chained occurrence used to get
  // none). The occurrence becomes "due" at nextDue, so anchor the SLA there —
  // or, when undated, fall back to the priority window from now.
  const slaHours = SLA_HOURS_BY_PRIORITY[before.priority] ?? 72;
  const slaDueAt = before.dueAt ? nextDue : new Date(Date.now() + slaHours * 60 * 60 * 1000);

  await tx.insert(tasks).values({
    id: spawnedId,
    tenantId: before.tenantId,
    subjectType: before.subjectType,
    subjectId: before.subjectId,
    relatedInvestorId: before.relatedInvestorId,
    relatedLeadId: before.relatedLeadId,
    relatedServiceRequestId: before.relatedServiceRequestId,
    relatedMeetingId: before.relatedMeetingId,
    department: before.department,
    type: before.type,
    title: before.title,
    description: before.description,
    priority: before.priority,
    status: "open",
    assigneeId: before.assigneeId,
    createdById: actorUserId,
    dueAt: nextDue,
    slaDueAt,
    recurrence: before.recurrence,
    recurrenceUntil: before.recurrenceUntil,
    recurrenceParentId: before.recurrenceParentId ?? before.id,
    // Carry the approval requirement across the series; approval STATE (pending/
    // approved) and reminders deliberately start fresh on each occurrence.
    requiresApproval: before.requiresApproval,
  } as any);

  await recordAudit(tx, {
    tenantId: before.tenantId,
    actorUserId,
    action: "task.recurrence_spawn",
    entityType: "task",
    entityId: spawnedId,
    after: { from: before.id, dueAt: nextDue.toISOString(), recurrence: before.recurrence } as any,
    ...clientMeta,
  });

  return spawnedId;
}
