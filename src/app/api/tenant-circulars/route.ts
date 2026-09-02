import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/tenant-circulars
 *   Save a circular / compliance note to the tenant's own library (typically an
 *   AI-summarised draft from the circular summariser). Tenant-scoped.
 *
 * DELETE /api/tenant-circulars?id=...
 *   Remove a saved entry.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { tenantCirculars } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

// Only http(s) URLs — an unconstrained string here is rendered as an <a href>
// in the circular feed, so a `javascript:`/`data:` value would be stored XSS.
const httpUrl = z
  .string()
  .max(500)
  .refine((s) => /^https?:\/\//i.test(s), { message: "sourceUrl must be an http(s) URL" });

const Body = z.object({
  title: z.string().min(1).max(200),
  issuer: z.string().max(40).nullable().optional(),
  category: z.string().max(60).nullable().optional(),
  summary: z.string().min(1).max(5000),
  mfdAction: z.string().max(5000).nullable().optional(),
  severity: z.enum(["info", "action_required", "critical"]).default("info"),
  sourceUrl: httpUrl.nullable().optional().or(z.literal("")),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const meta = clientMetaFromHeaders(req.headers);
    const created = await withTenant(session.tenantId, async (tx) => {
      const [row] = await tx
        .insert(tenantCirculars)
        .values({
          tenantId: session.tenantId,
          title: parse.data.title,
          issuer: parse.data.issuer ?? null,
          category: parse.data.category ?? null,
          summary: parse.data.summary,
          mfdAction: parse.data.mfdAction ?? null,
          severity: parse.data.severity,
          sourceUrl: parse.data.sourceUrl || null,
          createdBy: session.userId,
        } as any)
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "tenant_circular.create",
        entityType: "tenant_circular",
        entityId: row.id,
        after: { title: row.title } as any,
        ...meta,
      });
      return row;
    });
    return NextResponse.json({ ok: true, circular: created });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await withTenant(session.tenantId, async (tx) => {
      await tx
        .delete(tenantCirculars)
        .where(and(eq(tenantCirculars.id, id), eq(tenantCirculars.tenantId, session.tenantId)));
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
