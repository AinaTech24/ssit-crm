import { handleApiError } from "@/lib/api/error-handler";
/**
 * Scheme master — collection.
 *
 *   GET  /api/schemes   — list (RLS-scoped)
 *   POST /api/schemes   — manually add a scheme (for schemes not in the AMFI /
 *                          RTA feed, or bespoke entries). IC / compliance only.
 *
 * Most schemes are seeded from feeds; this is the manual escape hatch + the
 * create path for the Scheme Master catalog.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { desc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { schemeMaster } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  amcCode: z.string().min(1).max(40),
  schemeCode: z.string().min(1).max(60),
  schemeName: z.string().min(2).max(300),
  category: z.string().max(120).optional(),
  subCategory: z.string().max(120).optional(),
  coarseCategory: z.enum(["equity", "hybrid", "debt", "liquid", "commodity", "international", "other"]).optional(),
  plan: z.enum(["regular", "direct"]).optional(),
  option: z.enum(["growth", "idcw_payout", "idcw_reinvest"]).optional(),
  minInvestment: z.string().max(40).optional(),
  minSip: z.string().max(40).optional(),
  exitLoad: z.string().max(200).optional(),
  riskCategory: z.string().max(40).optional(),
  isActive: z.boolean().default(true),
  isClosed: z.boolean().default(false),
});

export async function GET() {
  try {
    const session = await requireSession();
    const rows = await withTenant(session.tenantId, async (tx) =>
      (await tx.select().from(schemeMaster).orderBy(desc(schemeMaster.updatedAt)).limit(500))
    );
    return NextResponse.json({ schemes: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const b = parse.data;
    const meta = clientMetaFromHeaders(req.headers);
    const id = uuid();
    try {
      await withTenant(session.tenantId, async (tx) => {
        await tx.insert(schemeMaster).values({
          id,
          tenantId: session.tenantId,
          amcCode: b.amcCode,
          schemeCode: b.schemeCode,
          schemeName: b.schemeName,
          category: b.category ?? null,
          subCategory: b.subCategory ?? null,
          coarseCategory: b.coarseCategory ?? null,
          plan: b.plan ?? null,
          option: b.option ?? null,
          minInvestment: b.minInvestment ?? null,
          minSip: b.minSip ?? null,
          exitLoad: b.exitLoad ?? null,
          riskCategory: b.riskCategory ?? null,
          isActive: b.isActive,
          isClosed: b.isClosed,
        } as any);
        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "scheme.create",
          entityType: "scheme",
          entityId: id,
          after: { amcCode: b.amcCode, schemeCode: b.schemeCode, schemeName: b.schemeName } as any,
          ...meta,
        });
      });
    } catch (e: any) {
      if (String(e?.message).includes("scheme_master_unique")) {
        return NextResponse.json({ error: "a scheme with this AMC + code already exists" }, { status: 409 });
      }
      throw e;
    }
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
