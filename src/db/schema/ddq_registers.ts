/**
 * AMFI DDQ compliance registers (migration 0195).
 *
 * The operational records the Due Diligence Questionnaire demands but the CRM
 * had nowhere to store. Each table maps to a DDQ question:
 *   dsc_declarations     → 4.26  annual Declaration of Self-Certification
 *   compliance_incidents → 4.17/4.18 mis-selling, 4.20b third-party payment,
 *                          6.1 regulatory action, 6.2 litigation,
 *                          6.3 ARN/EUIN suspension + warning letters
 *   unsuitability_acks   → 2.4b  unsuitability comms + client acknowledgement
 *                          + "execution only notwithstanding" confirmation
 */

import { boolean, date, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";

export const DSC_SUBJECT_TYPES = ["self", "sub_distributor"] as const;
export const DSC_STATUSES = ["pending", "submitted", "acknowledged"] as const;

/** DDQ 4.26 — annual Declaration of Self-Certification (own ARN + each sub-distributor). */
export const dscDeclarations = pgTable(
  "dsc_declarations",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    /** Financial year the declaration covers, e.g. "2026-27". */
    financialYear: text("financial_year").notNull(),
    subjectType: text("subject_type", { enum: DSC_SUBJECT_TYPES }).notNull().default("self"),
    subDistributorId: uuid("sub_distributor_id"),
    subjectName: text("subject_name"),
    arn: text("arn"),
    status: text("status", { enum: DSC_STATUSES }).notNull().default("pending"),
    submittedOn: date("submitted_on"),
    documentUrl: text("document_url"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => ({
    tenantFyIdx: index("dsc_tenant_fy_idx").on(t.tenantId, t.financialYear),
  })
);

export const INCIDENT_KINDS = [
  "misselling",
  "third_party_payment",
  "regulatory_action",
  "litigation",
  "arn_euin_suspension",
  "warning_letter",
] as const;
export const INCIDENT_STATUSES = ["open", "under_review", "resolved", "closed"] as const;

/** One register for every "has anything gone wrong?" DDQ question. */
export const complianceIncidents = pgTable(
  "compliance_incidents",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    kind: text("kind", { enum: INCIDENT_KINDS }).notNull(),
    occurredOn: date("occurred_on").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    investorId: uuid("investor_id"),
    employeeUserId: uuid("employee_user_id"),
    amcName: text("amc_name"),
    /** 4.20b — a third-party payment must be reported to the concerned AMC. */
    reportedToAmc: boolean("reported_to_amc").notNull().default(false),
    reportedOn: date("reported_on"),
    status: text("status", { enum: INCIDENT_STATUSES }).notNull().default("open"),
    remedialAction: text("remedial_action"),
    resolution: text("resolution"),
    closedOn: date("closed_on"),
    documentUrl: text("document_url"),
    ...timestamps,
  },
  (t) => ({
    tenantKindIdx: index("comp_incidents_tenant_kind_idx").on(t.tenantId, t.kind, t.occurredOn),
  })
);

/**
 * DDQ 2.4b — when a product looks unsuitable, the MFD must communicate that in
 * writing, get it acknowledged, and obtain the client's confirmation that the
 * transaction is "execution only" notwithstanding. This is the mis-selling
 * defence; without the record it's the MFD's word against the investor's.
 */
export const unsuitabilityAcks = pgTable(
  "unsuitability_acks",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    investorId: uuid("investor_id").notNull(),
    schemeName: text("scheme_name"),
    transactionRef: text("transaction_ref"),
    reason: text("reason").notNull(),
    communicatedOn: date("communicated_on").notNull(),
    channel: text("channel"),
    clientAcknowledged: boolean("client_acknowledged").notNull().default(false),
    acknowledgedOn: date("acknowledged_on"),
    executionOnlyConfirmed: boolean("execution_only_confirmed").notNull().default(false),
    confirmedOn: date("confirmed_on"),
    documentUrl: text("document_url"),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id"),
    ...timestamps,
  },
  (t) => ({
    tenantInvestorIdx: index("unsuit_tenant_investor_idx").on(t.tenantId, t.investorId),
  })
);
