import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/employees/invite
 * Body: { email, name, roles[], branchId? }
 *
 * Owner / branch_head invites a new team member. Generates a signed token,
 * stores its hash, and (TODO) emails the invite link. Returns the link in
 * the response so the owner can also share it manually.
 *
 *   GET /api/employees/invite       — list pending invites for this tenant
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import crypto from "node:crypto";
import { desc, eq, isNull, and, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { userInvites, tenants, users, branches } from "@/db/schema";
import { require as requireCap, areAssignableRoles } from "@/lib/auth/rbac";
import { assertActiveLicense, loadTenantLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { sendSystemEmail, actionEmailHtml } from "@/lib/comms/system-email";
import { requestBaseUrl } from "@/lib/url/request-base";

export const dynamic = "force-dynamic";

const Body = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
  roles: z.array(z.string()).min(1),
  branchId: z.string().uuid().optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    // Pending invites expose invitee emails + roles-to-grant — admin-only.
    requireCap(session.roles, "settings.users", session.permissions);
    const rows = await withTenant(session.tenantId, async (tx) => {
      return tx
        .select()
        .from(userInvites)
        .where(and(eq(userInvites.tenantId, session.tenantId), isNull(userInvites.acceptedAt), isNull(userInvites.revokedAt)))
        .orderBy(desc(userInvites.createdAt));
    });
    return NextResponse.json({ invites: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    // Note: inviting does NOT require the inviter's own email to be verified.
    // The invite generates a shareable link (returned below) the admin can copy
    // and send directly, so onboarding a team isn't blocked on email delivery /
    // self-verification. Spam is still bounded by the admin capability.

    // Seat limits came from the package catalogue, which no longer exists —
    // team size is unbounded. Invite volume is still bounded by the
    // settings.users capability required above.

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;
    // Only tenant-assignable roles may be granted — never a platform role.
    if (!areAssignableRoles(body.roles)) {
      return NextResponse.json({ error: "one or more roles are not assignable" }, { status: 400 });
    }

    const targetEmail = body.email.toLowerCase();
    // Validate the branch + dedup the invite up-front (one tenant-scoped read).
    const conflict = await withTenant(session.tenantId, async (tx) => {
      // The branch must belong to THIS tenant — otherwise a foreign/dangling
      // branch_id would ride onto the new user when they accept.
      if (body.branchId) {
        const [b] = await tx
          .select({ id: branches.id })
          .from(branches)
          .where(and(eq(branches.id, body.branchId), eq(branches.tenantId, session.tenantId)))
          .limit(1);
        if (!b) return { error: "That branch doesn't belong to your firm.", status: 400 as const };
      }
      // Don't invite an address that's already an active member…
      const [u] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.tenantId, session.tenantId), sql`lower(${users.email}) = ${targetEmail}`, ne(users.status, "offboarded")))
        .limit(1);
      if (u) return { error: "A team member with this email already exists.", status: 409 as const };
      // …or one that already has a live (un-accepted, un-revoked) invite.
      const [pending] = await tx
        .select({ id: userInvites.id })
        .from(userInvites)
        .where(and(eq(userInvites.tenantId, session.tenantId), sql`lower(${userInvites.email}) = ${targetEmail}`, isNull(userInvites.acceptedAt), isNull(userInvites.revokedAt)))
        .limit(1);
      if (pending) return { error: "An invite for this email is already pending.", status: 409 as const };
      return null;
    });
    if (conflict) return NextResponse.json({ error: conflict.error }, { status: conflict.status });

    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const id = uuid();
    const clientMeta = clientMetaFromHeaders(req.headers);
    const firmName = await withTenant(session.tenantId, async (tx) => {
      await tx.insert(userInvites).values({
        id,
        tenantId: session.tenantId,
        email: body.email.toLowerCase(),
        name: body.name,
        rolesToGrant: body.roles,
        branchId: body.branchId ?? session.branchId,
        invitedByUserId: session.userId,
        tokenHash,
        expiresAt,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "employee.invite",
        entityType: "user_invite",
        entityId: id,
        after: { email: body.email, roles: body.roles, branchId: body.branchId ?? session.branchId },
        ...clientMeta,
      });

      const t = (await tx.select({ displayName: tenants.displayName }).from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0];
      return t?.displayName ?? "your firm";
    });

    const inviteUrl = `${await requestBaseUrl()}/accept-invite?token=${token}`;

    // Email the invite (best-effort — the link is still returned so the owner
    // can share it manually if email isn't configured).
    const emailRes = await sendSystemEmail({
      tenantId: session.tenantId,
      to: body.email,
      subject: `You're invited to join ${firmName} on Equitywala`,
      text:
        `${session.name} has invited you to join ${firmName}'s CRM workspace as ${body.roles.join(", ")}.\n\n` +
        `Accept your invite (valid for 7 days):\n${inviteUrl}`,
      html: actionEmailHtml({
        heading: `Join ${firmName} on Equitywala`,
        intro: `${session.name} has invited you to join ${firmName}'s workspace as ${body.roles.join(", ")}. This invite is valid for 7 days.`,
        buttonLabel: "Accept invite",
        buttonUrl: inviteUrl,
      }),
      idempotencyKey: `invite:${id}`,
    });

    return NextResponse.json({ id, inviteUrl, expiresAt, emailSent: emailRes.sent }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
