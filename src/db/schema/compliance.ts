import { date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";

/**
 * Per-tenant compliance documents — DDQ, AMC empanelment, SOPs, etc.
 * Files stored in S3, this table is the index.
 */
export const complianceDocuments = pgTable(
  "compliance_documents",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    category: text("category", {
      enum: [
        "arn",
        "euin",
        "nism",
        "kyd",
        "amc_empanelment",
        "ddq",
        "sop",
        "complaint",
        "marketing_approval",
        "audit_report",
        "ria_compliance",
        "other",
      ],
    }).notNull(),
    name: text("name").notNull(),
    description: text("description"),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: text("size_bytes"),
    issuedOn: date("issued_on"),
    expiresOn: date("expires_on"),
    /** Sub-key for AMC empanelment, EUIN holder, etc. */
    relatedEntityType: text("related_entity_type"),
    relatedEntityId: uuid("related_entity_id"),
    tags: jsonb("tags").$type<string[]>().default([]),
    uploadedByUserId: uuid("uploaded_by_user_id"),
    /** Versioning: when this doc is replaced, points to the newer row's id (and
     *  this row is hidden from the vault). NULL = current/active. */
    supersededById: uuid("superseded_by_id"),
    version: integer("version").default(1),
    ...timestamps,
  },
  (t) => ({
    categoryIdx: index("compliance_docs_category_idx").on(t.tenantId, t.category),
    expiryIdx: index("compliance_docs_expiry_idx").on(t.tenantId, t.expiresOn),
    activeIdx: index("compliance_docs_active_idx").on(t.tenantId, t.createdAt),
  })
);

/**
 * DDQ readiness score, computed nightly.
 */
export const ddqScores = pgTable(
  "ddq_scores",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
    overallScore: numeric("overall_score", { precision: 5, scale: 2 }),
    breakdown: jsonb("breakdown").$type<{
      nismValidity: number;
      arnRenewalStatus: number;
      kydCompleteness: number;
      complaintRegisterCurrency: number;
      empanelmentCompleteness: number;
      sopSignoffCoverage: number;
      auditTrailIntegrity: number;
      [key: string]: number;
    }>(),
    findings: jsonb("findings"),
  },
  (t) => ({
    tenantIdx: index("ddq_scores_tenant_idx").on(t.tenantId, t.computedAt),
  })
);

/**
 * SOP library — versioned, with read-acknowledgement tracking.
 */
export const sops = pgTable(
  "sops",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    key: text("key").notNull(),
    title: text("title").notNull(),
    category: text("category"),
    currentVersionId: uuid("current_version_id"),
    requiredRoles: text("required_roles").array().default([]),
    // Soft-delete — preserves versions + acknowledgement evidence (migration 0150).
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
    ...timestamps,
  },
  (t) => ({
    keyUnique: uniqueIndex("sops_tenant_key_unique").on(t.tenantId, t.key),
  })
);

export const sopVersions = pgTable("sop_versions", {
  id,
  sopId: uuid("sop_id")
    .notNull()
    .references(() => sops.id, { onDelete: "cascade" }),
  tenantId: tenantId.references(() => tenants.id),
  versionNumber: text("version_number").notNull(),
  body: jsonb("body").notNull(), // rich text / blocks
  effectiveFrom: date("effective_from"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedByUserId: uuid("published_by_user_id"),
  ...timestamps,
});

export const sopAcknowledgements = pgTable(
  "sop_acknowledgements",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    sopVersionId: uuid("sop_version_id").notNull(),
    userId: uuid("user_id").notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).defaultNow().notNull(),
    evidence: jsonb("evidence"),
  },
  (t) => ({
    // One acknowledgement per (version, user) — keeps the DDQ sign-off score honest.
    versionUserUnique: uniqueIndex("sop_ack_version_user_unique").on(t.sopVersionId, t.userId),
  })
);

export type ComplianceDocument = typeof complianceDocuments.$inferSelect;
export type DdqScore = typeof ddqScores.$inferSelect;
export type Sop = typeof sops.$inferSelect;
export type SopVersion = typeof sopVersions.$inferSelect;
