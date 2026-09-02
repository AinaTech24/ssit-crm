/**
 * Daily ops scanner — runs once per day per tenant and emits the events
 * that drive the pre-built recipes (birthday, anniversary, minor-to-major,
 * dormancy, data gaps). Recipes are graph-only; they don't know to fire
 * themselves. This worker is the "when".
 *
 * Events emitted (consumed by recipes via workflow_triggers):
 *
 *   investor.birthday              — DOB matches today, age >= 18
 *   investor.anniversary           — onboardedAt matches today, > 1 yr ago
 *   investor.minor_to_major        — DOB + 18 years <= today, category='minor'
 *   investor.dormant               — no transaction in last 365 days,
 *                                    not already flagged
*   investor.kyc_expiring          — CKYC expiry within 30 days
 *   investor.risk_profile_expired  — risk profile signed > 365 days ago
 *   goal.drift                     — an investor's goal is >10pp behind its
 *                                    time-trajectory (one per investor/day)
 *   insurance.premium_due          — a policy's premium is due in 15/7/1 days
 *   insurance.lapsed               — an active policy passed grace unpaid (once)
 *   sip.expiring                   — an active SIP ends in 30/15/7 days (renewal)
 *   mandate.expiring               — a NACH mandate expires in 90/60/30 days
 *   employee.nism_expiring         — NISM expiry within 90 days
 *   employee.arn_expiring          — personal ARN expiry within 90 days
 *   employee.euin_expiring         — EUIN expiry within 90 days
 *   employee.dsc_expiring          — DSC expiry within 60 days
 *   sub_distributor.nism_expiring  — sub-dist NISM within 90 days
 *   sub_distributor.arn_expiring   — sub-dist ARN within 90 days
 *   sub_distributor.euin_expiring  — sub-dist EUIN within 90 days
 *   legal_registration.expiring    — statutory registration within 90 days
 *   document.expiring              — a vault document expires within 30 days
 *   document.expired               — a vault document has lapsed
 *
 * Idempotency: each event carries `meta.source = 'daily-ops-scanner'` and
 * `meta.scanDate = YYYY-MM-DD`. A partial unique index
 * (events_outbox_scanner_dedup_idx, migration 0031) enforces uniqueness on
 * (tenant_id, kind, entity_id, scanDate) for scanner rows, and every INSERT
 * below uses ON CONFLICT DO NOTHING — so a second run on the same day is a
 * no-op at the write layer (no duplicate events ever reach the poller).
 *
 * Schedule: invoked by the master scheduler at 06:30 local time. The
 * worker pages through all active tenants, runs each scan with a
 * 30-second budget, and logs metrics per scan.
 *
 * Cost: at 500 tenants × 10K clients = 5M rows. Each scan is a single
 * tenant-scoped query with the appropriate index; budget < 5 ms each.
 * Total daily run: ~25 seconds for 500 tenants.
 */

import { eq, sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { readSoftDeleteRetentionDays } from "@/lib/platform/retention";
import { recomputeAllHealth } from "@/lib/investors/health-persist";
import { recomputeAllFamilyHealth } from "@/lib/families/health-persist";
import { recomputeAllGoals } from "@/lib/goal-planning/recompute";
import { recomputeCombinedAum, revalueAllFolios } from "@/lib/finance/aum-persist";
import { eventsOutbox, investors, folios, suitabilityMatrixEntries } from "@/db/schema";

interface ScanResult {
  tenantId: string;
  birthday: number;
  anniversary: number;
  minorToMajor: number;
  dormant: number;
  kycExpiring: number;
  riskExpired: number;
  /** Compliance-vault documents expiring within 30 days. */
  docsExpiring: number;
  /** Compliance-vault documents that have already lapsed (one-time event). */
  docsExpired: number;
  // Employee-level licensing (Network FP template parity).
  nismExpiring: number;
  arnExpiring: number;
  euinExpiring: number;
  dscExpiring: number;
  // Sub-distributor licensing — same expiry-tracking model.
  subDistNismExpiring: number;
  subDistArnExpiring: number;
  subDistEuinExpiring: number;
  legalRegExpiring: number;
  /** Investors whose persisted health score was refreshed this run. */
  healthScored: number;
  /** Families whose persisted health score was refreshed this run. */
  familyHealthScored: number;
  /** Goals whose progress/required-SIP/status were refreshed this run. */
  goalsRecomputed: number;
  /** Investors whose stored AUM was re-valued against live NAV this run. */
  aumRevalued: number;
  /** Folios whose holdings were repriced at live NAV this run. */
  foliosRevalued: number;
  /** `goal.drift` events emitted this run (one per investor with a behind goal). */
  goalDrift: number;
  /** `insurance.premium_due` events emitted (one per investor at a milestone). */
  premiumDue: number;
  /** `insurance.lapsed` events emitted (one per newly-lapsed policy). */
  policyLapsed: number;
  /** `sip.expiring` events emitted (one per investor at a milestone). */
  sipExpiring: number;
  /** `mandate.expiring` events emitted (one per investor at a milestone). */
  mandateExpiring: number;
  /** Service requests escalated this run (resolution OR response SLA breach). */
  srEscalated: number;
  /** Attendance rows auto-seeded for today (week-off/on-leave/absent). */
  attendanceSeeded: number;
  /** Active clients whose portfolios drifted from their risk profiles. */
  portfolioRiskDrift: number;
  /** Automation-health alerts raised this run (stuck outbox / overdue jobs / failed runs). */
  automationAlerts: number;
  durationMs: number;
}

/**
 * Returns the list of active tenants to scan. System context — we
 * deliberately bypass RLS here because the worker iterates every
 * tenant. This is the same pattern the outbox poller + segment
 * materialiser use.
 */
async function listActiveTenants(): Promise<string[]> {
  return await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT id FROM tenants
      WHERE status IN ('active', 'trial')
    `);
    return (r.rows as Array<{ id: string }>).map((row) => row.id);
  });
}

/**
 * Run all six scans for one tenant. Each scan is its own SQL — kept
 * tenant-scoped via withTenant so RLS gives defense-in-depth even
 * though the outer loop is system-context.
 *
 * The scanDate string is the key for idempotency. Two runs on the same
 * day for the same tenant try to emit the same events; the partial unique
 * index + ON CONFLICT DO NOTHING on each INSERT silently drops the repeats.
 */
export async function scanTenant(tenantId: string): Promise<ScanResult> {
  const startedAt = Date.now();
  const scanDate = new Date().toISOString().slice(0, 10);
  const result: ScanResult = {
    tenantId,
    birthday: 0,
    anniversary: 0,
    minorToMajor: 0,
    dormant: 0,
    kycExpiring: 0,
    riskExpired: 0,
    docsExpiring: 0,
    docsExpired: 0,
    nismExpiring: 0,
    arnExpiring: 0,
    euinExpiring: 0,
    dscExpiring: 0,
    subDistNismExpiring: 0,
    subDistArnExpiring: 0,
    subDistEuinExpiring: 0,
    legalRegExpiring: 0,
    healthScored: 0,
    familyHealthScored: 0,
    goalsRecomputed: 0,
    aumRevalued: 0,
    foliosRevalued: 0,
    goalDrift: 0,
    premiumDue: 0,
    policyLapsed: 0,
    sipExpiring: 0,
    mandateExpiring: 0,
    srEscalated: 0,
    attendanceSeeded: 0,
    portfolioRiskDrift: 0,
    automationAlerts: 0,
    durationMs: 0,
  };

  await withTenant(
    tenantId,
    async (tx) => {
      // ── 1. Birthdays today (age >= 18) ────────────────────────────────
      // Also pulls the client's birthday-gift budget + what's been logged as
      // given this year (client_gifts has no Drizzle schema — raw SQL only),
      // so the RM's task carries the budget status inline.
      const birthdayRows = await tx.execute(sql`
        SELECT i.id, i.name, i.dob, i.rm_id,
               i.birthday_gift_budget AS gift_budget,
               COALESCE((
                 SELECT SUM(g.amount)::int FROM client_gifts g
                 WHERE g.tenant_id = i.tenant_id AND g.investor_id = i.id
                   AND g.occasion = 'birthday'
                   AND EXTRACT(YEAR FROM g.given_on) = EXTRACT(YEAR FROM CURRENT_DATE)
               ), 0) AS gift_spent
        FROM investors i
        WHERE i.dob IS NOT NULL
          AND i.status = 'active'
          AND i.deleted_at IS NULL
          AND EXTRACT(MONTH FROM i.dob) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(DAY   FROM i.dob) = EXTRACT(DAY   FROM CURRENT_DATE)
          AND (CURRENT_DATE - i.dob) / 365 >= 18
      `);
      result.birthday = birthdayRows.rows.length;
      // Fallback assignee when a client has no RM: the firm owner/branch head.
      let birthdayFallbackAssignee: string | null = null;
      if (birthdayRows.rows.length > 0) {
        const owner = await tx.execute(sql`
          SELECT id FROM users
          WHERE tenant_id = ${tenantId}::uuid AND roles && ARRAY['owner','branch_head']::text[]
          ORDER BY created_at ASC LIMIT 1
        `);
        birthdayFallbackAssignee = ((owner.rows[0] as any)?.id as string) ?? null;
      }
      for (const row of birthdayRows.rows as Array<{
        id: string;
        name: string;
        dob: string;
        rm_id: string | null;
        gift_budget: number | null;
        gift_spent: number | string;
      }>) {
        await tx.insert(eventsOutbox).values({
          tenantId,
          kind: "investor.birthday",
          entityType: "investor",
          entityId: row.id,
          after: { name: row.name, dob: row.dob, rmId: row.rm_id } as any,
          meta: { scanDate, source: "daily-ops-scanner" } as any,
        } as any).onConflictDoNothing();

        // NOTE: auto birthday follow-up TASK creation is disabled per firm
        // preference. The investor.birthday EVENT above still fires (so
        // WhatsApp/email birthday wishes via recipes keep working) — we simply
        // no longer auto-create a task in the Tasks list for each birthday.
      }

      // ── 2. Anniversaries — onboardedAt matches today, > 1 yr ago ──────
      const anniversaryRows = await tx.execute(sql`
        SELECT id, name, onboarded_at, rm_id FROM investors
        WHERE onboarded_at IS NOT NULL
          AND status = 'active'
          AND deleted_at IS NULL
          AND EXTRACT(MONTH FROM onboarded_at) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(DAY   FROM onboarded_at) = EXTRACT(DAY   FROM CURRENT_DATE)
          AND onboarded_at < CURRENT_DATE - INTERVAL '1 year'
      `);
      result.anniversary = anniversaryRows.rows.length;
      for (const row of anniversaryRows.rows as Array<{
        id: string;
        name: string;
        onboarded_at: string;
        rm_id: string | null;
      }>) {
        await tx.insert(eventsOutbox).values({
          tenantId,
          kind: "investor.anniversary",
          entityType: "investor",
          entityId: row.id,
          after: { name: row.name, onboardedAt: row.onboarded_at, rmId: row.rm_id } as any,
          meta: { scanDate, source: "daily-ops-scanner" } as any,
        } as any).onConflictDoNothing();
      }

      // ── 3. Minor → Major (turned 18, still flagged minor) ─────────────
      const minorRows = await tx.execute(sql`
        SELECT id, name, dob, rm_id FROM investors
        WHERE investor_category = 'minor'
          AND deleted_at IS NULL
          AND dob IS NOT NULL
          AND dob + INTERVAL '18 years' <= CURRENT_DATE
      `);
      result.minorToMajor = minorRows.rows.length;
      for (const row of minorRows.rows as Array<{
        id: string;
        name: string;
        dob: string;
        rm_id: string | null;
      }>) {
        await tx.insert(eventsOutbox).values({
          tenantId,
          kind: "investor.minor_to_major",
          entityType: "investor",
          entityId: row.id,
          after: { name: row.name, dob: row.dob, rmId: row.rm_id } as any,
          meta: { scanDate, source: "daily-ops-scanner" } as any,
        } as any).onConflictDoNothing();
      }

      // ── 4. Dormant detection — active row, no transaction in 365 d ────
      // Only flag *transition* events: investors who weren't dormant
      // yesterday but qualify today. The UPDATE flips status; the event
      // fires once per transition.
      const dormantRows = await tx.execute(sql`
        WITH candidates AS (
          SELECT i.id, i.name, i.rm_id
            FROM investors i
            LEFT JOIN LATERAL (
              SELECT MAX(order_date) AS last_at
                FROM transactions t
               WHERE t.tenant_id = i.tenant_id
                 AND t.investor_id = i.id
            ) lt ON true
           WHERE i.status = 'active'
             AND i.deleted_at IS NULL
             AND (lt.last_at IS NULL OR lt.last_at < CURRENT_DATE - INTERVAL '365 days')
             AND i.onboarded_at < CURRENT_DATE - INTERVAL '365 days'
        )
        UPDATE investors
           SET status = 'dormant',
               updated_at = now()
          FROM candidates c
         WHERE investors.id = c.id
         RETURNING investors.id, investors.name, investors.rm_id
      `);
      result.dormant = dormantRows.rows.length;
      for (const row of dormantRows.rows as Array<{
        id: string;
        name: string;
        rm_id: string | null;
      }>) {
        await tx.insert(eventsOutbox).values({
          tenantId,
          kind: "investor.dormant",
          entityType: "investor",
          entityId: row.id,
          after: { name: row.name, rmId: row.rm_id } as any,
          meta: { scanDate, source: "daily-ops-scanner" } as any,
        } as any).onConflictDoNothing();
      }

      // ── 5. CKYC expiring within 30 days ───────────────────────────────
      const kycRows = await tx.execute(sql`
        SELECT id, name, ckyc_expiry_at, rm_id FROM investors
        WHERE ckyc_expiry_at IS NOT NULL
          AND status = 'active'
          AND deleted_at IS NULL
          AND ckyc_expiry_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
      `);
      result.kycExpiring = kycRows.rows.length;
      for (const row of kycRows.rows as Array<{
        id: string;
        name: string;
        ckyc_expiry_at: string;
        rm_id: string | null;
      }>) {
        await tx.insert(eventsOutbox).values({
          tenantId,
          kind: "investor.kyc_expiring",
          entityType: "investor",
          entityId: row.id,
          after: { name: row.name, expiresAt: row.ckyc_expiry_at, rmId: row.rm_id } as any,
          meta: { scanDate, source: "daily-ops-scanner" } as any,
        } as any).onConflictDoNothing();
      }

      // ── 6. Risk profile > 365 days old (regulatory annual review) ─────
      const riskRows = await tx.execute(sql`
        SELECT id, name, risk_profile_signed_at, rm_id FROM investors
        WHERE risk_profile_signed_at IS NOT NULL
          AND status = 'active'
          AND deleted_at IS NULL
          AND risk_profile_signed_at < CURRENT_DATE - INTERVAL '365 days'
      `);
      result.riskExpired = riskRows.rows.length;
      for (const row of riskRows.rows as Array<{
        id: string;
        name: string;
        risk_profile_signed_at: string;
        rm_id: string | null;
      }>) {
        await tx.insert(eventsOutbox).values({
          tenantId,
          kind: "investor.risk_profile_expired",
          entityType: "investor",
          entityId: row.id,
          after: { name: row.name, signedAt: row.risk_profile_signed_at, rmId: row.rm_id } as any,
          meta: { scanDate, source: "daily-ops-scanner" } as any,
        } as any).onConflictDoNothing();
      }

      // ── 7-10. Employee licensing expiries (NISM / ARN / EUIN / DSC) ──
      // NISM expiry → 90 days (existing nism_expiry_alert recipe consumes)
      // ARN  expiry → 90 days (existing arn_expiry_alert recipe consumes)
      // EUIN expiry → 90 days (alerts on the same cadence as NISM)
      // DSC  expiry → 60 days (DSC renewal is faster — 1-2 day turnaround)
      const employeeExpiryRows = await tx.execute(sql`
        SELECT id, name, email, nism_expiry_at, arn_expiry_at,
               euin_expiry_at, dsc_expiry_at, reporting_manager_id
        FROM users
        WHERE status IN ('active', 'offboarding')
          AND (
            (nism_expiry_at IS NOT NULL
              AND nism_expiry_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days')
            OR (arn_expiry_at IS NOT NULL
              AND arn_expiry_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days')
            OR (euin_expiry_at IS NOT NULL
              AND euin_expiry_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days')
            OR (dsc_expiry_at IS NOT NULL
              AND dsc_expiry_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '60 days')
          )
      `);
      for (const row of employeeExpiryRows.rows as Array<{
        id: string;
        name: string;
        email: string;
        nism_expiry_at: string | null;
        arn_expiry_at: string | null;
        euin_expiry_at: string | null;
        dsc_expiry_at: string | null;
        reporting_manager_id: string | null;
      }>) {
        const checks: Array<{
          kind: string;
          field: keyof typeof row;
          windowDays: number;
        }> = [
          { kind: "employee.nism_expiring", field: "nism_expiry_at", windowDays: 90 },
          { kind: "employee.arn_expiring", field: "arn_expiry_at", windowDays: 90 },
          { kind: "employee.euin_expiring", field: "euin_expiry_at", windowDays: 90 },
          { kind: "employee.dsc_expiring", field: "dsc_expiry_at", windowDays: 60 },
        ];
        for (const c of checks) {
          const date = row[c.field] as string | null;
          if (!date) continue;
          const d = new Date(date);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const daysOut = Math.round((d.getTime() - today.getTime()) / 86400000);
          if (daysOut < 0 || daysOut > c.windowDays) continue;
          await tx.insert(eventsOutbox).values({
            tenantId,
            kind: c.kind,
            entityType: "user",
            entityId: row.id,
            after: {
              name: row.name,
              email: row.email,
              expiresAt: date,
              daysOut,
              managerId: row.reporting_manager_id,
            } as any,
            meta: { scanDate, source: "daily-ops-scanner" } as any,
          } as any).onConflictDoNothing();
          if (c.kind === "employee.nism_expiring") result.nismExpiring++;
          if (c.kind === "employee.arn_expiring") result.arnExpiring++;
          if (c.kind === "employee.euin_expiring") result.euinExpiring++;
          if (c.kind === "employee.dsc_expiring") result.dscExpiring++;
        }
      }

      // ── 11. Sub-distributor licensing expiries ───────────────────────
      // Same 90-day window as employees for NISM/ARN/EUIN. Skips
      // terminated rows (they don't need renewal nudges).
      const subDistExpiryRows = await tx.execute(sql`
        SELECT id, name, email, mobile, arn_number,
               nism_expiry_at, arn_expiry_at, euin_expiry_at,
               relationship_manager_id
        FROM sub_distributors
        WHERE status = 'active'
          AND (
            (nism_expiry_at IS NOT NULL
              AND nism_expiry_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days')
            OR (arn_expiry_at IS NOT NULL
              AND arn_expiry_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days')
            OR (euin_expiry_at IS NOT NULL
              AND euin_expiry_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days')
          )
      `);
      for (const row of subDistExpiryRows.rows as Array<{
        id: string;
        name: string;
        email: string | null;
        mobile: string | null;
        arn_number: string | null;
        nism_expiry_at: string | null;
        arn_expiry_at: string | null;
        euin_expiry_at: string | null;
        relationship_manager_id: string | null;
      }>) {
        const checks: Array<{
          kind: string;
          field: "nism_expiry_at" | "arn_expiry_at" | "euin_expiry_at";
        }> = [
          { kind: "sub_distributor.nism_expiring", field: "nism_expiry_at" },
          { kind: "sub_distributor.arn_expiring", field: "arn_expiry_at" },
          { kind: "sub_distributor.euin_expiring", field: "euin_expiry_at" },
        ];
        for (const c of checks) {
          const date = row[c.field];
          if (!date) continue;
          const d = new Date(date);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const daysOut = Math.round((d.getTime() - today.getTime()) / 86400000);
          if (daysOut < 0 || daysOut > 90) continue;
          await tx.insert(eventsOutbox).values({
            tenantId,
            kind: c.kind,
            entityType: "sub_distributor",
            entityId: row.id,
            after: {
              name: row.name,
              email: row.email,
              mobile: row.mobile,
              arn: row.arn_number,
              expiresAt: date,
              daysOut,
              relationshipManagerId: row.relationship_manager_id,
            } as any,
            meta: { scanDate, source: "daily-ops-scanner" } as any,
          } as any).onConflictDoNothing();
          if (c.kind === "sub_distributor.nism_expiring")
            result.subDistNismExpiring++;
          if (c.kind === "sub_distributor.arn_expiring")
            result.subDistArnExpiring++;
          if (c.kind === "sub_distributor.euin_expiring")
            result.subDistEuinExpiring++;
        }
      }

      // ── 12. Legal registration expiries (SEBI / IRDAI / GST / etc.) ───
      // 90-day renewal-reminder window matches what most renewal portals
      // ask for — compliance team has the lead time to act.
      const legalRegRows = await tx.execute(sql`
        SELECT id, registered_in_name_of, authority, registration_for,
               registration_number, expiry_at
        FROM legal_registrations
        WHERE status IN ('active', 'pending_renewal')
          AND expiry_at IS NOT NULL
          AND expiry_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days'
      `);
      for (const row of legalRegRows.rows as Array<{
        id: string;
        registered_in_name_of: string;
        authority: string;
        registration_for: string;
        registration_number: string | null;
        expiry_at: string;
      }>) {
        const d = new Date(row.expiry_at);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const daysOut = Math.round((d.getTime() - today.getTime()) / 86400000);
        await tx.insert(eventsOutbox).values({
          tenantId,
          kind: "legal_registration.expiring",
          entityType: "legal_registration",
          entityId: row.id,
          after: {
            registeredInNameOf: row.registered_in_name_of,
            authority: row.authority,
            registrationFor: row.registration_for,
            registrationNumber: row.registration_number,
            expiresAt: row.expiry_at,
            daysOut,
          } as any,
          meta: { scanDate, source: "daily-ops-scanner" } as any,
        } as any).onConflictDoNothing();
        result.legalRegExpiring++;
      }

      // ── 12b. Auto-expire lapsed registrations ─────────────────────────
      // A license whose date has passed but whose status was never manually
      // updated must not keep reading as 'active' (it'd be invisible in the
      // "Expired" view + the pre-expiry alert window has closed). Flip it to
      // 'expired' (perpetual excluded) and emit a one-time event — the scan-date
      // dedup + the status change together guarantee it fires only on lapse day.
      const lapsedRows = await tx.execute(sql`
        UPDATE legal_registrations
        SET status = 'expired', updated_at = now()
        WHERE tenant_id = ${tenantId}::uuid
          AND status IN ('active', 'pending_renewal')
          AND renewal_frequency <> 'perpetual'
          AND expiry_at IS NOT NULL
          AND expiry_at < CURRENT_DATE
        RETURNING id, registered_in_name_of, authority, registration_for, expiry_at
      `);
      for (const row of lapsedRows.rows as Array<{
        id: string;
        registered_in_name_of: string;
        authority: string;
        registration_for: string;
        expiry_at: string;
      }>) {
        await tx
          .insert(eventsOutbox)
          .values({
            tenantId,
            kind: "legal_registration.expired",
            entityType: "legal_registration",
            entityId: row.id,
            after: {
              registeredInNameOf: row.registered_in_name_of,
              authority: row.authority,
              registrationFor: row.registration_for,
              expiresAt: row.expiry_at,
            } as any,
            meta: { scanDate, source: "daily-ops-scanner" } as any,
          } as any)
          .onConflictDoNothing();
      }

      // ── 13. Compliance-vault document expiries ────────────────────────
      // ARN / NISM / KYD / AMC-empanelment / RIA docs etc. carry an explicit
      // expires_on. Until now that only drove a dashboard badge — emit events so
      // a recipe can actually remind the compliance team to renew. Two kinds:
      //   document.expiring — within 30 days (and not yet lapsed)
      //   document.expired  — already past (fires once via the scan-date dedup)
      // Superseded (replaced) docs are skipped — they're history, not live.
      const docExpiryRows = await tx.execute(sql`
        SELECT id, name, category, expires_on, related_entity_type, related_entity_id
        FROM compliance_documents
        WHERE tenant_id = ${tenantId}::uuid
          AND superseded_by_id IS NULL
          AND expires_on IS NOT NULL
          AND expires_on <= CURRENT_DATE + INTERVAL '30 days'
      `);
      for (const row of docExpiryRows.rows as Array<{
        id: string;
        name: string;
        category: string;
        expires_on: string;
        related_entity_type: string | null;
        related_entity_id: string | null;
      }>) {
        const d = new Date(`${row.expires_on}T00:00:00`);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const daysOut = Math.round((d.getTime() - today.getTime()) / 86400000);
        const expired = daysOut < 0;
        await tx.insert(eventsOutbox).values({
          tenantId,
          kind: expired ? "document.expired" : "document.expiring",
          entityType: "compliance_document",
          entityId: row.id,
          after: {
            name: row.name,
            category: row.category,
            expiresOn: row.expires_on,
            daysOut,
            relatedEntityType: row.related_entity_type,
            relatedEntityId: row.related_entity_id,
          } as any,
          meta: { scanDate, source: "daily-ops-scanner" } as any,
        } as any).onConflictDoNothing();
        if (expired) result.docsExpired++;
        else result.docsExpiring++;
      }

      // ── Refresh persisted client-health ───────────────────────────────
      // Health has time-based factors (days-since-contact, review overdue) so
      // it drifts even when rows don't change. Re-score the whole book nightly
      // off the same JS scorecard the app writes on edit.
      const scanNow = new Date();
      const health = await recomputeAllHealth(tx, scanNow);
      result.healthScored = health.scored;

      // Family health depends on member aggregates + family review cadence —
      // same nightly-drift argument. One efficient pass per tenant.
      const famHealth = await recomputeAllFamilyHealth(tx, scanNow);
      result.familyHealthScored = famHealth.scored;

      // Goal progress drifts as months tick down + linked investments grow.
      // Refresh required-SIP / gap / progress / status + expected_progress_pct
      // (which powers the goal_drift_alert recipe).
      const goalsRes = await recomputeAllGoals(tx, scanNow);
      result.goalsRecomputed = goalsRes.recomputed;

      // ── Live AUM revaluation ──────────────────────────────────────────
      // The headline audit fix: investors.aum (firm/RM AUM, tiering, exports,
      // AI briefs) and the folio rollup (review report, commission-expected)
      // were stored at import and never repriced. Revalue both against the
      // live AMFI NAV feed nightly so every surface agrees with today's NAV.
      // Folios first (so their repriced values are available), then investors.
      const folioVal = await revalueAllFolios(tx);
      result.foliosRevalued = folioVal.folios;
      const aumVal = await recomputeCombinedAum(tx);
      result.aumRevalued = aumVal.updated;

      // ── CS5: AUM "moments that matter" ────────────────────────────────
      // When a client's live AUM crosses a band (₹10L/₹25L/₹50L/₹1Cr/₹2.5Cr/
      // ₹5Cr), emit a one-time congratulation event + raise their stored band so
      // it fires once per crossing. A delightful, proactive touch.
      const MILESTONE_LABELS: Record<number, string> = {
        1: "₹10 lakh", 2: "₹25 lakh", 3: "₹50 lakh", 4: "₹1 crore", 5: "₹2.5 crore", 6: "₹5 crore",
      };
      const milestoneRows = await tx.execute(sql`
        WITH banded AS (
          SELECT id, name, rm_id, aum,
            CASE WHEN aum >= 50000000 THEN 6 WHEN aum >= 25000000 THEN 5 WHEN aum >= 10000000 THEN 4
                 WHEN aum >= 5000000 THEN 3 WHEN aum >= 2500000 THEN 2 WHEN aum >= 1000000 THEN 1 ELSE 0 END AS band
          FROM investors WHERE status = 'active' AND deleted_at IS NULL
        )
        SELECT b.id, b.name, b.rm_id, b.aum, b.band
        FROM banded b JOIN investors i ON i.id = b.id
        WHERE b.band > i.aum_milestone_band
      `);
      for (const row of milestoneRows.rows as Array<{ id: string; name: string; rm_id: string | null; aum: string; band: number }>) {
        await tx.insert(eventsOutbox).values({
          tenantId,
          kind: "investor.milestone.aum",
          entityType: "investor",
          entityId: row.id,
          after: { band: row.band, band_label: MILESTONE_LABELS[row.band] ?? "", aum: Number(row.aum), name: row.name, rmId: row.rm_id } as any,
          meta: { scanDate, source: "daily-ops-scanner" } as any,
        } as any).onConflictDoNothing();
        await tx.execute(sql`UPDATE investors SET aum_milestone_band = ${row.band} WHERE id = ${row.id}::uuid`);
      }

      // ── CS6: proactive advice as client moments ───────────────────────
      // Protection gap — a client with real AUM but NO active life cover. Emit
      // at most once per ~90 days (self-dedup against the outbox) so the
      // protection_gap_nudge recipe messages them, not nags daily.
      const gapRows = await tx.execute(sql`
        SELECT i.id, i.name, i.rm_id, i.aum FROM investors i
        WHERE i.status = 'active' AND i.deleted_at IS NULL AND i.aum >= 2500000
          AND NOT EXISTS (SELECT 1 FROM insurance_policies p WHERE p.investor_id = i.id AND p.status = 'active')
          AND NOT EXISTS (SELECT 1 FROM events_outbox e WHERE e.tenant_id = ${tenantId}::uuid AND e.entity_id = i.id AND e.kind = 'insurance.protection_gap' AND e.occurred_at > now() - interval '90 days')
        LIMIT 500
      `);
      for (const row of gapRows.rows as Array<{ id: string; name: string; rm_id: string | null; aum: string }>) {
        await tx.insert(eventsOutbox).values({
          tenantId, kind: "insurance.protection_gap", entityType: "investor", entityId: row.id,
          after: { name: row.name, aum: Number(row.aum), rmId: row.rm_id, suggested_cover: Math.round(Number(row.aum) * 10 / 100000) * 100000 } as any,
          meta: { scanDate, source: "daily-ops-scanner" } as any,
        } as any).onConflictDoNothing();
      }

      // Tax-savings opportunity — only in the Jan–Mar window (FY closing), for
      // clients with a transaction history (equity holdings likely). Once/year.
      const month = scanNow.getMonth(); // 0-based; Jan=0..Mar=2
      if (month <= 2) {
        const taxRows = await tx.execute(sql`
          SELECT i.id, i.name, i.rm_id FROM investors i
          WHERE i.status = 'active' AND i.deleted_at IS NULL AND i.aum >= 500000
            AND EXISTS (SELECT 1 FROM transactions t WHERE t.investor_id = i.id AND t.status IN ('processed','successful'))
            AND NOT EXISTS (SELECT 1 FROM events_outbox e WHERE e.tenant_id = ${tenantId}::uuid AND e.entity_id = i.id AND e.kind = 'tax.harvest_opportunity' AND e.occurred_at > now() - interval '300 days')
          LIMIT 500
        `);
        for (const row of taxRows.rows as Array<{ id: string; name: string; rm_id: string | null }>) {
          await tx.insert(eventsOutbox).values({
            tenantId, kind: "tax.harvest_opportunity", entityType: "investor", entityId: row.id,
            after: { name: row.name, rmId: row.rm_id } as any,
            meta: { scanDate, source: "daily-ops-scanner" } as any,
          } as any).onConflictDoNothing();
        }
      }

      // ── Goal drift — emit a `goal.drift` event for each investor whose goal
      // has fallen >10pp behind its time-trajectory. One event per investor
      // (the worst-drifting goal); the scanner dedup index collapses to one
      // nudge per client per day. This is what the goal_drift_alert recipe
      // subscribes to (previously the recipe had no event source at all).
      const driftRows = await tx.execute(sql`
        SELECT DISTINCT ON (g.investor_id)
          g.investor_id, g.id AS goal_id, g.name AS goal_name,
          ROUND(g.expected_progress_pct - g.progress_pct, 1) AS drift_pct,
          i.rm_id
        FROM goals g
        JOIN investors i ON i.id = g.investor_id AND i.status NOT IN ('closed', 'exited') AND i.deleted_at IS NULL
        WHERE g.status IN ('not_started', 'on_track', 'behind_track', 'active')
          AND g.expected_progress_pct IS NOT NULL
          AND g.progress_pct < g.expected_progress_pct - 10
        ORDER BY g.investor_id, (g.expected_progress_pct - g.progress_pct) DESC
      `);
      result.goalDrift = driftRows.rows.length;
      for (const row of driftRows.rows as Array<{
        investor_id: string;
        goal_id: string;
        goal_name: string;
        drift_pct: string;
        rm_id: string | null;
      }>) {
        await tx
          .insert(eventsOutbox)
          .values({
            tenantId,
            kind: "goal.drift",
            entityType: "investor",
            entityId: row.investor_id,
            after: {
              goalId: row.goal_id,
              goal_name: row.goal_name,
              drift_pct: Number(row.drift_pct),
              rmId: row.rm_id,
            } as any,
            meta: { scanDate, source: "daily-ops-scanner" } as any,
          } as any)
          .onConflictDoNothing();
      }

      // ── Insurance premium due — emit `insurance.premium_due` at reminder
      // milestones (15 / 7 / 1 days before the next premium) so the client gets
      // a proactive nudge instead of a daily drip. One event per investor (the
      // soonest-due policy); the scanner dedup collapses to one/day.
      const premiumRows = await tx.execute(sql`
        SELECT DISTINCT ON (p.investor_id)
          p.investor_id, p.id AS policy_id, p.plan_name, p.insurer,
          p.policy_number, p.next_premium_due_date,
          p.annual_premium::numeric AS annual_premium,
          (p.next_premium_due_date - current_date)::int AS days_until,
          i.rm_id
        FROM insurance_policies p
        JOIN investors i ON i.id = p.investor_id AND i.status NOT IN ('closed', 'exited') AND i.deleted_at IS NULL
        WHERE p.status = 'active'
          AND p.next_premium_due_date IS NOT NULL
          AND (p.next_premium_due_date - current_date) IN (15, 7, 1)
        ORDER BY p.investor_id, p.next_premium_due_date ASC
      `);
      result.premiumDue = premiumRows.rows.length;
      for (const row of premiumRows.rows as any[]) {
        await tx
          .insert(eventsOutbox)
          .values({
            tenantId,
            kind: "insurance.premium_due",
            entityType: "investor",
            entityId: row.investor_id,
            after: {
              policyId: row.policy_id,
              plan_name: row.plan_name,
              insurer: row.insurer,
              policyNumber: row.policy_number,
              due_date: row.next_premium_due_date,
              days_until: Number(row.days_until),
              premium: row.annual_premium != null ? Number(row.annual_premium) : null,
              rmId: row.rm_id,
            } as any,
            meta: { scanDate, source: "daily-ops-scanner" } as any,
          } as any)
          .onConflictDoNothing();
      }

      // ── Insurance lapse — an active policy past next_premium_due_date + grace
      // with no payment is lapsed. Alert ONCE (lapse_alerted_at marker) and let
      // the RM confirm/reinstate, rather than re-firing every day or silently
      // flipping status off a possibly-stale due date.
      const lapseRows = await tx.execute(sql`
        SELECT p.id AS policy_id, p.investor_id, p.plan_name, p.insurer,
               p.policy_number, p.next_premium_due_date, i.rm_id
        FROM insurance_policies p
        JOIN investors i ON i.id = p.investor_id AND i.status NOT IN ('closed', 'exited') AND i.deleted_at IS NULL
        WHERE p.status = 'active'
          AND p.lapse_alerted_at IS NULL
          AND p.next_premium_due_date IS NOT NULL
          AND p.next_premium_due_date + (COALESCE(p.grace_period_days, 30) || ' days')::interval < current_date
      `);
      result.policyLapsed = lapseRows.rows.length;
      for (const row of lapseRows.rows as any[]) {
        await tx
          .insert(eventsOutbox)
          .values({
            tenantId,
            kind: "insurance.lapsed",
            entityType: "investor",
            entityId: row.investor_id,
            after: {
              policyId: row.policy_id,
              plan_name: row.plan_name,
              insurer: row.insurer,
              policyNumber: row.policy_number,
              due_date: row.next_premium_due_date,
              rmId: row.rm_id,
            } as any,
            meta: { scanDate, source: "daily-ops-scanner", policyId: row.policy_id } as any,
          } as any)
          .onConflictDoNothing();
        // Mark alerted so we don't re-fire daily.
        await tx.execute(sql`
          UPDATE insurance_policies SET lapse_alerted_at = now() WHERE id = ${row.policy_id}::uuid
        `);
      }

      // ── Refresh investors.active_sip_amount ───────────────────────────
      // This cached column was never recomputed, so the client list's
      // "Monthly SIP", the SIP health card, family suggestions etc. all read
      // a stale (usually 0) value. Recompute from the live SIP book nightly.
      await tx.execute(sql`
        UPDATE investors i SET active_sip_amount = COALESCE((
          SELECT SUM(s.amount::numeric) FROM sips s
          WHERE s.investor_id = i.id AND s.status = 'active'
        ), 0)
        WHERE i.active_sip_amount IS DISTINCT FROM COALESCE((
          SELECT SUM(s.amount::numeric) FROM sips s
          WHERE s.investor_id = i.id AND s.status = 'active'
        ), 0)
      `);

      // ── SIP expiring — emit `sip.expiring` at 30/15/7 days before end_date
      // so the client gets a renewal nudge before recurring AUM quietly ends.
      // One event per investor (the soonest-ending SIP); dedup collapses to
      // one/day.
      const sipExpRows = await tx.execute(sql`
        SELECT DISTINCT ON (s.investor_id)
          s.investor_id, s.id AS sip_id, s.scheme_name, s.amount::numeric AS amount,
          s.end_date, (s.end_date - current_date)::int AS days_until, i.rm_id
        FROM sips s
        JOIN investors i ON i.id = s.investor_id AND i.status NOT IN ('closed', 'exited') AND i.deleted_at IS NULL
        WHERE s.status = 'active'
          AND s.end_date IS NOT NULL
          AND (s.end_date - current_date) IN (30, 15, 7)
        ORDER BY s.investor_id, s.end_date ASC
      `);
      result.sipExpiring = sipExpRows.rows.length;
      for (const row of sipExpRows.rows as any[]) {
        await tx
          .insert(eventsOutbox)
          .values({
            tenantId,
            kind: "sip.expiring",
            entityType: "investor",
            entityId: row.investor_id,
            after: {
              sipId: row.sip_id,
              scheme_name: row.scheme_name,
              amount: row.amount != null ? Number(row.amount) : null,
              end_date: row.end_date,
              days_until: Number(row.days_until),
              rmId: row.rm_id,
            } as any,
            meta: { scanDate, source: "daily-ops-scanner" } as any,
          } as any)
          .onConflictDoNothing();
      }

      // ── Mandate expiring — emit `mandate.expiring` at T-90 / T-60 / T-30
      // (NACH mandate must be renewed or every SIP on it stops). One event per
      // investor (soonest-expiring mandate); the mandate_expiry_t90_t60_t30
      // recipe branches on event.days_to_expiry.
      const mandateExpRows = await tx.execute(sql`
        SELECT DISTINCT ON (m.investor_id)
          m.investor_id, m.id AS mandate_id, m.mandate_ref_no, m.expires_at,
          (m.expires_at - current_date)::int AS days_until, i.rm_id
        FROM mandates m
        JOIN investors i ON i.id = m.investor_id AND i.status NOT IN ('closed', 'exited') AND i.deleted_at IS NULL
        WHERE m.status = 'active'
          AND m.expires_at IS NOT NULL
          AND (m.expires_at - current_date) IN (90, 60, 30)
        ORDER BY m.investor_id, m.expires_at ASC
      `);
      result.mandateExpiring = mandateExpRows.rows.length;
      for (const row of mandateExpRows.rows as any[]) {
        await tx
          .insert(eventsOutbox)
          .values({
            tenantId,
            kind: "mandate.expiring",
            entityType: "investor",
            entityId: row.investor_id,
            after: {
              mandateId: row.mandate_id,
              mandate_ref: row.mandate_ref_no,
              expires_at: row.expires_at,
              days_to_expiry: Number(row.days_until),
              rmId: row.rm_id,
            } as any,
            meta: { scanDate, source: "daily-ops-scanner" } as any,
          } as any)
          .onConflictDoNothing();
      }

      // ── 13. Portfolio Risk-Drift Check ────────────────────────────────
      // Scans active investors with a registered risk profile and AUM > 0.
      // Computes actual equity % from folios and flags a drift if it exceeds
      // the suitability matrix long-term equity target by >15% absolute.
      const driftInvestors = await tx.execute(sql`
        SELECT id, name, risk_profile, rm_id, aum FROM investors
        WHERE status = 'active'
          AND deleted_at IS NULL
          AND risk_profile IS NOT NULL
          AND aum > 0
      `);

      const matrixRows = await tx.select().from(suitabilityMatrixEntries);

      let driftEmitted = 0;
      for (const inv of driftInvestors.rows as Array<{ id: string; name: string; risk_profile: string; rm_id: string | null; aum: string }>) {
        const invFolios = await tx.select().from(folios).where(eq(folios.investorId, inv.id));
        
        let totalValue = 0;
        let equityValue = 0;

        for (const f of invFolios) {
          const schemes = (f.schemes ?? []) as Array<{ category?: string; value?: number }>;
          for (const s of schemes) {
            const val = Number(s.value ?? 0);
            if (isFinite(val) && val > 0) {
              totalValue += val;
              const cat = s.category ?? "";
              const c = cat.toLowerCase();
              if (c.includes("equity") || c.includes("growth")) {
                equityValue += val;
              }
            }
          }
        }

        if (totalValue > 50000) { // Only scan portfolios with substantial value (> ₹50,000)
          const actualEquityPct = (equityValue / totalValue) * 100;
          
          const mappedRisk = 
            inv.risk_profile === "conservative" ? "low" : 
            inv.risk_profile === "moderate" ? "moderate" : "high";

          const cell = matrixRows.find(m => m.riskProfile === mappedRisk && m.timeHorizon === "long");
          const targetEquityPct = cell?.allocationHints?.["equity"] ?? (mappedRisk === "low" ? 30 : mappedRisk === "moderate" ? 55 : 85);

          const driftPct = actualEquityPct - targetEquityPct;

          if (driftPct >= 15) { // Absolute 15% drift threshold
            await tx.insert(eventsOutbox).values({
              tenantId,
              kind: "investor.portfolio_risk_drift",
              entityType: "investor",
              entityId: inv.id,
              after: {
                name: inv.name,
                actualEquityPct: Math.round(actualEquityPct),
                targetEquityPct: Math.round(targetEquityPct),
                driftPct: Math.round(driftPct),
                totalAum: Math.round(totalValue),
                rmId: inv.rm_id,
              } as any,
              meta: { scanDate, source: "daily-ops-scanner" } as any,
            } as any).onConflictDoNothing();
            driftEmitted++;
          }
        }
      }
      result.portfolioRiskDrift = driftEmitted;

      // ── Attendance auto-seed — ensure today's row per active employee ────
      // Precedence: holiday (holidays master) → approved leave → weekly-off
      // (configured days, else Sunday) → absent (until they clock in).
      // ON CONFLICT DO NOTHING so a real clock-in is never clobbered.
      const attSeed = await tx.execute(sql`
        INSERT INTO attendance (tenant_id, employee_user_id, attendance_date, status, source)
        SELECT u.tenant_id, u.id, current_date,
          CASE
            WHEN EXISTS (
              SELECT 1 FROM holidays h
              WHERE h.tenant_id = u.tenant_id AND h.holiday_date = current_date
            ) THEN 'holiday'
            WHEN EXISTS (
              SELECT 1 FROM leave_applications la
              WHERE la.tenant_id = u.tenant_id AND la.employee_user_id = u.id
                AND la.status = 'approved' AND current_date BETWEEN la.from_date AND la.to_date
            ) THEN 'on_leave'
            WHEN EXISTS (
              SELECT 1 FROM attendance_settings s
              WHERE s.tenant_id = u.tenant_id
                AND s.week_off_days @> to_jsonb(EXTRACT(DOW FROM current_date)::int)
            ) THEN 'week_off'
            WHEN NOT EXISTS (SELECT 1 FROM attendance_settings s WHERE s.tenant_id = u.tenant_id)
              AND EXTRACT(DOW FROM current_date) = 0 THEN 'week_off'
            ELSE 'absent'
          END,
          'auto'
        FROM users u
        WHERE u.tenant_id = ${tenantId}::uuid AND u.status = 'active'
        ON CONFLICT (tenant_id, employee_user_id, attendance_date) DO NOTHING
        RETURNING 1
      `);
      result.attendanceSeeded = attSeed.rows.length;

      // ── Service-request SLA escalation (resolution OR first-response) ─────
      // Deterministic escalation so the "escalate on breach" promise holds even
      // without the recipe installed. A ticket escalates ONCE (escalated_at
      // guards re-fire): flips to 'escalated', appends a timeline entry,
      // notifies owner/branch-head + assignee, and opens an urgent task.
      const srRows = await tx.execute(sql`
        SELECT sr.id, sr.ticket_no, sr.type, sr.assigned_to_user_id, sr.investor_id,
               i.name AS investor_name,
               (sr.sla_resolution_at < now()) AS resolution_breached,
               (sr.responded_at IS NULL AND sr.sla_response_at < now()) AS response_breached
        FROM service_requests sr
        LEFT JOIN investors i ON i.id = sr.investor_id
        WHERE sr.status NOT IN ('resolved','closed')
          AND sr.escalated_at IS NULL
          AND (sr.sla_resolution_at < now()
               OR (sr.responded_at IS NULL AND sr.sla_response_at < now()))
        LIMIT 500
      `);
      result.srEscalated = srRows.rows.length;
      if (srRows.rows.length) {
        const leads = await tx.execute(sql`
          SELECT id FROM users WHERE tenant_id = ${tenantId}::uuid AND roles && ARRAY['owner','branch_head']::text[]
        `);
        const leadIds = (leads.rows as Array<{ id: string }>).map((u) => u.id);
        const nowIso = new Date().toISOString();
        for (const sr of srRows.rows as any[]) {
          const why = sr.resolution_breached ? "TAT (resolution) breached" : "first response overdue";
          // Flip to escalated + stamp + append a timeline entry (idempotent: escalated_at was NULL).
          await tx.execute(sql`
            UPDATE service_requests
            SET status = 'escalated', escalated_at = now(), updated_at = now(),
                timeline = COALESCE(timeline, '[]'::jsonb) ||
                  ${JSON.stringify([{ at: nowIso, by: "system", event: "escalated", note: why }])}::jsonb
            WHERE id = ${sr.id}::uuid
          `);
          // Notify owner/branch-head + the assignee.
          const recipients = new Set<string>(leadIds);
          if (sr.assigned_to_user_id) recipients.add(sr.assigned_to_user_id);
          for (const userId of recipients) {
            await tx.execute(sql`
              INSERT INTO notifications (tenant_id, user_id, kind, title, body, link_url, severity, meta)
              VALUES (
                ${tenantId}::uuid, ${userId}::uuid, 'service_request.escalated',
                ${`SR escalated — ${sr.ticket_no}`},
                ${`${why} · ${sr.investor_name ?? "client"} · ${String(sr.type).replace(/_/g, " ")}`},
                ${`/dashboard/service-requests/${sr.id}`}, 'critical',
                ${JSON.stringify({ service_request_id: sr.id, why })}::jsonb
              )
            `);
          }
          // NOTE: the auto SR-escalation TASK is disabled per firm preference
          // ("turn off all auto tasks"). The escalation status flip + the
          // owner/assignee notification above still fire — only the task-list
          // entry is no longer auto-created.
          // Emit an event (scanner-deduped) so any subscribed workflow can react.
          await tx
            .insert(eventsOutbox)
            .values({
              tenantId,
              kind: "service_request.escalated",
              entityType: "service_request",
              entityId: sr.id,
              after: { ticketNo: sr.ticket_no, type: sr.type, why } as any,
              meta: { scanDate, source: "daily-ops-scanner" } as any,
            } as any)
            .onConflictDoNothing();
        }
      }

      // ── Automation-health alert (proactive "trust surface") ────────────
      // The Control Tower already computes these danger signals, but nobody
      // sees them unless they open the page. Push an alert to the leads when
      // the engine is visibly degraded: events stuck in the outbox >1h
      // (poller wedged), scheduled rule jobs overdue >1h, or a spike of
      // failed workflow runs in the last 24h. Deduped to once per day per
      // recipient (a notification of this kind already created today is a
      // no-op), so a re-run or a persistent fault doesn't spam.
      const healthRow = await tx.execute(sql`
        SELECT
          (SELECT count(*) FROM events_outbox
             WHERE tenant_id = ${tenantId}::uuid AND processed_at IS NULL
               AND occurred_at < now() - interval '1 hour')::int AS stuck,
          (SELECT count(*) FROM workflow_rule_scheduled_jobs
             WHERE tenant_id = ${tenantId}::uuid AND status = 'pending'
               AND run_at < now() - interval '1 hour')::int AS overdue,
          (SELECT count(*) FROM workflow_runs
             WHERE tenant_id = ${tenantId}::uuid AND status = 'failed'
               AND created_at >= now() - interval '24 hours')::int AS failed_runs
      `);
      const h = (healthRow.rows[0] as any) ?? {};
      const stuck = Number(h.stuck ?? 0);
      const overdue = Number(h.overdue ?? 0);
      const failedRuns = Number(h.failed_runs ?? 0);
      if (stuck > 0 || overdue > 0 || failedRuns >= 10) {
        const parts: string[] = [];
        if (stuck > 0) parts.push(`${stuck} event${stuck === 1 ? "" : "s"} stuck in the outbox >1h`);
        if (overdue > 0) parts.push(`${overdue} scheduled job${overdue === 1 ? "" : "s"} overdue >1h`);
        if (failedRuns >= 10) parts.push(`${failedRuns} failed workflow runs in 24h`);
        const body = parts.join(" · ");
        const leads = await tx.execute(sql`
          SELECT id FROM users
          WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
            AND roles && ARRAY['owner','branch_head','ops']::text[]
        `);
        let raised = 0;
        for (const u of leads.rows as Array<{ id: string }>) {
          // INSERT…SELECT…WHERE NOT EXISTS = idempotent once-per-day-per-user.
          const res = await tx.execute(sql`
            INSERT INTO notifications (tenant_id, user_id, kind, title, body, link_url, severity, meta)
            SELECT ${tenantId}::uuid, ${u.id}::uuid, 'automation.health',
                   'Automation needs attention', ${body},
                   '/dashboard/workflows/runs', 'warning',
                   ${JSON.stringify({ stuck, overdue, failedRuns, scanDate })}::jsonb
            WHERE NOT EXISTS (
              SELECT 1 FROM notifications
              WHERE tenant_id = ${tenantId}::uuid AND user_id = ${u.id}::uuid
                AND kind = 'automation.health' AND created_at >= current_date
            )
            RETURNING id
          `);
          raised += res.rows.length;
        }
        result.automationAlerts = raised;
      }
    },
    { roles: ["system"] }
  );

  result.durationMs = Date.now() - startedAt;
  return result;
}

/**
 * Main entry: scan every active tenant. Logs aggregate metrics for the
 * day so an operator can spot anomalies (e.g. zero birthdays usually
 * means the scanner crashed for a tenant).
 */
export async function runDailyOpsScan(): Promise<{
  tenants: number;
  totals: Omit<ScanResult, "tenantId" | "durationMs">;
  failedTenants: string[];
  durationMs: number;
}> {
  const startedAt = Date.now();

  // ── Auto-purge: permanently remove soft-deleted tenants whose retention
  // window has elapsed (data is kept until then so they can be recovered).
  // Each purge runs in its OWN system tx so one failure can't roll back others.
  try {
    const dueIds = await withSystem(async (tx) => {
      const days = await readSoftDeleteRetentionDays(tx as any);
      const due = await tx.execute(sql`
        SELECT id FROM tenants
        WHERE deleted_at IS NOT NULL
          AND deleted_at < now() - make_interval(days => ${days})
        LIMIT 50
      `);
      return (due.rows as Array<{ id: string }>).map((r) => r.id);
    });
    let purged = 0;
    for (const id of dueIds) {
      try {
        await withSystem(async (tx) => {
          await tx.execute(sql`SELECT platform_purge_tenant(${id}::uuid)`);
        });
        purged++;
      } catch (e) {
        console.error("[daily-ops] auto-purge failed for tenant", id, (e as Error)?.message);
      }
    }
    if (purged) console.log(`[daily-ops] auto-purged ${purged} soft-deleted tenant(s) past retention`);
  } catch (e) {
    console.error("[daily-ops] auto-purge pass failed:", (e as Error)?.message);
  }

  // ── Auto-purge: permanently remove soft-deleted CLIENTS (investors) whose
  // Trash-bin retention window has elapsed. The hard delete cascades the owned
  // data subgraph (folios/transactions/sips/goals/proposals — migration 0131);
  // compliance documents link polymorphically (no FK) so they're removed first.
  try {
    const due = await withSystem(async (tx) => {
      const days = await readSoftDeleteRetentionDays(tx as any);
      const r = await tx.execute(sql`
        SELECT id, tenant_id FROM investors
        WHERE deleted_at IS NOT NULL
          AND deleted_at < now() - make_interval(days => ${days})
        LIMIT 200
      `);
      return r.rows as Array<{ id: string; tenant_id: string }>;
    });
    let purgedClients = 0;
    for (const row of due) {
      try {
        await withSystem(async (tx) => {
          await tx.execute(sql`
            DELETE FROM compliance_documents
            WHERE tenant_id = ${row.tenant_id}::uuid
              AND related_entity_type = 'investor'
              AND related_entity_id = ${row.id}::uuid
          `);
          await tx.execute(sql`DELETE FROM investors WHERE id = ${row.id}::uuid`);
        });
        purgedClients++;
      } catch (e) {
        console.error("[daily-ops] client auto-purge failed for", row.id, (e as Error)?.message);
      }
    }
    if (purgedClients) console.log(`[daily-ops] auto-purged ${purgedClients} trashed client(s) past retention`);
  } catch (e) {
    console.error("[daily-ops] client auto-purge pass failed:", (e as Error)?.message);
  }

  const tenants = await listActiveTenants();
  const failed: string[] = [];
  const totals = {
    birthday: 0,
    anniversary: 0,
    minorToMajor: 0,
    dormant: 0,
    kycExpiring: 0,
    riskExpired: 0,
    docsExpiring: 0,
    docsExpired: 0,
    nismExpiring: 0,
    arnExpiring: 0,
    euinExpiring: 0,
    dscExpiring: 0,
    subDistNismExpiring: 0,
    subDistArnExpiring: 0,
    subDistEuinExpiring: 0,
    legalRegExpiring: 0,
    healthScored: 0,
    familyHealthScored: 0,
    goalsRecomputed: 0,
    aumRevalued: 0,
    foliosRevalued: 0,
    goalDrift: 0,
    premiumDue: 0,
    policyLapsed: 0,
    sipExpiring: 0,
    mandateExpiring: 0,
    srEscalated: 0,
    attendanceSeeded: 0,
    portfolioRiskDrift: 0,
    automationAlerts: 0,
  };
  // Each tenant scan is fully independent (its own withTenant tx, RLS-scoped to
  // that tenant's rows), so they can run concurrently without lock contention.
  // A sequential loop over 500 tenants serialises ~5–13s of work each (≈ an hour
  // wall-clock); a bounded pool keeps the DB busy without exhausting the pg pool
  // (default 20 conns). Tune with DAILY_OPS_CONCURRENCY; default 5.
  const concurrency = Math.max(1, Number(process.env.DAILY_OPS_CONCURRENCY ?? 5) || 5);
  const queue = [...tenants];
  const accumulate = (r: ScanResult) => {
      totals.birthday += r.birthday;
      totals.anniversary += r.anniversary;
      totals.minorToMajor += r.minorToMajor;
      totals.dormant += r.dormant;
      totals.kycExpiring += r.kycExpiring;
      totals.riskExpired += r.riskExpired;
      totals.docsExpiring += r.docsExpiring;
      totals.docsExpired += r.docsExpired;
      totals.nismExpiring += r.nismExpiring;
      totals.arnExpiring += r.arnExpiring;
      totals.euinExpiring += r.euinExpiring;
      totals.dscExpiring += r.dscExpiring;
      totals.subDistNismExpiring += r.subDistNismExpiring;
      totals.subDistArnExpiring += r.subDistArnExpiring;
      totals.subDistEuinExpiring += r.subDistEuinExpiring;
      totals.legalRegExpiring += r.legalRegExpiring;
      totals.healthScored += r.healthScored;
      totals.familyHealthScored += r.familyHealthScored;
      totals.goalsRecomputed += r.goalsRecomputed;
      totals.aumRevalued += r.aumRevalued;
      totals.foliosRevalued += r.foliosRevalued;
      totals.goalDrift += r.goalDrift;
      totals.premiumDue += r.premiumDue;
      totals.policyLapsed += r.policyLapsed;
      totals.sipExpiring += r.sipExpiring;
      totals.mandateExpiring += r.mandateExpiring;
      totals.srEscalated += r.srEscalated;
      totals.attendanceSeeded += r.attendanceSeeded;
      totals.portfolioRiskDrift += r.portfolioRiskDrift;
      totals.automationAlerts += r.automationAlerts;
  };
  const worker = async () => {
    for (;;) {
      const tenantId = queue.shift();
      if (!tenantId) return;
      try {
        accumulate(await scanTenant(tenantId));
      } catch (err: any) {
        console.error(`[daily-ops-scanner] tenant ${tenantId} failed:`, err.message);
        failed.push(tenantId);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, () => worker())
  );
  const durationMs = Date.now() - startedAt;
  console.log(
    `[daily-ops-scanner] scanned ${tenants.length} tenants in ${durationMs}ms`,
    totals
  );
  return { tenants: tenants.length, totals, failedTenants: failed, durationMs };
}
