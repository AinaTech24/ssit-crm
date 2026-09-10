import { boolean, date, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";

export const tenants = pgTable(
  "tenants",
  {
    id,
    legalName: text("legal_name").notNull(),
    displayName: text("display_name").notNull(),
    // Optional — some firms are onboarded before their ARN is issued.
    arn: text("arn"),
    arnExpiryAt: date("arn_expiry_at"),
    principalEuin: text("principal_euin"),
    gstNumber: text("gst_number"),
    panNumber: text("pan_number"),
    address: jsonb("address").$type<{
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      pincode?: string;
      country?: string;
    }>(),
    phone: text("phone"),
    email: text("email"),
    website: text("website"),
    // White-label hosting (migration 0162). subdomain → "<sub>.<APP_BASE_DOMAIN>";
    // customDomain → the firm's own domain. Both globally unique when set.
    subdomain: text("subdomain"),
    customDomain: text("custom_domain"),
    customDomainVerifiedAt: timestamp("custom_domain_verified_at", { withTimezone: true }),
    primaryColor: text("primary_color").default("#1f2937"),
    secondaryColor: text("secondary_color").default("#d22e32"),
    /** Extra theme controls (migration 0128) — body text + hover/secondary
     *  surface colour. Optional hex; null = stock palette. */
    textColor: text("text_color"),
    hoverColor: text("hover_color"),
    // Deeper theming (migration 0164) — brand font + UI density. null = defaults.
    fontFamily: text("font_family"),
    uiDensity: text("ui_density"),
    logoUrl: text("logo_url"),
    faviconUrl: text("favicon_url"),
    /** Square app icon — sidebar badge / small square avatars. */
    logoIconUrl: text("logo_icon_url"),
    /** Compact monogram / "half" logo — collapsed sidebar / watermarks. */
    logoMarkUrl: text("logo_mark_url"),
    /** @deprecated — kept for back-compat. Active subscription is the source of truth now. */
    plan: text("plan", { enum: ["starter", "growth", "professional", "enterprise"] })
      .notNull()
      .default("starter"),
    planSeats: jsonb("plan_seats").$type<{ included: number; addOn: number }>().default({
      included: 1,
      addOn: 0,
    }),
    /** @deprecated — see subscriptions.status. */
    status: text("status", { enum: ["trial", "active", "past_due", "suspended", "churned"] })
      .notNull()
      .default("trial"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),

    /** Organisation profile (spec §6, Module 1) */
    aumRange: text("aum_range"), // matches master_values('aum_range') or free text
    sipBookRange: text("sip_book_range"),
    teamSize: text("team_size"),
    currentSoftwareUsed: text("current_software_used"),
    onboardingNotes: text("onboarding_notes"),

    /** Firm profile — Network FP "1.6 Firm Details" template parity. */
    legalStructure: text("legal_structure", {
      enum: [
        "sole_proprietorship",
        "partnership",
        "llp",
        "private_limited",
        "public_limited",
        "huf",
        "one_person_company",
        "other",
      ],
    }),
    incorporationDate: date("incorporation_date"),
    /** TAN — Tax deduction and collection account number. Distinct from PAN. */
    tan: text("tan"),
    /** National Distributor Code — issued by AMFI to multi-AMC distributors. */
    nationalDistributorCode: text("national_distributor_code"),
    /** Primary director's DIN (full director list is in firm_directors). */
    primaryDin: text("primary_din"),
    /** Statutory auditor. */
    auditorName: text("auditor_name"),
    auditorFrn: text("auditor_frn"), // Firm Registration Number from ICAI
    /** Firm bank account for AMC payouts / refunds. */
    bankAccount: jsonb("bank_account").$type<{
      bankName?: string;
      accountHolder?: string;
      accountNumber?: string;
      ifsc?: string;
      branch?: string;
      accountType?: "current" | "savings" | "od" | "cc";
    }>(),
    /** Authorized signatory — board-appointed person for AMC + SEBI docs. */
    authorizedSignatory: jsonb("authorized_signatory").$type<{
      name?: string;
      designation?: string;
      email?: string;
      phone?: string;
      panNumber?: string;
      din?: string;
    }>(),

    /** Public-facing */
    publicWebsiteSlug: text("public_website_slug"), // for white-label landing page
    isWhiteLabel: boolean("is_white_label").default(false),
    dataProtectionOfficer: jsonb("dpo").$type<{ name?: string; email?: string; phone?: string }>(),
    riaRegistered: boolean("ria_registered").default(false),
    featureFlags: jsonb("feature_flags").$type<Record<string, boolean>>().default({}),

    /**
     * Restrict users to the data their role entitles them to (RM = only the
     * clients assigned to them). Default false = the firm-wide behaviour every
     * tenant has had until now, so turning the wall on is a deliberate choice
     * per firm. Read by lib/investors/access.ts.
     */
    restrictUserDataScope: boolean("restrict_user_data_scope").notNull().default(false),

    /** ── AMFI DDQ firm declarations (migration 0195) ──────────────────────
     *  2.1c/2.5 — how the firm categorises client relationships. An MFD giving
     *  "incidental advice" advises only incidentally to distribution (no RIA
     *  registration, no advisory fee). */
    relationshipModel: text("relationship_model", {
      enum: ["execution_only", "incidental_advice", "advisory", "both"],
    }),
    /** 2.4c — fees charged for execution services. Must stay false for an MFD
     *  on the incidental-advice model; charging would push it into RIA territory. */
    chargesExecutionFees: boolean("charges_execution_fees").notNull().default(false),
    /** 5.8 — "AMFI-registered Mutual Fund Distributor" tagline (font ≥ 12) on
     *  every printed/electronic communication, website, app, card, signboard. */
    amfiTaglineCompliant: boolean("amfi_tagline_compliant").notNull().default(false),
    /** 5.9 — SEBI circular (Feb 2026): registered name + registration number
     *  disclosed on Social Media Platforms. */
    socialMediaDisclosureCompliant: boolean("social_media_disclosure_compliant").notNull().default(false),
    /** Days without a transaction after which a client counts as "dormant".
     *  One firm-level knob so every surface (Investors KPIs, churn report, the
     *  copilot) agrees. Default 180 (migration 0183). */
    dormancyWindowDays: integer("dormancy_window_days").notNull().default(180),
    /** Marketing frequency cap (anti-fatigue / WhatsApp-ban protection). The comms
     *  pipeline skips a marketing send to a subject who already received
     *  `marketingFreqCap` marketing messages within the trailing
     *  `marketingFreqWindowDays` days. NULL cap = disabled. */
    marketingFreqCap: integer("marketing_freq_cap").default(6),
    marketingFreqWindowDays: integer("marketing_freq_window_days").default(7),
    /** Soft delete — set by a platform admin from the super-admin panel. A
     *  non-null value hides the tenant from the list and blocks its logins. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
    ...timestamps,
  },
  (t) => ({
    arnUnique: uniqueIndex("tenants_arn_unique").on(t.arn),
  })
);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
