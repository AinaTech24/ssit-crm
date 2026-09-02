/**
 * Monthly compliance checklist seeder.
 *
 * On the 1st of every month, walks every active tenant and seeds the
 * standard SEBI-mandated compliance checklist as tasks against the
 * compliance role. 12 tasks per tenant per month — the firm always
 * knows what's on its plate.
 *
 * Why a worker, not a workflow recipe: workflow recipes create one
 * task per execution and are designed for event-driven flows. This is
 * a flat list of N tasks that we want to land atomically the same way
 * a paper checklist does — much simpler to do directly.
 *
 * Idempotency: each task is keyed by a `monthKey = YYYY-MM`. A second
 * run in the same month is a no-op via a check against the open-task
 * remarks field (which stores the monthKey).
 *
 * Items follow the SEBI Code 2022 + AMFI 2024 guidance for distributor
 * monthly compliance routines.
 */

import { sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { withSystem, withTenant } from "@/db/client";
import { tasks, users } from "@/db/schema";

/** Items seeded per tenant per month. Each row → one task. */
const CHECKLIST = [
  {
    title: "Verify all dispatched WhatsApp templates match approved DLT entries",
    type: "compliance",
    dueOffsetDays: 5,
    priority: "high",
    remarks: "SEBI 2026 — auto-tagline + ARN line must be present on every send.",
  },
  {
    title: "Run KYC expiry sweep — flag clients within 30 days of CKYC expiry",
    type: "kyc_renewal",
    dueOffsetDays: 7,
    priority: "high",
    remarks: "AMFI 2024 — re-KYC must be initiated 30+ days before expiry.",
  },
  {
    title: "Reconcile brokerage statements with AMC remittances (previous month)",
    type: "reconciliation",
    dueOffsetDays: 10,
    priority: "high",
    remarks: "Match brokerage_reconciliation rows against AMC settlement file.",
  },
  {
    title: "Review SEBI complaints — close any past TAT",
    type: "complaint_review",
    dueOffsetDays: 7,
    priority: "high",
    remarks: "SEBI TAT is 21 calendar days. Anything older = report.",
  },
  {
    title: "Audit ARN / EUIN / NISM validity for all RMs",
    type: "rm_validity_audit",
    dueOffsetDays: 14,
    priority: "high",
    remarks: "Use the EUIN tracker; renew before expiry to keep transactions valid.",
  },
  {
    title: "Verify nominee on file for all AUM > ₹1L clients",
    type: "nominee_audit",
    dueOffsetDays: 14,
    priority: "normal",
    remarks: "AMFI guidance — mandatory nominee for high-AUM individuals.",
  },
  {
    title: "Run DDQ score, file the snapshot in vault",
    type: "ddq_snapshot",
    dueOffsetDays: 14,
    priority: "high",
    remarks: "Required for auditor visibility + month-over-month trend tracking.",
  },
  {
    title: "Risk-profile audit — flag profiles signed > 365 days ago",
    type: "risk_profile_audit",
    dueOffsetDays: 14,
    priority: "normal",
    remarks: "AMFI: risk profile must be refreshed annually.",
  },
  {
    title: "Review marketing creatives sent this month against compliance gate logs",
    type: "marketing_audit",
    dueOffsetDays: 10,
    priority: "normal",
    remarks: "Sample 10% of marketing dispatches; verify each ran through compliance gate.",
  },
  {
    title: "Confirm document retention — KYC docs older than 7 years can purge",
    type: "doc_retention",
    dueOffsetDays: 21,
    priority: "normal",
    remarks: "DPDP Act + SEBI joint retention rules.",
  },
  {
    title: "Update / acknowledge new SEBI circulars (last month)",
    type: "circular_review",
    dueOffsetDays: 7,
    priority: "high",
    remarks: "Owner and compliance team acknowledgement required.",
  },
  {
    title: "Train team on top open service-request categories from previous month",
    type: "team_training",
    dueOffsetDays: 21,
    priority: "normal",
    remarks: "5-minute huddle covering the 3 most common SR types.",
  },
];

interface SeedResult {
  tenantId: string;
  created: number;
  skippedExisting: number;
  durationMs: number;
}

async function listActiveTenants(): Promise<string[]> {
  return await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT id FROM tenants WHERE status IN ('active', 'trial')
    `);
    return (r.rows as Array<{ id: string }>).map((row) => row.id);
  });
}

/**
 * Seed the checklist for one tenant. Idempotent via the
 * `Monthly compliance — YYYY-MM` prefix in `remarks` — second run
 * skips any task already present for that month.
 */
export async function seedTenant(tenantId: string, monthDate?: Date): Promise<SeedResult> {
  const started = Date.now();
  const when = monthDate ?? new Date();
  const monthKey = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}`;
  const remarkPrefix = `Monthly compliance — ${monthKey}`;

  let created = 0;
  let skipped = 0;

  await withTenant(
    tenantId,
    async (tx) => {
      // Find the compliance lead (first user with compliance role) to assign
      // these to. Falls back to the owner if no compliance role is set.
      const ownerRow = await tx.execute(sql`
        SELECT id FROM users
         WHERE tenant_id = ${tenantId}::uuid
           AND status = 'active'
           AND ('compliance' = ANY(roles) OR 'owner' = ANY(roles))
         ORDER BY ('compliance' = ANY(roles)) DESC, ('owner' = ANY(roles)) DESC
         LIMIT 1
      `);
      const assigneeId = (ownerRow.rows[0] as any)?.id as string | undefined;
      if (!assigneeId) {
        console.warn(
          `[monthly-compliance] tenant ${tenantId} has no compliance or owner user — skipping`
        );
        return;
      }

      // Skip-existing check: load any tasks already seeded this month.
      const existing = await tx.execute(sql`
        SELECT title FROM tasks
         WHERE tenant_id = ${tenantId}::uuid
           AND department = 'compliance'
           AND status = 'open'
           AND COALESCE(remarks, '') LIKE ${`${remarkPrefix}%`}
      `);
      const haveTitles = new Set((existing.rows as any[]).map((r) => r.title as string));

      for (const item of CHECKLIST) {
        if (haveTitles.has(item.title)) {
          skipped++;
          continue;
        }
        const dueAt = new Date(when);
        dueAt.setDate(when.getDate() + item.dueOffsetDays);
        await tx.insert(tasks).values({
          id: uuid(),
          tenantId,
          subjectType: "internal",
          subjectId: null,
          assigneeId,
          createdById: assigneeId,
          title: item.title,
          type: item.type,
          status: "open",
          priority: item.priority,
          dueAt,
          department: "compliance" as any,
          remarks: `${remarkPrefix}\n${item.remarks}`,
        } as any);
        created++;
      }
    },
    { roles: ["system"] }
  );

  return { tenantId, created, skippedExisting: skipped, durationMs: Date.now() - started };
}

export async function runMonthlyComplianceSweep(_monthDate?: Date) {
  // Monthly compliance-checklist task seeding is DISABLED per firm preference
  // ("turn off all auto tasks"). The per-tenant seedTenant()/CHECKLIST logic is
  // preserved in git history — restore this body to re-enable the monthly
  // SEBI-checklist auto-tasks.
  return { tenants: 0, created: 0, skipped: 0, failed: [] as string[], durationMs: 0 };
}
