import { handleApiError } from "@/lib/api/error-handler";
/**
 * Announcements — internal team notice board (Sanchay parity).
 *
 *   GET  /api/announcements           — active notices for the viewer
 *   GET  /api/announcements?manage=1  — all notices (managers; for admin list)
 *   POST /api/announcements           — post a notice (owner / branch_head)
 *
 * "Active" = published, not expired, audience role matches, branch matches.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { ANNOUNCEMENT_CATEGORIES, announcements } from "@/db/schema";
import { audienceRolesSchema, checkBranchTarget, checkDeskTarget } from "@/lib/announcements/validate";
import { notifyAnnouncementPublished } from "@/lib/announcements/notify";

export const dynamic = "force-dynamic";

const isManager = (roles: string[]) => roles.some((r) => ["owner", "branch_head"].includes(r));

const Body = z.object({
  title: z.string().min(2).max(200),
  body: z.string().min(1).max(8000),
  category: z.enum(ANNOUNCEMENT_CATEGORIES).default("general"),
  audienceRoles: audienceRolesSchema.default([]),
  branchId: z.string().uuid().nullable().optional(),
  /** Sub-branch target. Most firms run one branch, so this is the useful one. */
  deskId: z.string().uuid().nullable().optional(),
  isPinned: z.boolean().default(false),
  requiresAck: z.boolean().default(false),
  publishNow: z.boolean().default(true),
  expiresAt: z.string().datetime().nullable().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const manage = req.nextUrl.searchParams.get("manage") === "1" && isManager(session.roles);

    const rows = await withTenant(session.tenantId, async (tx) => {
      if (manage) {
        // Read/ack rollup per announcement for the manager view ("X of Y").
        const r = await tx.execute(sql`
          SELECT a.*, u.name AS created_by_name,
                 (SELECT count(*)::int FROM announcement_reads ar WHERE ar.announcement_id = a.id) AS read_count,
                 (SELECT count(*)::int FROM announcement_reads ar WHERE ar.announcement_id = a.id AND ar.acknowledged_at IS NOT NULL) AS ack_count,
                 (SELECT count(*)::int FROM announcement_attachments aa WHERE aa.announcement_id = a.id AND aa.deleted_at IS NULL) AS attachment_count
          FROM announcements a LEFT JOIN users u ON u.id = a.created_by_user_id
          WHERE a.tenant_id = ${session.tenantId}::uuid
          ORDER BY a.is_pinned DESC, COALESCE(a.published_at, a.created_at) DESC
          LIMIT 200
        `);
        return r.rows;
      }
      const rolesJson = JSON.stringify(session.roles);
      const r = await tx.execute(sql`
        SELECT a.id, a.title, a.body, a.category, a.is_pinned, a.requires_ack, a.published_at, a.expires_at,
               u.name AS created_by_name,
               (ar.read_at IS NOT NULL) AS is_read,
               (ar.acknowledged_at IS NOT NULL) AS is_acknowledged,
               (SELECT count(*)::int FROM announcement_attachments aa WHERE aa.announcement_id = a.id AND aa.deleted_at IS NULL) AS attachment_count
        FROM announcements a
        LEFT JOIN users u ON u.id = a.created_by_user_id
        LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.user_id = ${session.userId}::uuid
        WHERE a.tenant_id = ${session.tenantId}::uuid
          AND a.published_at IS NOT NULL AND a.published_at <= now()
          AND (a.expires_at IS NULL OR a.expires_at > now())
          AND (a.branch_id IS NULL OR a.branch_id = ${session.branchId ?? null})
          -- Desk scope. Read from the USER ROW rather than the session token,
          -- like every other desk check, so moving someone to another
          -- sub-branch changes what they see on the next request instead of
          -- the next login.
          AND (
            a.desk_id IS NULL
            OR a.desk_id = (SELECT desk_id FROM users WHERE id = ${session.userId}::uuid)
          )
          AND (
            a.audience_roles IS NULL
            OR jsonb_array_length(a.audience_roles) = 0
            OR a.audience_roles ?| array(SELECT jsonb_array_elements_text(${rolesJson}::jsonb))
          )
        ORDER BY a.is_pinned DESC, a.published_at DESC
        LIMIT 100
      `);
      return r.rows;
    });
    return NextResponse.json({ announcements: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!isManager(session.roles)) return NextResponse.json({ error: "only owners / branch heads can post announcements" }, { status: 403 });
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const b = parse.data;
    const meta = clientMetaFromHeaders(req.headers);
    const id = uuid();

    const out = await withTenant(session.tenantId, async (tx) => {
      const branchErr = await checkBranchTarget(tx, {
        branchId: b.branchId,
        tenantId: session.tenantId,
        roles: session.roles,
        ownBranchId: session.branchId ?? null,
      });
      if (branchErr) return { error: branchErr };
      const deskErr = await checkDeskTarget(tx, {
        deskId: b.deskId,
        tenantId: session.tenantId,
        roles: session.roles,
        ownBranchId: session.branchId ?? null,
      });
      if (deskErr) return { error: deskErr };

      await tx.insert(announcements).values({
        id,
        tenantId: session.tenantId,
        title: b.title,
        body: b.body,
        category: b.category,
        audienceRoles: b.audienceRoles,
        branchId: b.branchId ?? null,
        deskId: b.deskId ?? null,
        isPinned: b.isPinned,
        requiresAck: b.requiresAck,
        publishedAt: b.publishNow ? new Date() : null,
        expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
        createdByUserId: session.userId,
      } as any);
      // Notify targeted staff the moment it goes live (drafts notify on publish).
      if (b.publishNow) {
        await notifyAnnouncementPublished(tx as any, session.tenantId, {
          id, title: b.title, category: b.category, audienceRoles: b.audienceRoles, branchId: b.branchId ?? null, createdByUserId: session.userId,
        });
      }
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "announcement.create",
        entityType: "announcement",
        entityId: id,
        after: { title: b.title, category: b.category } as any,
        ...meta,
      });
      return { error: null as string | null };
    });
    if (out?.error) return NextResponse.json({ error: out.error }, { status: 400 });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
