import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET  /api/tech-stack   — list the firm's tools
 * POST /api/tech-stack   — add a tool
 *
 * Gated by reports.commission (owner / back-office / compliance — firm setup
 * data). Tenant-scoped via withTenant + RLS.
 */

import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { techStackTools, TECH_CATEGORIES, TECH_STATUSES } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const PostBody = z.object({
  category: z.enum(TECH_CATEGORIES),
  toolName: z.string().min(1).max(200),
  purpose: z.string().max(500).optional(),
  vendorUrl: z.string().max(500).optional(),
  accessNote: z.string().max(500).optional(),
  status: z.enum(TECH_STATUSES).default("active"),
  annualCost: z.number().min(0).max(100_000_000).optional(),
  renewalDate: z.string().optional(),
  notes: z.string().max(1000).optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    requireCap(session.roles, "reports.commission", session.permissions);
    const rows = await withTenant(session.tenantId, async (tx) => {
      return tx
        .select()
        .from(techStackTools)
        .where(eq(techStackTools.tenantId, session.tenantId))
        .orderBy(asc(techStackTools.category), asc(techStackTools.toolName));
    });
    return NextResponse.json({ tools: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "reports.commission", session.permissions);
    const parsed = PostBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const d = parsed.data;
    const meta = clientMetaFromHeaders(req.headers);

    const row = await withTenant(session.tenantId, async (tx) => {
      const [created] = await tx
        .insert(techStackTools)
        .values({
          tenantId: session.tenantId,
          category: d.category,
          toolName: d.toolName,
          purpose: d.purpose ?? null,
          vendorUrl: d.vendorUrl ?? null,
          accessNote: d.accessNote ?? null,
          status: d.status,
          annualCost: d.annualCost != null ? String(d.annualCost) : null,
          renewalDate: d.renewalDate ? d.renewalDate.slice(0, 10) : null,
          notes: d.notes ?? null,
          createdBy: session.userId,
        } as any)
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "tech_stack.create",
        entityType: "tech_stack_tool",
        entityId: created.id,
        after: created as any,
        ...meta,
      });
      return created;
    });

    return NextResponse.json({ tool: row });
  } catch (err: any) {
    return handleApiError(err);
  }
}
