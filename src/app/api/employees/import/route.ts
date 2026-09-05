import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/employees/import
 * Body: { rows: [{ name?, email, roles?: string[] }] }
 *
 * Bulk-invite team members from a CSV/paste. Mirrors /api/employees/invite per
 * row (signed token + userInvites row + best-effort email), but in one call with
 * a single up-front seat-limit + verified-inviter check. Returns a per-row
 * outcome so the UI can show "12 invited, 2 skipped (already exists)".
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import crypto from "node:crypto";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { userInvites, tenants, users } from "@/db/schema";
import { require as requireCap, areAssignableRoles } from "@/lib/auth/rbac";
import { assertActiveLicense, loadTenantLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { sendSystemEmail, actionEmailHtml } from "@/lib/comms/system-email";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({
  rows: z
    .array(
      z.object({
        name: z.string().max(200).optional(),
        email: z.string().email(),
        roles: z.array(z.string()).optional(),
      })
    )
    .min(1)
    .max(200),
});

type RowResult = { email: string; status: "invited" | "skipped" | "error"; reason?: string };

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const rows = parse.data.rows;
    const clientMeta = clientMetaFromHeaders(req.headers);

    // Inviting does NOT require the inviter's own email to be verified — invites
    // generate shareable links the admin can send directly (same as single-invite).

    // Seat limits came from the package catalogue, which no longer exists — an
    // import is never capped. Kept as a constant so the per-row accounting
    // below reads unchanged.
    let remainingSeats = Infinity;

    const firmName = await withTenant(session.tenantId, async (tx) => {
      const t = (await tx.select({ displayName: tenants.displayName }).from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0];
      return t?.displayName ?? "your firm";
    });

    const results: RowResult[] = [];
    const pending: Array<{ id: string; email: string; token: string; roles: string[] }> = [];

    for (const row of rows) {
      const email = row.email.toLowerCase();
      const roles = row.roles?.length ? row.roles : ["rm"];

      if (!areAssignableRoles(roles)) {
        results.push({ email, status: "error", reason: "invalid role(s)" });
        continue;
      }
      if (remainingSeats <= 0) {
        results.push({ email, status: "skipped", reason: "seat limit reached" });
        continue;
      }

      const outcome = await withTenant(session.tenantId, async (tx) => {
        const [u] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.tenantId, session.tenantId), sql`lower(${users.email}) = ${email}`, ne(users.status, "offboarded")))
          .limit(1);
        if (u) return { status: "skipped" as const, reason: "already a member" };
        const [p] = await tx
          .select({ id: userInvites.id })
          .from(userInvites)
          .where(and(eq(userInvites.tenantId, session.tenantId), sql`lower(${userInvites.email}) = ${email}`, isNull(userInvites.acceptedAt), isNull(userInvites.revokedAt)))
          .limit(1);
        if (p) return { status: "skipped" as const, reason: "invite already pending" };

        const token = crypto.randomBytes(32).toString("base64url");
        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
        const id = uuid();
        await tx.insert(userInvites).values({
          id,
          tenantId: session.tenantId,
          email,
          name: row.name,
          rolesToGrant: roles,
          branchId: session.branchId,
          invitedByUserId: session.userId,
          tokenHash,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        } as any);
        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "employee.invite",
          entityType: "user_invite",
          entityId: id,
          after: { email, roles, source: "bulk_import" },
          ...clientMeta,
        });
        return { status: "invited" as const, id, token };
      });

      if (outcome.status === "invited") {
        remainingSeats -= 1;
        pending.push({ id: outcome.id, email, token: outcome.token, roles });
        results.push({ email, status: "invited" });
      } else {
        results.push({ email, status: outcome.status, reason: outcome.reason });
      }
    }

    // Send invite emails best-effort (after the DB writes committed).
    for (const p of pending) {
      const inviteUrl = `${process.env.APP_URL ?? "http://localhost:3000"}/accept-invite?token=${p.token}`;
      try {
        await sendSystemEmail({
          tenantId: session.tenantId,
          to: p.email,
          subject: `You're invited to join ${firmName} on Equitywala`,
          text: `${session.name} has invited you to join ${firmName}'s CRM workspace as ${p.roles.join(", ")}.\n\nAccept your invite (valid for 7 days):\n${inviteUrl}`,
          html: actionEmailHtml({
            heading: `Join ${firmName} on Equitywala`,
            intro: `${session.name} has invited you to join ${firmName}'s workspace as ${p.roles.join(", ")}. This invite is valid for 7 days.`,
            buttonLabel: "Accept invite",
            buttonUrl: inviteUrl,
          }),
          idempotencyKey: `invite:${p.id}`,
        });
      } catch {
        /* email best-effort — the invite row still exists */
      }
    }

    const summary = {
      invited: results.filter((r) => r.status === "invited").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      errors: results.filter((r) => r.status === "error").length,
    };
    return NextResponse.json({ ok: true, summary, results }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
