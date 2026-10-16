import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";
import { investors } from "./investors";

/** Standardized SEBI complaint categories (drive the register filter + monthly
 *  disclosure). Kept in sync with the create form + workspace dropdowns. */
export const SEBI_COMPLAINT_CATEGORIES = [
  { value: "service", label: "Service / TAT" },
  { value: "mis_selling", label: "Mis-selling" },
  { value: "transaction", label: "Transaction / order" },
  { value: "fee", label: "Fee / commission" },
  { value: "kyc", label: "KYC / documents" },
  { value: "communication", label: "Communication / statements" },
  { value: "other", label: "Other" },
] as const;

/** Where a complaint was received from — SEBI expects source tracking. */
export const COMPLAINT_SOURCES = [
  { value: "direct", label: "Direct (client)" },
  { value: "scores", label: "SCORES (SEBI)" },
  { value: "amfi", label: "AMFI" },
  { value: "amc", label: "AMC" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "walk_in", label: "Walk-in" },
  { value: "other", label: "Other" },
] as const;

export const serviceRequests = pgTable(
  "service_requests",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    ticketNo: text("ticket_no").notNull(),
    investorId: uuid("investor_id").references(() => investors.id),
    /**
     * Service Type — spec § Module 13 lists 13 canonical types:
     *   Nominee Update · Bank Update · Mobile Update · Email Update · KYC Update
     *   Minor to Major · Capital Gain Report · Statement Request · Redemption Request
     *   Switch Request · Transmission Case · Folio Correction · Other
     * Legacy values (complaint, redemption_help, switch_help, transaction_query)
     * are retained for back-compat with already-imported rows.
     */
    type: text("type", {
      enum: [
        // Spec-canonical (13)
        "nominee_update",
        "bank_update",
        "mobile_update",
        "email_update",
        "kyc_update",
        "minor_to_major",
        "capital_gain_report",
        "statement_request",
        "redemption_request",
        "switch_request",
        "transmission_case",
        "folio_correction",
        "other",
        "feedback",
        // Back-office operational services (Finowise MIS "Other Services")
        "iin",
        "can",
        "name_change",
        "swp",
        "swp_stop",
        "physical_kyc",
        "video_kyc",
        // Legacy
        "complaint",
        "redemption_help",
        "switch_help",
        "transaction_query",
      ],
    }).notNull(),
    channel: text("channel", { enum: ["whatsapp", "email", "phone", "in_person", "form"] }),

    subject: text("subject").notNull(),
    description: text("description"),

    status: text("status", { enum: ["open", "in_progress", "waiting_customer", "resolved", "closed", "escalated"] })
      .notNull()
      .default("open"),
    priority: text("priority", { enum: ["low", "normal", "high", "urgent"] })
      .notNull()
      .default("normal"),

    assignedToUserId: uuid("assigned_to_user_id").references(() => users.id),

    /** SLA */
    slaResponseAt: timestamp("sla_response_at", { withTimezone: true }),
    slaResolutionAt: timestamp("sla_resolution_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),

    /** SEBI complaint register-specific fields */
    sebiCategory: text("sebi_category"),
    sebiSubCategory: text("sebi_sub_category"),
    /** Where the complaint was received from + SCORES registration number. */
    complaintSource: text("complaint_source"),
    scoresRefNo: text("scores_ref_no"),

    attachments: jsonb("attachments").$type<Array<{ name: string; key: string; size: number }>>(),
    timeline: jsonb("timeline").$type<Array<{ at: string; by: string; event: string; note?: string }>>(),

    /** Client as typed (when not tied to a client record) + their code at the partner. */
    clientName: text("client_name"),
    clientCode: text("client_code"),
    /** Motilal Oswal | MF | Demat | Insurance (keys: motilal_oswal, mf, demat, insurance). */
    department: text("department"),
    /** The partner the query was raised with — from the firm-managed partner list. */
    partnerName: text("partner_name"),
    /** Mail / call updation with the partner, and the query itself. */
    partnerUpdate: text("partner_update"),

    /** Free-text RM remarks — spec § Module 13. */
    remarks: text("remarks"),
    /** Resolution write-up — spec § Module 14 Complaint Register. */
    resolutionNotes: text("resolution_notes"),
    /** Set true once an escalation notification has been raised — idempotency for the recipe. */
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    escalatedToUserId: uuid("escalated_to_user_id"),

    /** Post-resolution client satisfaction (1–5) + optional comment. */
    csatRating: integer("csat_rating"),
    csatComment: text("csat_comment"),
    csatAt: timestamp("csat_at", { withTimezone: true }),

    ...timestamps,
  },
  (t) => ({
    statusIdx: index("svc_status_idx").on(t.tenantId, t.status),
    slaIdx: index("svc_sla_idx").on(t.tenantId, t.slaResolutionAt),
    ticketIdx: index("svc_ticket_idx").on(t.tenantId, t.ticketNo),
    investorIdx: index("svc_investor_idx").on(t.tenantId, t.investorId),
  })
);

export type ServiceRequest = typeof serviceRequests.$inferSelect;
