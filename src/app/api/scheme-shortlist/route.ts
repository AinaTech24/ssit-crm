import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST   /api/scheme-shortlist  — toggle is_shortlisted on one scheme
 *                                  + capture rationale + coarse category
 * PATCH  /api/scheme-shortlist  — bulk update many schemes at once
 *
 * The IC works in batches: at a quarterly review they typically
 * promote/demote 10-20 schemes in one go. Bulk PATCH avoids the chatty
 * one-call-per-row pattern.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { schemeMaster } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const COARSE = [
  "equity",
  "hybrid",
  "debt",
  "liquid",
  "commodity",
  "international",
  "other",
] as const;

const SingleBody = z.object({
  schemeId: z.string().uuid(),
  isShortlisted: z.boolean(),
  coarseCategory: z.enum(COARSE).nullable().optional(),
  shortlistRationale: z.string().max(2000).nullable().optional(),
});

const BulkBody = z.object({
  schemeIds: z.array(z.string().uuid()).min(1).max(200),
  isShortlisted: z.boolean(),
  coarseCategory: z.enum(COARSE).nullable().optional(),
  shortlistRationale: z.string().max(2000).nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = SingleBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const meta = clientMetaFromHeaders(req.headers);
    const d = parse.data;

    const row = await withTenant(session.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(schemeMaster)
        .where(
          and(
            eq(schemeMaster.id, d.schemeId),
            eq(schemeMaster.tenantId, session.tenantId)
          )
        )
        .limit(1);
      if (!existing) return null;

      const patch: any = {
        isShortlisted: d.isShortlisted,
        shortlistedAt: d.isShortlisted ? new Date() : null,
        shortlistedBy: d.isShortlisted ? session.userId : null,
        updatedAt: new Date(),
      };
      if (d.coarseCategory !== undefined) patch.coarseCategory = d.coarseCategory;
      if (d.shortlistRationale !== undefined) {
        patch.shortlistRationale = d.shortlistRationale;
      }

      const [next] = await tx
        .update(schemeMaster)
        .set(patch)
        .where(eq(schemeMaster.id, d.schemeId))
        .returning();

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: d.isShortlisted
          ? "scheme.shortlist_add"
          : "scheme.shortlist_remove",
        entityType: "scheme",
        entityId: d.schemeId,
        before: existing,
        after: next,
        ...meta,
      });
      return next;
    });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ scheme: row });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = BulkBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const meta = clientMetaFromHeaders(req.headers);
    const d = parse.data;
    const updated = await withTenant(session.tenantId, async (tx) => {
      const patch: any = {
        isShortlisted: d.isShortlisted,
        shortlistedAt: d.isShortlisted ? new Date() : null,
        shortlistedBy: d.isShortlisted ? session.userId : null,
        updatedAt: new Date(),
      };
      if (d.coarseCategory !== undefined) patch.coarseCategory = d.coarseCategory;
      if (d.shortlistRationale !== undefined) {
        patch.shortlistRationale = d.shortlistRationale;
      }
      const rows = await tx
        .update(schemeMaster)
        .set(patch)
        .where(
          and(
            eq(schemeMaster.tenantId, session.tenantId),
            inArray(schemeMaster.id, d.schemeIds)
          )
        )
        .returning();

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "scheme.shortlist_bulk_update",
        entityType: "scheme",
        entityId: null as any,
        before: null,
        after: { count: rows.length, isShortlisted: d.isShortlisted } as any,
        ...meta,
      });
      return rows;
    });
    return NextResponse.json({ updated: updated.length });
  } catch (err: any) {
    return handleApiError(err);
  }
}
