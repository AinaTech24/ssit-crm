import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/super-admin/tenants/[id]/purge
 *
 * PERMANENT (hard) delete of an already-soft-deleted tenant and ALL its data.
 * Irreversible — only allowed once the tenant is in the soft-deleted state, so
 * the destructive action is a deliberate two-step (soft delete → purge). Runs
 * the `platform_purge_tenant()` function inside a single transaction.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { tenants } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tenantId } = await params;
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.tenant.delete");

    const result = await withPlatformAdmin(session.userId, async (tx) => {
      const t = (await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0];
      if (!t) throw Object.assign(new Error("tenant not found"), { status: 404 });
      // Guard: only purge tenants that are already soft-deleted. This keeps the
      // irreversible step deliberate (must soft-delete first) and prevents an
      // accidental one-click wipe of a live tenant.
      if (!(t as any).deletedAt) {
        throw Object.assign(
          new Error("tenant must be soft-deleted before it can be permanently purged"),
          { status: 400 }
        );
      }
      // A purge sweeps ~160 tables. The pool default (30s) is sized for user
      // requests, and a busy database made this admin action time out — which
      // surfaced as a bare "internal". Give it room, but cap how long it will
      // sit behind someone else's lock so it fails fast and clearly instead.
      await tx.execute(sql`SET LOCAL statement_timeout = '180s'`);
      await tx.execute(sql`SET LOCAL lock_timeout = '20s'`);
      await tx.execute(sql`SELECT platform_purge_tenant(${tenantId}::uuid)`);
      return { ok: true };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
