import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { branches } from "./branches";

export const users = pgTable(
  "users",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    branchId: uuid("branch_id").references(() => branches.id),
    /** Sub-branch desk this user belongs to (FK desks.id, enforced in migration
     *  0101). Drives the Branch → Desk → RM roll-up in the monthly MIS reports. */
    deskId: uuid("desk_id"),
    email: text("email").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    passwordHash: text("password_hash"),
    avatarUrl: text("avatar_url"),

    /** Stacked roles. A user is often owner + RM + compliance simultaneously.
     *  'platform_admin' is reserved for Equitywala staff who manage the SaaS itself.
     *  'platform_admin' users always have tenant_id = PLATFORM_TENANT_ID. */
    roles: text("roles", {
      enum: [
        "platform_admin",
        "platform_support",
        "owner",
        "compliance",
        "branch_head",
        "rm",
        "back_office",
        "ops",
        "marketing",
        "assistant",
        "gifting_hr",
        "branch_head",
        "sub_broker",
        "ra_research",
        "ra_sales",
        "ria",
        "insurance",
        "investor",
      ],
    })
      .array()
      .notNull()
      .default(["rm"]),

    /**
     * Module 19 spec — Department this employee belongs to. Separate from
     * `roles` because a user can be (e.g.) RM + Compliance but belong to a
     * single department for reporting / target-rollup purposes.
     */
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

    /** Date the employee joined the firm (separate from invitedAt/activatedAt). */
    joiningDate: date("joining_date"),

    /** Reporting line — points at another user in the same tenant. */
    reportingManagerId: uuid("reporting_manager_id"),

    /** Annual sales/AUM target in ₹ (used by RM-wise business report). */
    annualTarget: numeric("annual_target", { precision: 18, scale: 2 }),
    /** Monthly SIP-mobilisation target in ₹ (used by SIP book report). */
    sipMonthlyTarget: numeric("sip_monthly_target", { precision: 18, scale: 2 }),
    /** Monthly target: # of NEW (prospecting) meetings — review_meetings.category='new'. */
    newMeetingsMonthlyTarget: integer("new_meetings_monthly_target"),
    /** Monthly target: # of RENEWAL / review meetings — review_meetings.category='review'. */
    renewalMeetingsMonthlyTarget: integer("renewal_meetings_monthly_target"),

    /** Free-form HR / manager notes. */
    notes: text("notes"),

    /**
     * HR-side employee code — distinct from the system UUID. Optional
     * but unique within a tenant when set (partial unique index in
     * migration 0018).
     */
    employeeCode: text("employee_code"),

    /**
     * AMC codes the employee is authorised to distribute. Used by:
     *   - the ARN/EUIN compliance report ("can this RM sell HDFC MF?")
     *   - the transaction-execution gate when we wire BSE Star MF.
     * Format: an array of AMC short-codes (e.g. ['HDFC','ICICI','SBI']).
     */
    distributingAmcs: jsonb("distributing_amcs").$type<string[]>(),

    euin: text("euin"),
    /** EUIN expiry — tracked separately even though it's tied to NISM,
     *  because the renewal flow with AMFI is independent. */
    euinExpiryAt: date("euin_expiry_at"),

    nismCertificateNo: text("nism_cert_no"),
    /** Date the employee passed the NISM-VA exam. */
    nismExamDate: date("nism_exam_date"),
    nismExpiryAt: date("nism_expiry_at"),
    nismCategory: text("nism_category"), // V-A, V-B, etc.

    /**
     * Per-employee personal ARN — distinct from the firm's ARN on the
     * tenant row. Used when the firm registers individual ARNs for
     * senior RMs or sub-distributors (legitimately mapped to commission
     * payouts in the brokerage reconciler).
     */
    personalArn: text("personal_arn"),
    arnRegistrationDate: date("arn_registration_date"),
    arnExpiryAt: date("arn_expiry_at"),

    /**
     * Digital Signature Certificate — required for BSE Star MF / NSE NMF
     * II execution. Track submission status + last filed date + expiry
     * (DSCs have 1-2 year validity).
     */
    dscSubmitted: boolean("dsc_submitted").default(false),
    dscLastSubmittedAt: date("dsc_last_submitted_at"),
    dscExpiryAt: date("dsc_expiry_at"),

    territory: jsonb("territory").$type<{ states?: string[]; cities?: string[]; pincodes?: string[] }>(),

    twoFaEnabled: boolean("two_fa_enabled").default(false),
    /** Base32 TOTP shared secret. Set (with twoFaEnabled=false) during
     *  enrollment; twoFaEnabled flips true once the first code is verified. */
    twoFaSecret: text("two_fa_secret"),
    /** bcrypt-hashed one-time recovery codes (login when the authenticator
     *  device is lost). Each is consumed on use. */
    twoFaBackupCodes: jsonb("two_fa_backup_codes").$type<string[]>(),
    permissions: jsonb("permissions").$type<string[]>(),
    /**
     * Per-user sidebar module access (Module-19 access control). NULL = inherit
     * the full set of modules the tenant has (no restriction). An array =
     * restrict this team member to exactly these module keys (always ∩ the
     * tenant's enabled modules). Owners always get the full tenant set
     * regardless. Set by the MFD owner in the employee form; gated in the
     * dashboard layout sidebar. See src/lib/platform.ts ALL_MODULES.
     */
    enabledModules: jsonb("enabled_modules").$type<string[]>(),
    /**
     * Per-user BRANCH data access (migration 0216). NULL / empty = the default
     * wall: this user sees only the records assigned to them. A list of branch
     * ids = they additionally see EVERY record in those branches, whoever owns
     * it. Roles owner / back_office / ops ignore this and see all branches.
     * Set by the firm admin in the employee form; enforced in
     * src/lib/auth/data-scope.ts.
     */
    allowedBranches: jsonb("allowed_branches").$type<string[]>(),
    /**
     * Explicit "only their own records" override (migration 0222). Beats the
     * implicit branch_head widening and any allowed_branches grant — for the
     * RM who also holds branch_head for administrative reasons and must still
     * only see their own book. Owner is unaffected.
     */
    restrictToOwnRecords: boolean("restrict_to_own_records").notNull().default(false),
    /**
     * Per-user CALENDAR DELEGATION (migration 0220). The colleagues whose
     * meetings this user handles — an EA/front-desk who runs one partner's
     * diary. NULL / empty = none. A list of user ids = this user additionally
     * sees and may create, edit and cancel meetings owned by those people,
     * WITHOUT being handed the firm's or a branch's whole book the way
     * review_meeting.manage.all / allowedBranches would.
     * Set by the firm admin in the employee form; enforced in
     * src/lib/auth/data-scope.ts (loadDelegatedUserIds).
     */
    delegatesFor: jsonb("delegates_for").$type<string[]>(),
    customLeaveEntitlements: jsonb("custom_leave_entitlements").$type<Record<string, number>>(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    /**
     * Session revocation epoch. Any session JWT whose `iat` predates this
     * timestamp is rejected by getSession() (see src/lib/auth/revocation.ts).
     * Stamped to now() on offboarding and forced password reset so a
     * terminated user's still-valid token dies on the next request instead of
     * lingering until its 8h TTL.
     */
    sessionsInvalidAfter: timestamp("sessions_invalid_after", { withTimezone: true }),
    status: text("status", { enum: ["invited", "active", "suspended", "offboarding", "offboarded"] })
      .notNull()
      .default("invited"),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    offboardedAt: timestamp("offboarded_at", { withTimezone: true }),
    /** Self-serve signup verification. null = email not yet confirmed. */
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    /**
     * Soft-delete → Trash. Set when an owner/admin moves the employee to Trash
     * (an alternative to offboarding). A row with deletedAt set is hidden from
     * the team list and blocked at login; restoring clears it. Distinct from
     * offboardedAt, which is the formal HR exit (redistributes clients).
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
    ...timestamps,
  },
  (t) => ({
    emailUnique: uniqueIndex("users_tenant_email_unique").on(t.tenantId, t.email),
    deptIdx: index("users_tenant_department_idx").on(t.tenantId, t.department, t.status),
    managerIdx: index("users_reporting_manager_idx").on(t.tenantId, t.reportingManagerId),
    deletedIdx: index("users_tenant_deleted_idx").on(t.tenantId, t.deletedAt),
  })
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
