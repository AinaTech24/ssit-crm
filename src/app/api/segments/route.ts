import { handleApiError } from "@/lib/api/error-handler";
/**
 * Segments collection.
 *
 *   GET  /api/segments    — list segments in tenant
 *   POST /api/segments    — create new segment (static or dynamic)
 *
 * Dynamic segments are materialized on the schedule via the segment_materializer
 * worker. Static segments are populated once on save.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { segments, segmentMemberships } from "@/db/schema";
import { FilterASTSchema } from "@/lib/filter/ast";
import { compileToSelect, bindCompiled } from "@/lib/filter/compiler";
import { require as requireCap } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
  kind: z.enum(["static", "dynamic"]),
  subjectType: z.enum(["investor", "lead", "task"]),
  ast: FilterASTSchema,
  refreshCron: z.string().optional(),
});

/** Postgres caps a statement at 65,535 bind params; memberships bind 3/row, so
 *  insert in batches well under that ceiling. */
const MEMBERSHIP_CHUNK = 1000;
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function GET() {
  try {
    const session = await requireSession();
    const rows = await withTenant(session.tenantId, async (tx) => {
      return tx
        .select()
        .from(segments)
        // Hide throwaway campaign audiences (created by the broadcast audience
        // builder) — they'd otherwise clutter the saved-segment list.
        .where(
          and(
            eq(segments.tenantId, session.tenantId),
            sql`${segments.description} IS DISTINCT FROM 'Ad-hoc campaign audience'`
          )
        )
        .orderBy(desc(segments.updatedAt));
    });
    return NextResponse.json({ segments: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "segments.manage", session.permissions);
    const parse = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;

    // Pre-compile to validate the AST against the catalog before saving.
    try {
      compileToSelect(body.ast, body.subjectType, { limit: 1 });
    } catch (err: any) {
      return NextResponse.json({ error: `AST does not compile: ${err.message}` }, { status: 400 });
    }

    const segId = uuid();
    await withTenant(session.tenantId, async (tx) => {
      await tx.insert(segments).values({
        id: segId,
        tenantId: session.tenantId,
        name: body.name,
        description: body.description,
        kind: body.kind,
        subjectType: body.subjectType,
        ast: body.ast,
        refreshCron: body.kind === "dynamic" ? (body.refreshCron ?? "0 * * * *") : null,
      } as any);

      // Static: materialize once immediately. Dynamic: leave to worker.
      if (body.kind === "static") {
        // Bound the snapshot + cap query cost so a huge base can't pin the
        // request transaction.
        await tx.execute(sql`SET LOCAL statement_timeout = '30000ms'`);
        const { sql: querySql, params } = compileToSelect(body.ast, body.subjectType, {
          tenantId: session.tenantId,
          limit: 100_000,
        });
        const matches = await tx.execute(bindCompiled(querySql, params) as any);
        const rows = matches.rows as Array<{ id: string }>;
        // Chunked multi-row insert — a single insert of >~21K rows would blow
        // past Postgres' 65,535 bind-param ceiling (3 params/row).
        for (const batch of chunk(rows, MEMBERSHIP_CHUNK)) {
          await tx.insert(segmentMemberships).values(
            batch.map((r) => ({
              segmentId: segId,
              tenantId: session.tenantId,
              subjectId: r.id,
            })) as any
          );
        }
        await tx
          .update(segments)
          .set({ memberCount: rows.length, lastMaterializedAt: new Date() } as any)
          .where(and(eq(segments.id, segId), eq(segments.tenantId, session.tenantId)));
      }
    });

    return NextResponse.json({ id: segId }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
