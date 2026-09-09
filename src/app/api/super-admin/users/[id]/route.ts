import { handleApiError } from "@/lib/api/error-handler";
/**
 * Equitywala platform-staff update + delete.
 *
 * Companion to POST /api/super-admin/users (create). Only platform admins may
 * call these, and only rows inside the PLATFORM tenant are reachable — an MFD
 * user in a real tenant can never be edited through this route.
 *
 * LOCKOUT GUARDS (the reason this file is longer than it looks like it should be):
 *   1. You cannot delete, suspend or demote YOURSELF. Losing your own access in
 *      one click is the classic admin-panel footgun.
 *   2. You cannot remove the LAST active Super Admin, by delete, by suspend, or
 *      by demotion to Admin. Without this, one careless edit locks every human
 *      out of the platform console permanently — there is no self-service
 *      recovery for the platform tenant.
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { PLATFORM_TENANT_ID } from "@/lib/platform";
import {
  activeSuperAdminCount,
  demoteOtherSuperAdmins,
  TRANSFER_SUPER_ADMIN_MESSAGE,
} from "@/lib/auth/super-admin-guard";

export const dynamic = "force-dynamic";

const Patch = z.object({
  name: z.string().min(2).max(120).optional(),
  role: z.enum(["platform_admin", "platform_support"]).optional(),
  /** Confirms handing the single Super Admin seat over, demoting the incumbent. */
  transferSuperAdmin: z.boolean().optional(),
  status: z.enum(["active", "suspended"]).optional(),
  password: z.string().min(8).max(200).optional(),
});

/** Active Super Admins other than `exceptId`. Used by every lockout guard. */
async function otherActiveSuperAdmins(tx: any, exceptId: string): Promise<number> {
  const r = await tx.execute(sql`
    SELECT count(*)::int AS n FROM users
    WHERE tenant_id = ${PLATFORM_TENANT_ID}::uuid
      AND id <> ${exceptId}
      AND status = 'active'
      AND 'platform_admin' = ANY(roles)
  `);
  return Number(r.rows[0]?.n ?? 0);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.staff.manage");
    const { id } = await params;

    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const body = parse.data;
    if (Object.keys(body).length === 0) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }

    const demoting = body.role === "platform_support";
    const suspending = body.status === "suspended";
    if (id === session.userId && (demoting || suspending)) {
      return NextResponse.json(
        { error: "You can't suspend or demote your own account." },
        { status: 409 }
      );
    }

    const result = await withPlatformAdmin(session.userId, async (tx) => {
      const cur = await tx.execute(sql`
        SELECT id, roles, status FROM users
        WHERE id = ${id} AND tenant_id = ${PLATFORM_TENANT_ID}::uuid LIMIT 1
      `);
      const row = cur.rows[0] as { roles: string[]; status: string } | undefined;
      if (!row) return { error: "not found", status: 404 };

      const wasSuper = (row.roles ?? []).includes("platform_admin");

      // Upper bound. Two ways to end up with a second Super Admin: promoting an
      // Admin, or re-activating a suspended Super Admin while another is live.
      // Both are blocked; the lower bound below still stops the last one going.
      const willBeSuper = body.role ? body.role === "platform_admin" : wasSuper;
      const willBeActive = body.status ? body.status === "active" : row.status === "active";
      const wasCounted = wasSuper && row.status === "active";
      if (willBeSuper && willBeActive && !wasCounted) {
        if ((await activeSuperAdminCount(tx, id)) > 0) {
          // A transfer is the ONLY way past this, and it must be asked for —
          // silently demoting whoever currently holds the role would be a
          // surprising side effect of editing someone else's record.
          if (!body.transferSuperAdmin) {
            return { error: TRANSFER_SUPER_ADMIN_MESSAGE, status: 409 };
          }
          await demoteOtherSuperAdmins(tx, id);
        }
      }

      if (wasSuper && (demoting || suspending)) {
        if ((await otherActiveSuperAdmins(tx, id)) === 0) {
          return {
            error: "This is the last active Super Admin — promote another admin first.",
            status: 409,
          };
        }
      }

      const sets = [];
      if (body.name !== undefined) sets.push(sql`name = ${body.name}`);
      if (body.status !== undefined) sets.push(sql`status = ${body.status}`);
      if (body.role !== undefined) {
        sets.push(sql`roles = ${sql.raw(`ARRAY['${body.role}']::text[]`)}`);
      }
      if (body.password !== undefined) {
        sets.push(sql`password_hash = ${await bcrypt.hash(body.password, 12)}`);
      }
      sets.push(sql`updated_at = now()`);

      await tx.execute(sql`
        UPDATE users SET ${sql.join(sets, sql`, `)}
        WHERE id = ${id} AND tenant_id = ${PLATFORM_TENANT_ID}::uuid
      `);
      return { ok: true };
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.staff.manage");
    const { id } = await params;

    if (id === session.userId) {
      return NextResponse.json({ error: "You can't delete your own account." }, { status: 409 });
    }

    const result = await withPlatformAdmin(session.userId, async (tx) => {
      const cur = await tx.execute(sql`
        SELECT id, roles FROM users
        WHERE id = ${id} AND tenant_id = ${PLATFORM_TENANT_ID}::uuid LIMIT 1
      `);
      const row = cur.rows[0] as { roles: string[] } | undefined;
      if (!row) return { error: "not found", status: 404 };

      if ((row.roles ?? []).includes("platform_admin")) {
        if ((await otherActiveSuperAdmins(tx, id)) === 0) {
          return {
            error: "This is the last active Super Admin — promote another admin first.",
            status: 409,
          };
        }
      }

      await tx.execute(sql`
        DELETE FROM users WHERE id = ${id} AND tenant_id = ${PLATFORM_TENANT_ID}::uuid
      `);
      return { ok: true };
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
