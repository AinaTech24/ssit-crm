import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET  /api/branches  — list the tenant's branch offices (HQ first)
 * POST /api/branches  — create one
 *
 * Gated by `settings.users` (same cap the firm-profile page uses). Branch
 * offices are firm-structure data — owner / admin territory.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { branches } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const AddressBody = z
  .object({
    line1: z.string().max(200).optional(),
    city: z.string().max(120).optional(),
    state: z.string().max(120).optional(),
    pincode: z.string().max(20).optional(),
  })
  // The form sends `address: null` when no address is entered, so accept null
  // (and undefined) — not just undefined.
  .nullable()
  .optional();

const PostBody = z.object({
  name: z.string().min(1).max(160),
  code: z.string().min(1).max(40),
  address: AddressBody,
  phone: z.string().max(40).nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal("")),
  headUserId: z.string().uuid().nullable().optional(),
  isHq: z.boolean().default(false),
});

export async function GET() {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);

    const rows = await withTenant(session.tenantId, async (tx) => {
      return tx
        .select()
        .from(branches)
        .where(eq(branches.tenantId, session.tenantId))
        // HQ first ("true" > "false" descending), then alphabetical.
        .orderBy(sql`(${branches.isHq} = 'true') desc`, asc(branches.name));
    });

    return NextResponse.json({ branches: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = PostBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const meta = clientMetaFromHeaders(req.headers);
    const data = parse.data;

    try {
      const row = await withTenant(session.tenantId, async (tx) => {
        const [r] = await tx
          .insert(branches)
          .values({
            tenantId: session.tenantId,
            name: data.name,
            code: data.code,
            address: data.address ?? null,
            phone: data.phone || null,
            email: data.email || null,
            headUserId: data.headUserId || null,
            isHq: data.isHq ? "true" : "false",
          } as any)
          .returning();

        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "branch.create",
          entityType: "branch",
          entityId: r.id,
          before: null,
          after: r,
          ...meta,
        });
        return r;
      });
      return NextResponse.json({ branch: row });
    } catch (err: any) {
      const code = err?.code ?? err?.cause?.code;
      const msg = String(err?.message ?? "");
      if (code === "23505" || msg.includes("branches_tenant_code_unique")) {
        return NextResponse.json(
          { error: "A branch with that code already exists." },
          { status: 409 }
        );
      }
      throw err;
    }
  } catch (err: any) {
    return handleApiError(err);
  }
}
