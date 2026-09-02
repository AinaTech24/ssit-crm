import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId } from "./_shared";
import { tenants } from "./tenants";

/**
 * Append-only audit trail for every consequential action.
 * Required for DPDP, SEBI inspection, and inter-team accountability.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    actorUserId: uuid("actor_user_id"),
    actorType: text("actor_type", { enum: ["user", "system", "workflow", "webhook"] })
      .notNull()
      .default("user"),

    action: text("action").notNull(), // e.g. "investor.update", "template.publish", "workflow.run.cancel"
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),

    before: jsonb("before"),
    after: jsonb("after"),
    meta: jsonb("meta"),

    /** For PII access tracking (DPDP) */
    piiAccessed: jsonb("pii_accessed"),
    reason: text("reason"),

    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),

    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    entityIdx: index("audit_entity_idx").on(t.tenantId, t.entityType, t.entityId, t.at),
    actorIdx: index("audit_actor_idx").on(t.tenantId, t.actorUserId, t.at),
    actionIdx: index("audit_action_idx").on(t.tenantId, t.action, t.at),
  })
);

export type AuditLog = typeof auditLog.$inferSelect;
