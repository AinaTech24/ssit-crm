import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/sops/[id]/version — publish a NEW version of an SOP.
 *   Body: { body: string, versionNumber?: string }
 *
 * Creates a fresh sop_versions row with the new content, repoints
 * sops.current_version_id at it, and bumps the major version number. Because
 * acknowledgements are keyed per-version, publishing a new version cleanly
 * resets sign-off: staff must re-acknowledge the updated procedure, while the
 * prior version + its acknowledgements stay intact as history. Gated by
 * sop.manage + active licence.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { sops, sopVersions } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  body: z.string().min(2),
  // Optional explicit label; otherwise we bump the major (e.g. 1.0 → 2.0).
  versionNumber: z.string().min(1).max(20).optional(),
});

/** Next major version label from the existing "N.M" strings. */
function nextVersionNumber(existing: string[]): string {
  let maxMajor = 0;
  for (const v of existing) {
    const major = parseInt(String(v).split(".")[0] ?? "", 10);
    if (Number.isFinite(major) && major > maxMajor) maxMajor = major;
  }
  return `${maxMajor + 1}.0`;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "sop.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const meta = clientMetaFromHeaders(req.headers);
    const versionId = uuid();

    const result = await withTenant(session.tenantId, async (tx) => {
      // Tenant-scoped + not soft-deleted — can't re-version a foreign or trashed SOP.
      const [sop] = await tx
        .select({ id: sops.id })
        .from(sops)
        .where(and(eq(sops.id, id), eq(sops.tenantId, session.tenantId), isNull(sops.deletedAt)))
        .limit(1);
      if (!sop) return null;

      const existing = await tx
        .select({ versionNumber: sopVersions.versionNumber })
        .from(sopVersions)
        .where(and(eq(sopVersions.sopId, id), eq(sopVersions.tenantId, session.tenantId)))
        .orderBy(desc(sopVersions.createdAt));
      const versionNumber = parse.data.versionNumber ?? nextVersionNumber(existing.map((v) => v.versionNumber));

      await tx.insert(sopVersions).values({
        id: versionId,
        sopId: id,
        tenantId: session.tenantId,
        versionNumber,
        body: { markdown: parse.data.body } as any,
        publishedAt: new Date(),
        publishedByUserId: session.userId,
      } as any);

      await tx
        .update(sops)
        .set({ currentVersionId: versionId, updatedAt: new Date() } as any)
        .where(and(eq(sops.id, id), eq(sops.tenantId, session.tenantId)));

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "sop.publish_version",
        entityType: "sop",
        entityId: id,
        after: { versionId, versionNumber } as any,
        ...meta,
      });
      return { versionId, versionNumber };
    });

    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
