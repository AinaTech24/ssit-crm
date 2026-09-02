/**
 * Package master + subscription tracking.
 *
 * SSIT (platform admin) defines packages. Each tenant has a subscription
 * pointing at one package + a license status. The subscription drives
 * module gating, seat limits, storage limits, and billing state.
 *
 * Packages live in the platform scope (no tenant_id). Subscriptions are
 * 1:1 with tenants (one active subscription per tenant at a time).
 */

import { boolean, decimal, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

/**
 * Platform-scoped (no tenant_id). Created and edited by SSIT super admin.
 */
export const packages = pgTable(
  "packages",
  {
    id,
    /** Stable key referenced by code + UI gating. Lowercase, underscore-safe. */
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),

    /** Pricing — in paise (₹1 = 100 paise) to avoid float issues. */
    monthlyPricePaise: integer("monthly_price_paise").notNull().default(0),
    yearlyPricePaise: integer("yearly_price_paise").notNull().default(0),
    /** One-time onboarding / setup fee charged once at tenant creation. */
    setupCostPaise: integer("setup_cost_paise").notNull().default(0),

    /** Per-user (per-seat) recurring fee — what an MFD pays to add one staff
     *  seat beyond the base. Monthly + yearly variants so each billing cycle
     *  can carry its own rate (e.g. ₹2,500/user/month vs ₹15,000/user/year). */
    perUserMonthlyPaise: integer("per_user_monthly_paise").notNull().default(0),
    perUserYearlyPaise: integer("per_user_yearly_paise").notNull().default(0),

    /** Limits */
    maxUsers: integer("max_users").notNull().default(1),
    maxInvestors: integer("max_investors").notNull().default(100),
    storageLimitGb: integer("storage_limit_gb").notNull().default(5),
    trialDays: integer("trial_days").notNull().default(14),

    /**
     * Module flags — each module the SaaS exposes has a boolean.
     * The sidebar + page guards check these.
     * Modules currently supported (extend over time):
     *   crm, automation, broadcasts, ai_assistant, video_sessions,
     *   white_label, custom_reports, sub_distributor, audit_log, ddq
     */
    enabledModules: jsonb("enabled_modules").$type<string[]>().notNull().default([]),

    /**
     * Modules offered as a PAID ADD-ON (not free with the base package). Each
     * carries its own recurring price. A module here is purchasable on top of
     * the package; a module in `enabledModules` is free; a module in neither is
     * not offered. Prices in paise.
     */
    addonModules: jsonb("addon_modules")
      .$type<Array<{ module: string; monthlyPaise: number; yearlyPaise: number }>>()
      .notNull()
      .default([]),

    /**
     * GRANULAR per-feature access — keyed by sidebar-feature key (nav href, see
     * src/config/nav-access.ts). When non-empty, this is the source of truth for
     * what the package unlocks (takes precedence over the coarse enabled_modules
     * in nav gating). Empty = legacy package, coarse modules apply.
     */
    enabledFeatures: jsonb("enabled_features").$type<string[]>().notNull().default([]),

    /** Features offered as a PAID ADD-ON, each with its own recurring price. */
    addonFeatures: jsonb("addon_features")
      .$type<Array<{ key: string; monthlyPaise: number; yearlyPaise: number }>>()
      .notNull()
      .default([]),

    /** Feature flags within enabled modules (e.g. ai_tier: 'tier1' | 'tier2' | 'tier3') */
    featureFlags: jsonb("feature_flags").$type<Record<string, any>>().default({}),

    /** Display + lifecycle */
    sortOrder: integer("sort_order").default(0),
    isActive: boolean("is_active").notNull().default(true),
    isPublic: boolean("is_public").notNull().default(true), // false = invite-only / custom
    badge: text("badge"), // e.g. "Most Popular"

    ...timestamps,
  },
  (t) => ({
    keyUnique: uniqueIndex("packages_key_unique").on(t.key),
    activeIdx: index("packages_active_idx").on(t.isActive, t.sortOrder),
  })
);

/**
 * One subscription per tenant. SSIT suspends/activates via the status field.
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id,
    tenantId: tenantId, // 1:1 with tenant
    packageId: uuid("package_id")
      .notNull()
      .references(() => packages.id),
    packageKey: text("package_key").notNull(), // denormalized for fast reads + sidebar gating

    status: text("status", {
      // "pending" = brand-new self-serve tenant that hasn't chosen/paid for a
      // plan yet (onboarding). Text column, so no DB migration needed.
      enum: ["pending", "trial", "active", "past_due", "suspended", "expired", "cancelled"],
    })
      .notNull()
      .default("trial"),

    billingCycle: text("billing_cycle", { enum: ["monthly", "yearly", "custom"] }).default("yearly"),

    /** License window */
    licenseStartAt: timestamp("license_start_at", { withTimezone: true }).defaultNow(),
    licenseEndAt: timestamp("license_end_at", { withTimezone: true }),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    nextRenewalAt: timestamp("next_renewal_at", { withTimezone: true }),

    /** Seat & resource overrides (null = use package defaults) */
    seatsOverride: integer("seats_override"),
    storageOverrideGb: integer("storage_override_gb"),
    modulesOverride: jsonb("modules_override").$type<string[]>(),
    allowedFields: jsonb("allowed_fields").$type<string[]>(),
    /**
     * Per-tenant feature-flag override (migration 0163). Merged ON TOP of the
     * package's feature_flags in loadTenantLicense, so a single capability can
     * be toggled for one firm without changing its package. NULL = inherit.
     */
    featureFlagsOverride: jsonb("feature_flags_override").$type<Record<string, any>>(),
    /**
     * Admin → MFD sidebar access (Module-19). The exact set of sidebar nav
     * hrefs this firm can open (see src/config/nav-access.ts). NULL = the
     * package-module default (legacy behaviour). Set by SSIT platform admins.
     */
    allowedNav: jsonb("allowed_nav").$type<string[]>(),
    /**
     * Admin → MFD dashboard-widget access. The exact set of dashboard home
     * cards/sections this firm can see (see src/config/dashboard-widgets.ts).
     * NULL = all widgets visible (default). An array = exactly these widget
     * keys are shown, everything else hidden. Set by SSIT platform admins.
     */
    allowedDashboardWidgets: jsonb("allowed_dashboard_widgets").$type<string[]>(),

    /** Billing — Razorpay recurring auto-debit. */
    razorpayCustomerId: text("razorpay_customer_id"),
    razorpaySubscriptionId: text("razorpay_subscription_id"),
    razorpayPlanId: text("razorpay_plan_id"),
    /** e-mandate state: none | pending | active | failed */
    mandateStatus: text("mandate_status").notNull().default("none"),
    /** Consecutive auto-debit failures — drives retry-then-suspend dunning. */
    failedPaymentCount: integer("failed_payment_count").notNull().default(0),
    lastPaymentAt: timestamp("last_payment_at", { withTimezone: true }),
    lastPaymentPaise: integer("last_payment_paise"),

    /** Set by SSIT when manually intervening */
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspendedReason: text("suspended_reason"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledReason: text("cancelled_reason"),

    /** Free-form notes from SSIT */
    notes: text("notes"),

    ...timestamps,
  },
  (t) => ({
    tenantUnique: uniqueIndex("subscriptions_tenant_unique").on(t.tenantId),
    statusIdx: index("subscriptions_status_idx").on(t.status),
    renewalIdx: index("subscriptions_renewal_idx").on(t.nextRenewalAt),
  })
);

/**
 * Append-only license event log — every status change is recorded.
 * Used for audit + SSIT's tenant-history view.
 */
export const subscriptionEvents = pgTable(
  "subscription_events",
  {
    id,
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    tenantId: tenantId,
    eventType: text("event_type", {
      enum: [
        "created",
        "trial_started",
        "activated",
        "renewed",
        "upgraded",
        "downgraded",
        "suspended",
        "reactivated",
        "expired",
        "cancelled",
        "payment_received",
        "payment_failed",
        "license_extended",
      ],
    }).notNull(),
    actor: text("actor"), // 'ssit_admin:<userId>' | 'system' | 'razorpay_webhook'
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    fromPackage: text("from_package"),
    toPackage: text("to_package"),
    amountPaise: integer("amount_paise"),
    notes: text("notes"),
    meta: jsonb("meta"),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    subIdx: index("sub_events_subscription_idx").on(t.subscriptionId, t.at),
    tenantIdx: index("sub_events_tenant_idx").on(t.tenantId, t.at),
  })
);

/**
 * Support tickets raised by MFDs to SSIT. Different from service_requests
 * (which are inside an MFD between client and firm).
 */
export const supportTickets = pgTable(
  "support_tickets",
  {
    id,
    tenantId: tenantId,
    raisedByUserId: uuid("raised_by_user_id"),
    subject: text("subject").notNull(),
    description: text("description"),
    category: text("category", {
      enum: ["bug", "feature_request", "billing", "training", "integration", "data_help", "other"],
    })
      .notNull()
      .default("other"),
    priority: text("priority", { enum: ["low", "normal", "high", "urgent"] })
      .notNull()
      .default("normal"),
    status: text("status", {
      enum: ["open", "in_progress", "waiting_customer", "resolved", "closed"],
    })
      .notNull()
      .default("open"),
    assignedToPlatformAdmin: uuid("assigned_to_platform_admin"),
    resolution: text("resolution"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    attachments: jsonb("attachments").$type<Array<{ name: string; key: string; size: number }>>(),
    ...timestamps,
  },
  (t) => ({
    statusIdx: index("support_tickets_status_idx").on(t.status, t.priority),
    tenantIdx: index("support_tickets_tenant_idx").on(t.tenantId, t.createdAt),
  })
);

export type Package = typeof packages.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type SubscriptionEvent = typeof subscriptionEvents.$inferSelect;
export type SupportTicket = typeof supportTickets.$inferSelect;
