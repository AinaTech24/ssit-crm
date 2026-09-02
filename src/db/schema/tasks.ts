import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

export const tasks = pgTable(
  "tasks",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),

    /** Polymorphic subject — what the task is about (kept for legacy + workflow-spawned tasks). */
    subjectType: text("subject_type", {
      enum: ["investor", "lead", "folio", "transaction", "family", "service_request", "compliance", "internal"],
    }).notNull(),
    subjectId: uuid("subject_id"),

    /**
     * Module 18 spec — explicit related-entity columns. A single task can
     * link to multiple entities (e.g. a lead AND a meeting). The legacy
     * subjectType/subjectId still gets populated from whichever related
     * field is set first so back-compat queries keep working.
     */
    relatedInvestorId: uuid("related_investor_id"),
    relatedLeadId: uuid("related_lead_id"),
    relatedServiceRequestId: uuid("related_service_request_id"),
    relatedMeetingId: uuid("related_meeting_id"),

    /** Owning department — surfaces in reports + auto-routing. */
    department: text("department", {
      enum: [
        "sales",
        "operations",
        "back_office",
        "compliance",
        "marketing",
        "advisory",
        "support",
        "leadership",
        "other",
      ],
    }),

    type: text("type").notNull(), // 'follow_up' | 'review_meeting' | 'collect_document' | 'kyc_renewal' | 'custom'
    title: text("title").notNull(),
    description: text("description"),
    /** Free-form remarks added during execution (latest at top). */
    remarks: text("remarks"),

    priority: text("priority", { enum: ["low", "normal", "high", "urgent"] })
      .notNull()
      .default("normal"),
    status: text("status", { enum: ["open", "in_progress", "blocked", "completed", "cancelled"] })
      .notNull()
      .default("open"),

    assigneeId: uuid("assignee_id").references(() => users.id),
    createdById: uuid("created_by_id").references(() => users.id),

    dueAt: timestamp("due_at", { withTimezone: true }),
    slaDueAt: timestamp("sla_due_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    /**
     * Approval / verification loop (10x-Task-style delegation). When
     * `requiresApproval` is set, the assignee "Submits for approval" instead of
     * completing; the approver (creator or an owner) then Approves → completed,
     * or Rejects → back to in_progress with a note. `approvalStatus` is NULL for
     * ordinary tasks that don't use the loop.
     */
    requiresApproval: boolean("requires_approval").notNull().default(false),
    approvalStatus: text("approval_status", { enum: ["pending", "approved", "rejected"] }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),

    /**
     * Per-task reminder. `remindAt` is an absolute time to ping the assignee;
     * `reminderFiredAt` stays NULL until the scanner fires it (and is cleared
     * whenever remindAt changes so an edited reminder re-arms).
     */
    remindAt: timestamp("remind_at", { withTimezone: true }),
    reminderFiredAt: timestamp("reminder_fired_at", { withTimezone: true }),
    /** Set once the overdue scan has fired its one-time alert for this task. */
    overdueNotifiedAt: timestamp("overdue_notified_at", { withTimezone: true }),

    /**
     * Time tracking. `estimateMinutes` is the planned effort; `timeSpentMinutes`
     * is the accumulated logged effort (sum of task_time_logs). A running timer
     * is represented by `startedAt` being non-null (set on start, cleared on
     * stop when the elapsed span is written as a time log).
     */
    estimateMinutes: integer("estimate_minutes"),
    timeSpentMinutes: integer("time_spent_minutes").notNull().default(0),

    /** Dependency — this task is blocked until `blockedByTaskId` is completed. */
    blockedByTaskId: uuid("blocked_by_task_id"),
    /** Set once the "stale pending-approval" nudge fired (dedup watermark). */
    approvalEscalatedAt: timestamp("approval_escalated_at", { withTimezone: true }),

    /** Soft-delete (Trash) — recoverable until permanently removed (migration 0155). */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),

    /**
     * Recurrence (Sanchay "Enable Recurring" parity). NULL = one-off. When a
     * recurring task is completed, the API spawns the next occurrence with its
     * due date advanced by this cadence (chain-on-completion).
     */
    recurrence: text("recurrence", {
      enum: ["daily", "weekly", "monthly", "quarterly", "yearly"],
    }),
    /** Optional end date — stop spawning once the next due date passes it. */
    recurrenceUntil: date("recurrence_until"),
    /** Chain root — groups all occurrences of one recurring series. */
    recurrenceParentId: uuid("recurrence_parent_id"),

    /** Set when generated by a workflow */
    workflowRunId: uuid("workflow_run_id"),
    workflowStepId: text("workflow_step_id"),

    meta: jsonb("meta").$type<Record<string, unknown>>(),
    tags: jsonb("tags").$type<string[]>().default([]),
    ...timestamps,
  },
  (t) => ({
    assigneeIdx: index("tasks_assignee_status_idx").on(t.tenantId, t.assigneeId, t.status),
    dueIdx: index("tasks_due_idx").on(t.tenantId, t.dueAt),
    slaIdx: index("tasks_sla_idx").on(t.tenantId, t.slaDueAt),
    subjectIdx: index("tasks_subject_idx").on(t.tenantId, t.subjectType, t.subjectId),
    relInvIdx: index("tasks_related_investor_idx").on(t.tenantId, t.relatedInvestorId),
    relLeadIdx: index("tasks_related_lead_idx").on(t.tenantId, t.relatedLeadId),
    relSRIdx: index("tasks_related_sr_idx").on(t.tenantId, t.relatedServiceRequestId),
    relMeetingIdx: index("tasks_related_meeting_idx").on(t.tenantId, t.relatedMeetingId),
    deptIdx: index("tasks_department_idx").on(t.tenantId, t.department, t.status),
    remindIdx: index("tasks_remind_idx").on(t.tenantId, t.remindAt),
    approvalIdx: index("tasks_approval_idx").on(t.tenantId, t.approvalStatus),
  })
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

/**
 * Action point (checklist item) for a task — the concrete sub-steps needed to
 * complete it. Stored under `tasks.meta.checklist` (a JSONB grab-bag we already
 * have) so the feature needs no schema migration. Read with `taskChecklist()`.
 */
/** DST-style sub-task status (a step can be parked with someone else). */
export type SubTaskStatus = "not_started" | "in_progress" | "completed" | "assigned_to_other";

export type TaskChecklistItem = {
  id: string;
  text: string;
  done: boolean; // mirrors status === "completed" — kept for back-compat
  doneAt?: string | null;
  /** Daily-Service-Tracker per-sub-task tracking. Absent on legacy items
   *  (those fall back to the `done` flag). */
  status?: SubTaskStatus;
  actionDate?: string | null; // ISO yyyy-mm-dd
  remark?: string;
  /** Team member this sub-task is delegated to (a tenant user id). When set, the
   *  assignee is notified and can open + edit the parent task. */
  assigneeId?: string | null;
  /** Denormalised name for display (resolved when assigned). */
  assigneeName?: string | null;
};

/** Effective status of a sub-task — falls back to the legacy `done` flag. */
export function subTaskStatus(c: TaskChecklistItem): SubTaskStatus {
  return c.status ?? (c.done ? "completed" : "not_started");
}

/** Safely read a task's checklist out of its `meta` JSONB (always an array). */
export function taskChecklist(meta: unknown): TaskChecklistItem[] {
  const c = (meta as any)?.checklist;
  return Array.isArray(c) ? (c as TaskChecklistItem[]) : [];
}
