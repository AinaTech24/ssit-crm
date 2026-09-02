import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, ASSIGNABLE_ROLES } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { sops, sopVersions } from "@/db/schema";

export const dynamic = "force-dynamic";

const ASSIGNABLE = new Set<string>(ASSIGNABLE_ROLES);

const Body = z.object({
  key: z.string().min(2).max(80).regex(/^[a-z0-9_]+$/),
  title: z.string().min(2).max(300),
  category: z.string().optional(),
  // Each required role must be a real tenant role (empty = applies to everyone).
  requiredRoles: z.array(z.string()).default([]).refine((rs) => rs.every((r) => ASSIGNABLE.has(r)), {
    message: "requiredRoles must be assignable tenant roles",
  }),
  body: z.string().min(2),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "sop.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const meta = clientMetaFromHeaders(req.headers);
    const sopId = uuid();
    const versionId = uuid();
    await withTenant(session.tenantId, async (tx) => {
      await tx.insert(sops).values({
        id: sopId,
        tenantId: session.tenantId,
        key: parse.data.key,
        title: parse.data.title,
        category: parse.data.category,
        currentVersionId: versionId,
        requiredRoles: parse.data.requiredRoles,
      } as any);
      await tx.insert(sopVersions).values({
        id: versionId,
        sopId,
        tenantId: session.tenantId,
        versionNumber: "1.0",
        body: { markdown: parse.data.body } as any,
        publishedAt: new Date(),
        publishedByUserId: session.userId,
      } as any);
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "sop.create",
        entityType: "sop",
        entityId: sopId,
        after: { key: parse.data.key, title: parse.data.title, requiredRoles: parse.data.requiredRoles } as any,
        ...meta,
      });
    });
    return NextResponse.json({ id: sopId }, { status: 201 });
  } catch (err: any) {
    if (String(err?.message ?? "").includes("sops_tenant_key_unique")) {
      return NextResponse.json({ error: "key already exists" }, { status: 409 });
    }
    return handleApiError(err);
  }
}
