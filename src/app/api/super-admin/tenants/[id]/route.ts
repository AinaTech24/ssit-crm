import { handleApiError } from "@/lib/api/error-handler";
/**
 * Platform-admin tenant administration.
 *
 *   PATCH  /api/super-admin/tenants/[id]   — update the contact email
 *   DELETE /api/super-admin/tenants/[id]   — soft delete (deleted_at), guarded
 *           by a typed-ARN confirmation. Also cancels the live subscription.
 *
 * Soft (not hard) delete on purpose: domain `tenant_id` columns carry no FK to
 * tenants and domain tables have inter-table FKs, so a blind purge would orphan
 * or FK-fail. Soft delete hides the tenant + blocks its logins, and is
 * reversible (clear deleted_at).
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { tenants, subscriptions, subscriptionEvents, users, packages } from "@/db/schema";
import { PLATFORM_TENANT_ID } from "@/lib/platform";

export const dynamic = "force-dynamic";

const Patch = z.object({
  // A real email to set, or "" to clear it.
  email: z.union([z.string().email(), z.literal("")]).optional(),
  // Firm identity — editable after creation.
  displayName: z.string().trim().min(2).optional(),
  legalName: z.string().trim().min(2).optional(),
  // ARN is optional — provide a value to set it, or "" to clear it.
  arn: z.string().trim().optional(),
  // Owner user — name + login email.
  ownerName: z.string().trim().min(2).optional(),
  ownerEmail: z.string().email().optional(),
  // Subscription — package + billing cycle.
  packageKey: z.string().trim().min(1).optional(),
  billingCycle: z.enum(["monthly", "yearly", "custom"]).optional(),
  // Data wall: when true, users only see the clients their role entitles them
  // to (RM = own book). Default false = firm-wide, as every tenant has had.
  restrictUserDataScope: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tenantId } = await params;
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.tenant.edit");
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid input", issues: parse.error.issues }, { status: 400 });
    const d = parse.data;

    const result = await withPlatformAdmin(session.userId, async (tx) => {
      const t = (await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0];
      if (!t) throw Object.assign(new Error("tenant not found"), { status: 404 });

      // Build a partial update from whatever fields were sent.
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (d.email !== undefined) set.email = d.email.trim().toLowerCase() || null;
      if (d.displayName !== undefined) set.displayName = d.displayName;
      if (d.restrictUserDataScope !== undefined) set.restrictUserDataScope = d.restrictUserDataScope;
      if (d.legalName !== undefined) set.legalName = d.legalName;
      if (d.arn !== undefined) {
        const arn = d.arn.trim() || null;
        // Enforce ARN uniqueness across live tenants (the DB unique index also
        // guards this, but a clear 409 beats a raw constraint error).
        if (arn) {
          const clash = await tx.execute(sql`
            SELECT 1 FROM tenants WHERE lower(arn) = lower(${arn}) AND id <> ${tenantId}::uuid AND deleted_at IS NULL LIMIT 1
          `);
          if (clash.rows.length) throw Object.assign(new Error("Another active tenant already uses this ARN"), { status: 409 });
        }
        set.arn = arn;
      }

      if (Object.keys(set).length > 1) {
        await tx.update(tenants).set(set as any).where(eq(tenants.id, tenantId));
      }

      // ── Owner user (name / login email) ────────────────────────────────
      if (d.ownerName !== undefined || d.ownerEmail !== undefined) {
        const owner = (await tx.execute(sql`
          SELECT id FROM users WHERE tenant_id = ${tenantId}::uuid AND 'owner' = ANY(roles) AND status <> 'inactive'
          ORDER BY created_at ASC LIMIT 1
        `)).rows[0] as any;
        if (owner?.id) {
          const uset: Record<string, unknown> = { updatedAt: new Date() };
          if (d.ownerName !== undefined) uset.name = d.ownerName;
          if (d.ownerEmail !== undefined) {
            const oe = d.ownerEmail.trim().toLowerCase();
            const clash = (await tx.execute(sql`
              SELECT 1 FROM users WHERE lower(email) = ${oe} AND id <> ${owner.id}::uuid LIMIT 1
            `)).rows.length;
            if (clash) throw Object.assign(new Error("Another user already uses this email"), { status: 409 });
            uset.email = oe;
          }
          await tx.update(users).set(uset as any).where(eq(users.id, owner.id));
        }
      }

      // ── Subscription (package / billing cycle) ─────────────────────────
      if (d.packageKey !== undefined || d.billingCycle !== undefined) {
        const sub = (await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1))[0];
        if (sub) {
          const sset: Record<string, unknown> = { updatedAt: new Date() };
          if (d.packageKey !== undefined) {
            const pkg = (await tx.select().from(packages).where(eq(packages.key, d.packageKey)).limit(1))[0];
            if (!pkg) throw Object.assign(new Error(`unknown package: ${d.packageKey}`), { status: 400 });
            sset.packageId = pkg.id;
            sset.packageKey = pkg.key;
          }
          if (d.billingCycle !== undefined) sset.billingCycle = d.billingCycle;
          await tx.update(subscriptions).set(sset as any).where(eq(subscriptions.id, sub.id));
        }
      }

      return { ok: true };
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

const Del = z.object({ confirmArn: z.string().min(1) });

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tenantId } = await params;
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.tenant.delete");

    // The platform tenant is a sentinel that owns every platform_admin user. It
    // is not a customer firm and must never be deletable. Soft-deleting it does
    // not remove those users - they stay active - but login joins users to
    // tenants and rejects a session whose tenant is deleted, so EVERY admin gets
    // "account inactive" and nobody can reach /super-admin to undo it. Recovery
    // requires direct database access (scripts/restore-platform-tenant.js).
    if (tenantId === PLATFORM_TENANT_ID) {
      return NextResponse.json(
        { error: "The platform tenant cannot be deleted - it owns every admin account." },
        { status: 400 }
      );
    }
    const parse = Del.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "confirmArn required" }, { status: 400 });
    const confirmArn = parse.data.confirmArn.trim();

    const result = await withPlatformAdmin(session.userId, async (tx) => {
      const t = (await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0];
      if (!t) throw Object.assign(new Error("tenant not found"), { status: 404 });
      // Typed-confirmation guard (case-insensitive): the ARN must match — or,
      // for ARN-less tenants, the firm's brand/legal name (so a firm with no ARN
      // can still be deleted by typing its name).
      const accepted = [t.arn, t.displayName, t.legalName]
        .filter(Boolean)
        .map((v) => String(v).toLowerCase());
      if (!accepted.includes(confirmArn.toLowerCase())) {
        throw Object.assign(new Error("Confirmation does not match the tenant's ARN or name"), { status: 400 });
      }
      if ((t as any).deletedAt) return { ok: true, alreadyDeleted: true };

      // Soft delete AND free the ARN (suffix it) so the same ARN can be used to
      // create a fresh tenant later — the unique index would otherwise keep it
      // reserved forever by the hidden row.
      await tx.execute(sql`
        UPDATE tenants
        SET deleted_at = now(),
            deleted_by = ${session.userId}::uuid,
            arn = arn || '_deleted_' || to_char(now(), 'YYYYMMDDHH24MISS'),
            updated_at = now()
        WHERE id = ${tenantId}::uuid
      `);

      // Cancel the live subscription too, so billing/cron stop touching it.
      const sub = (await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1))[0];
      if (sub && sub.status !== "cancelled") {
        const fromStatus = sub.status;
        await tx
          .update(subscriptions)
          .set({ status: "cancelled", cancelledAt: new Date(), cancelledReason: "Tenant deleted by Equitywala", updatedAt: new Date() } as any)
          .where(eq(subscriptions.id, sub.id));
        await tx.insert(subscriptionEvents).values({
          subscriptionId: sub.id,
          tenantId,
          eventType: "cancelled" as any,
          actor: `ssit_admin:${session.userId}`,
          fromStatus,
          toStatus: "cancelled",
          notes: "Tenant deleted (soft) by Equitywala",
        } as any);
      }
      return { ok: true };
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
