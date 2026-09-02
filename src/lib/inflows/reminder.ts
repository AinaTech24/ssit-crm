/**
 * Keeps an expected inflow's REMINDER in sync.
 *
 * Rather than inventing a second reminder engine, an inflow spawns a normal
 * task: due `remindDaysBefore` ahead of the money date, assigned to the inflow's
 * owner, linked to the client. The existing reminder + notification pipeline
 * then does the nudging, and the task shows up in Command Center / My Tasks
 * exactly like everything else the RM has to do.
 *
 * Call inside the same withTenant() tx as the inflow write so the two can never
 * drift apart.
 */

import { and, eq } from "drizzle-orm";
import { tasks, investors, INFLOW_SOURCE_LABELS, type InflowSourceType } from "@/db/schema";

function inr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "";
  return "₹" + Math.round(Number(n)).toLocaleString("en-IN");
}

/** Reminder date = expectedOn - remindDaysBefore, never in the past. */
export function reminderDateFor(expectedOn: string, remindDaysBefore: number): Date {
  const due = new Date(`${expectedOn}T09:00:00`);
  const d = new Date(due);
  d.setDate(d.getDate() - Math.max(0, remindDaysBefore || 0));
  const now = new Date();
  return d.getTime() < now.getTime() ? now : d;
}

export type InflowForReminder = {
  id: string;
  investorId: string;
  ownerId: string | null;
  sourceType: InflowSourceType;
  expectedAmount: string | number | null;
  expectedOn: string;
  remindDaysBefore: number;
  reminderTaskId: string | null;
  status: string;
};

/**
 * Create or update the reminder task for an inflow. Returns the task id to store
 * on the inflow. Closed inflows (invested/lapsed/cancelled) get their open
 * reminder cancelled instead — no point nagging about money already handled.
 */
export async function syncInflowReminder(
  tx: any,
  tenantId: string,
  actorUserId: string,
  inflow: InflowForReminder
): Promise<string | null> {
  const closed = ["invested", "partially_invested", "lapsed", "cancelled"].includes(inflow.status);

  if (closed) {
    if (inflow.reminderTaskId) {
      await tx
        .update(tasks)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(eq(tasks.id, inflow.reminderTaskId), eq(tasks.tenantId, tenantId)));
    }
    return inflow.reminderTaskId;
  }

  const [client] = await tx
    .select({ name: investors.name, rmId: investors.rmId })
    .from(investors)
    .where(and(eq(investors.id, inflow.investorId), eq(investors.tenantId, tenantId)))
    .limit(1);

  const label = INFLOW_SOURCE_LABELS[inflow.sourceType] ?? "Expected inflow";
  const amount = inr(inflow.expectedAmount as any);
  const when = new Date(`${inflow.expectedOn}T00:00:00`).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
  const title = `${label}${amount ? ` ${amount}` : ""} — ${client?.name ?? "client"} (${when})`;
  const description =
    `${client?.name ?? "The client"} is expecting ${amount || "money"} from ${label.toLowerCase()} around ${when}.\n\n` +
    `Call ahead of the date, agree where it goes, and record the outcome on the inflow.`;
  const remindAt = reminderDateFor(inflow.expectedOn, inflow.remindDaysBefore);
  const assignee = inflow.ownerId ?? client?.rmId ?? actorUserId;

  if (inflow.reminderTaskId) {
    await tx
      .update(tasks)
      .set({
        title,
        description,
        dueAt: remindAt,
        remindAt,
        reminderFiredAt: null, // re-arm when the date moves
        assigneeId: assignee,
        status: "open",
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.id, inflow.reminderTaskId), eq(tasks.tenantId, tenantId)));
    return inflow.reminderTaskId;
  }

  const [created] = await tx
    .insert(tasks)
    .values({
      tenantId,
      // subjectType is NOT NULL with no default — the legacy polymorphic pair
      // must be set alongside the explicit relatedInvestorId.
      subjectType: "investor",
      subjectId: inflow.investorId,
      type: "follow_up",
      title,
      description,
      status: "open",
      priority: "high",
      department: "sales",
      dueAt: remindAt,
      remindAt,
      assigneeId: assignee,
      createdById: actorUserId,
      relatedInvestorId: inflow.investorId,
    } as any)
    .returning({ id: tasks.id });

  return created?.id ?? null;
}
