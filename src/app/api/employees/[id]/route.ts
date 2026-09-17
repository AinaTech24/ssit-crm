import { handleApiError } from "@/lib/api/error-handler";
/**
 * PATCH /api/employees/[id]
 *   Update the HR / Module-19 fields on a team member.
 *
 * DELETE /api/employees/[id]
 *   Soft-offboard (status='offboarded', offboarded_at=now()).
 *
 * GET /api/employees/[id]
 *   Read one employee + key counts.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/client";
import { users, branches } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, areAssignableRoles, areKnownCapabilities } from "@/lib/auth/rbac";
import { wouldExceedFirmAdminCap, MAX_FIRM_ADMINS_MESSAGE } from "@/lib/auth/firm-admin-guard";
import { areKnownNavKeys } from "@/config/nav-access";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { offboardUser, type OffboardSummary } from "@/lib/offboarding";
import { clearSessionRevocationCache, clearDeviceSessionCache } from "@/lib/auth/revocation";

export const dynamic = "force-dynamic";

/** Active owners in the tenant other than `excludeUserId` — guards the last-owner rule. */
async function countOtherActiveOwners(tx: Tx, tenantId: string, excludeUserId: string): Promise<number> {
  const r = await tx.execute(sql`
    SELECT COUNT(*)::int AS c FROM users
    WHERE tenant_id = ${tenantId}::uuid AND id <> ${excludeUserId}::uuid
      AND status = 'active' AND 'owner' = ANY(roles)
  `);
  return Number((r.rows[0] as any)?.c ?? 0);
}

const PatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  phone: z.string().max(40).optional().nullable(),
  roles: z.array(z.string()).min(1).optional(),
  department: z
    .enum([
      "sales",
      "operations",
      "back_office",
      "compliance",
      "marketing",
      "advisory",
      "support",
      "leadership",
      "other",
    ])
    .nullable()
    .optional(),
  joiningDate: z.string().nullable().optional(), // ISO date "YYYY-MM-DD"
  reportingManagerId: z.string().uuid().nullable().optional(),
  annualTarget: z.number().nonnegative().nullable().optional(),
  sipMonthlyTarget: z.number().nonnegative().nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  // ARN / EUIN / NISM / DSC — full Network FP template parity.
  employeeCode: z.string().max(40).nullable().optional(),
  distributingAmcs: z.array(z.string().max(40)).max(60).nullable().optional(),
  euin: z
    .string()
    .regex(/^E\d{6}$/i, "EUIN format: E + 6 digits")
    .nullable()
    .optional(),
  euinExpiryAt: z.string().nullable().optional(),
  nismCertificateNo: z.string().max(80).nullable().optional(),
  nismExamDate: z.string().nullable().optional(),
  nismExpiryAt: z.string().nullable().optional(),
  nismCategory: z.string().max(20).nullable().optional(),
  personalArn: z
    .string()
    .regex(/^ARN-?\d{1,8}$/i, "ARN format: ARN-XXXXXX")
    .nullable()
    .optional(),
  arnRegistrationDate: z.string().nullable().optional(),
  arnExpiryAt: z.string().nullable().optional(),
  dscSubmitted: z.boolean().nullable().optional(),
  dscLastSubmittedAt: z.string().nullable().optional(),
  dscExpiryAt: z.string().nullable().optional(),
  status: z.enum(["invited", "active", "suspended", "offboarding", "offboarded"]).optional(),
  branchId: z.string().uuid().nullable().optional(),
  permissions: z.array(z.string()).nullable().optional(),
  /** Per-user sidebar module access. null = inherit all tenant modules. */
  enabledModules: z.array(z.string()).nullable().optional(),
  /**
   * Per-user BRANCH data access (migration 0216). null / [] = the default wall
   * (own records only); a list = every record in those branches. Validated as
   * uuids here so a malformed value can never reach a ::uuid cast at query time.
   */
  allowedBranches: z.array(z.string().uuid()).nullable().optional(),
  delegatesFor: z.array(z.string().uuid()).nullable().optional(),
  restrictToOwnRecords: z.boolean().optional(),
  customLeaveEntitlements: z.record(z.number()).nullable().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  // HR/PII (certificates, permissions, targets) — owner/admin only, matching the
  // PATCH/DELETE write paths. Without this any authenticated user could read a
  // colleague's full record by id.
  requireCap(session.roles, "settings.users", session.permissions);
  const { id } = await params;
  const data = await withTenant(session.tenantId, async (tx) => {
    // Tenant predicate is mandatory under the superuser/RLS-bypass model —
    // without it any owner could read another tenant's user (HR data, certs, PII) by id.
    const [u] = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.tenantId, session.tenantId)));
    if (!u) return null;

    // Counts used in detail view
    const stats = await tx.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM investors WHERE rm_id = ${id}::uuid AND status = 'active') AS active_clients,
        (SELECT COALESCE(SUM(aum::numeric),0)::numeric FROM investors WHERE rm_id = ${id}::uuid AND status = 'active') AS my_aum,
        (SELECT COALESCE(SUM(active_sip_amount::numeric),0)::numeric FROM investors WHERE rm_id = ${id}::uuid AND status = 'active') AS my_sip,
        (SELECT COUNT(*)::int FROM tasks WHERE assignee_id = ${id}::uuid AND status IN ('open','in_progress')) AS open_tasks,
        (SELECT COUNT(*)::int FROM tasks WHERE assignee_id = ${id}::uuid AND status IN ('open','in_progress') AND due_at < now()) AS overdue_tasks,
        (SELECT COUNT(*)::int FROM review_meetings WHERE rm_id = ${id}::uuid AND status IN ('scheduled','confirmed') AND meeting_date >= now()) AS upcoming_meetings
    `);
    return { user: u, stats: stats.rows[0] };
  });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    const { id } = await params;

    const parse = PatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;

    // Never let a tenant admin assign a platform role or an unknown capability.
    if (body.roles !== undefined && !areAssignableRoles(body.roles)) {
      return NextResponse.json({ error: "one or more roles are not assignable" }, { status: 400 });
    }
    if (body.permissions != null && !areKnownCapabilities(body.permissions)) {
      return NextResponse.json({ error: "one or more permissions are not recognised" }, { status: 400 });
    }
    if (body.enabledModules != null && !areKnownNavKeys(body.enabledModules)) {
      return NextResponse.json({ error: "one or more sidebar items are not recognised" }, { status: 400 });
    }

    const meta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(users)
        .where(and(eq(users.id, id), eq(users.tenantId, session.tenantId)));
      if (!existing) return null;

      // A reassigned branch must belong to this tenant (defense-in-depth —
      // prevents a foreign/dangling branch_id landing on the user row).
      if (body.branchId) {
        const [b] = await tx
          .select({ id: branches.id })
          .from(branches)
          .where(and(eq(branches.id, body.branchId), eq(branches.tenantId, session.tenantId)))
          .limit(1);
        if (!b) throw Object.assign(new Error("That branch doesn't belong to your firm."), { status: 400 });
      }

      // Lockout guards.
      const isSelf = id === session.userId;
      if (isSelf && body.status === "offboarded") {
        throw Object.assign(new Error("you cannot offboard your own account"), { status: 400 });
      }
      const wasOwner = (existing.roles as string[] | null)?.includes("owner") ?? false;
      const losesOwner =
        wasOwner &&
        ((body.status !== undefined && ["offboarded", "suspended"].includes(body.status)) ||
          (body.roles !== undefined && !body.roles.includes("owner")));
      if (losesOwner && (await countOtherActiveOwners(tx, session.tenantId, id)) === 0) {
        throw Object.assign(new Error("cannot remove the last active owner of the firm"), { status: 409 });
      }

      // Upper bound, mirroring the lower one above. Two ways to gain a seat:
      // being granted the role, or being re-activated while already holding it.
      // `id` is excluded from the count so re-saving an existing owner is not
      // read as adding a third.
      const willBeOwner = body.roles !== undefined ? body.roles.includes("owner") : wasOwner;
      const willBeActive =
        body.status !== undefined ? body.status === "active" : existing.status === "active";
      const heldSeat = wasOwner && existing.status === "active";
      if (willBeOwner && willBeActive && !heldSeat) {
        if (await wouldExceedFirmAdminCap(tx, session.tenantId, id)) {
          throw Object.assign(new Error(MAX_FIRM_ADMINS_MESSAGE), { status: 409 });
        }
      }

      const patch: any = { updatedAt: new Date() };
      if (body.name !== undefined) patch.name = body.name;
      if (body.phone !== undefined) patch.phone = body.phone;
      if (body.roles !== undefined) patch.roles = body.roles;
      if (body.department !== undefined) patch.department = body.department;
      if (body.joiningDate !== undefined) patch.joiningDate = body.joiningDate;
      if (body.reportingManagerId !== undefined) patch.reportingManagerId = body.reportingManagerId;
      if (body.annualTarget !== undefined) patch.annualTarget = body.annualTarget?.toString() ?? null;
      if (body.sipMonthlyTarget !== undefined) patch.sipMonthlyTarget = body.sipMonthlyTarget?.toString() ?? null;
      if (body.notes !== undefined) patch.notes = body.notes;
      if (body.employeeCode !== undefined) patch.employeeCode = body.employeeCode;
      if (body.distributingAmcs !== undefined) patch.distributingAmcs = body.distributingAmcs;
      if (body.euin !== undefined) patch.euin = body.euin;
      if (body.euinExpiryAt !== undefined) patch.euinExpiryAt = body.euinExpiryAt;
      if (body.nismCertificateNo !== undefined) patch.nismCertificateNo = body.nismCertificateNo;
      if (body.nismExamDate !== undefined) patch.nismExamDate = body.nismExamDate;
      if (body.nismExpiryAt !== undefined) patch.nismExpiryAt = body.nismExpiryAt;
      if (body.nismCategory !== undefined) patch.nismCategory = body.nismCategory;
      if (body.personalArn !== undefined) patch.personalArn = body.personalArn;
      if (body.arnRegistrationDate !== undefined) patch.arnRegistrationDate = body.arnRegistrationDate;
      if (body.arnExpiryAt !== undefined) patch.arnExpiryAt = body.arnExpiryAt;
      if (body.dscSubmitted !== undefined) patch.dscSubmitted = body.dscSubmitted;
      if (body.dscLastSubmittedAt !== undefined) patch.dscLastSubmittedAt = body.dscLastSubmittedAt;
      if (body.dscExpiryAt !== undefined) patch.dscExpiryAt = body.dscExpiryAt;
      if (body.branchId !== undefined) patch.branchId = body.branchId;
      if (body.permissions !== undefined) patch.permissions = body.permissions;
      if (body.enabledModules !== undefined) patch.enabledModules = body.enabledModules;
      if (body.allowedBranches !== undefined) patch.allowedBranches = body.allowedBranches;
      if (body.delegatesFor !== undefined) patch.delegatesFor = body.delegatesFor;
      if (body.restrictToOwnRecords !== undefined) patch.restrictToOwnRecords = body.restrictToOwnRecords;
      if (body.customLeaveEntitlements !== undefined) patch.customLeaveEntitlements = body.customLeaveEntitlements;
      // Access lives in the signed session token, so a permission / role /
      // sidebar change is invisible to whoever is already logged in until they
      // sign in again. An owner ticking boxes and seeing nothing happen is
      // exactly the bug this endpoint is used to fix, so an access change now
      // ends that user's sessions and they pick up the new grants on next
      // sign-in. Compared field-by-field so an idempotent PATCH is a no-op.
      const sameList = (a: unknown, b: unknown) =>
        JSON.stringify(Array.isArray(a) ? [...a].sort() : a ?? null) ===
        JSON.stringify(Array.isArray(b) ? [...b].sort() : b ?? null);
      const accessChanged =
        (body.permissions !== undefined && !sameList(body.permissions, (existing as any).permissions)) ||
        (body.roles !== undefined && !sameList(body.roles, (existing as any).roles)) ||
        (body.enabledModules !== undefined && !sameList(body.enabledModules, (existing as any).enabledModules)) ||
        // A branch grant widens what this person can SEE, so it belongs in the
        // same audit trail as a role or permission change.
        (body.allowedBranches !== undefined && !sameList(body.allowedBranches, existing.allowedBranches)) ||
        // Handing over (or taking back) a colleague's calendar widens/narrows
        // what this person can see and do, so it revokes the session too.
        (body.delegatesFor !== undefined && !sameList(body.delegatesFor, (existing as any).delegatesFor)) ||
        // Narrowing someone to their own records must bite immediately, not
        // whenever their current token happens to expire.
        (body.restrictToOwnRecords !== undefined &&
          body.restrictToOwnRecords !== existing.restrictToOwnRecords);
      // users.sessions_invalid_after is the revocation epoch the token check
      // actually reads — revoking the user_sessions rows alone only tidies the
      // device list and would leave the old token working.
      if (accessChanged) patch.sessionsInvalidAfter = new Date();

      const deactivating =
        body.status !== undefined &&
        (body.status === "suspended" || body.status === "offboarded") &&
        existing.status !== body.status;
      if (body.status !== undefined) {
        patch.status = body.status;
        if (body.status === "offboarded") patch.offboardedAt = new Date();
        // Deactivating (suspend) must log the user out everywhere too — offboard
        // already does this via offboardUser(), but suspend didn't.
        if (deactivating) patch.sessionsInvalidAfter = new Date();
      }

      const [next] = await tx
        .update(users)
        .set(patch)
        .where(and(eq(users.id, id), eq(users.tenantId, session.tenantId)))
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "employee.update",
        entityType: "user",
        entityId: id,
        before: existing,
        after: next,
        ...meta,
      });

      // Revoke recorded device sessions so a suspended/offboarded user drops off
      // their "devices" list and is kicked immediately.
      if (deactivating || accessChanged) {
        await tx.execute(
          sql`UPDATE user_sessions SET revoked_at = now(), updated_at = now() WHERE user_id = ${id}::uuid AND revoked_at IS NULL`
        );
      }

      // Run the cascade only on the actual transition into offboarded —
      // skip the work if the user was already offboarded (idempotent
      // PATCHes shouldn't re-create the "redistribute clients" task).
      let cascade: OffboardSummary | null = null;
      if (
        body.status === "offboarded" &&
        existing.status !== "offboarded"
      ) {
        cascade = await offboardUser({
          tx,
          tenantId: session.tenantId,
          userId: id,
          actorUserId: session.userId,
        });
      }

      return { user: next, cascade, deactivated: deactivating };
    });

    if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Kick the just-deactivated user on their next request (drop cached epochs).
    if ((result as any).deactivated) {
      clearSessionRevocationCache(id);
      clearDeviceSessionCache();
    }
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

/**
 * DELETE /api/employees/[id]
 *   ?trash=1  → move the employee to Trash (soft-delete). Recoverable; the
 *               record is hidden from the team list and blocked at login until
 *               restored. This is NOT the same as offboarding — clients stay
 *               assigned and nothing is redistributed.
 *   ?purge=1  → permanent removal FROM Trash. A hard row-delete is unsafe
 *               (dozens of tables FK to users with ON DELETE RESTRICT), so this
 *               runs the full offboard cascade (redistribute clients/tasks,
 *               revoke sessions) and marks the user offboarded — preserving
 *               audit/history while making the removal final.
 *   (default) → legacy offboard (status='offboarded' + cascade).
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    const { id } = await params;
    const meta = clientMetaFromHeaders(req.headers);
    const mode = req.nextUrl.searchParams.get("trash") === "1"
      ? "trash"
      : req.nextUrl.searchParams.get("purge") === "1"
        ? "purge"
        : "offboard";

    const result = await withTenant(session.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(users)
        .where(and(eq(users.id, id), eq(users.tenantId, session.tenantId)));
      if (!existing) return null;

      // Lockout guards: can't remove yourself, and can't remove the last owner.
      if (id === session.userId) {
        throw Object.assign(new Error("you cannot remove your own account"), { status: 400 });
      }
      if (((existing.roles as string[] | null)?.includes("owner") ?? false) && (await countOtherActiveOwners(tx, session.tenantId, id)) === 0) {
        throw Object.assign(new Error("cannot remove the last active owner of the firm"), { status: 409 });
      }

      // ── Move to Trash (soft-delete) ──────────────────────────────────────
      if (mode === "trash") {
        const [next] = await tx
          .update(users)
          .set({
            deletedAt: new Date(),
            deletedBy: session.userId,
            // Kick every live session so a trashed user is logged out at once.
            sessionsInvalidAfter: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(users.id, id), eq(users.tenantId, session.tenantId)))
          .returning();
        await tx.execute(
          sql`UPDATE user_sessions SET revoked_at = now(), updated_at = now() WHERE user_id = ${id}::uuid AND revoked_at IS NULL`
        );
        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "employee.trash",
          entityType: "user",
          entityId: id,
          before: existing,
          after: next,
          ...meta,
        });
        return { user: next, cascade: null, kicked: true };
      }

      // ── Offboard, or permanent removal from Trash ────────────────────────
      // Both end in status='offboarded' + cascade. Purge additionally clears
      // the deleted_at flag so the row leaves Trash.
      const [next] = await tx
        .update(users)
        .set({
          status: "offboarded",
          offboardedAt: new Date(),
          ...(mode === "purge" ? { deletedAt: null, deletedBy: null } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(users.id, id), eq(users.tenantId, session.tenantId)))
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: mode === "purge" ? "employee.purge" : "employee.offboard",
        entityType: "user",
        entityId: id,
        before: existing,
        after: next,
        ...meta,
      });

      // Only cascade on the actual transition into offboarded.
      let cascade: OffboardSummary | null = null;
      if (existing.status !== "offboarded") {
        cascade = await offboardUser({
          tx,
          tenantId: session.tenantId,
          userId: id,
          actorUserId: session.userId,
        });
      }

      return { user: next, cascade, kicked: existing.status !== "offboarded" };
    });

    if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Drop cached session epochs so the removed user is kicked on next request.
    if ((result as any).kicked) {
      clearSessionRevocationCache(id);
      clearDeviceSessionCache();
    }
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
