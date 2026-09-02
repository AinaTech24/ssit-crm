import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/segments/preview
 * Body: { subject: 'investor'|'lead'|'task'|'folio', ast: FilterAST }
 *
 * Live count + sample (10 rows) for the filter builder. Compiles the AST to
 * SQL via the same compiler segments use, so what you see is what the
 * materializer will save.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { FilterASTSchema } from "@/lib/filter/ast";
import { compileToSelect, bindCompiled } from "@/lib/filter/compiler";

export const dynamic = "force-dynamic";

/** Subjects that have a top-level catalog (folio is only an investor relation). */
const PREVIEW_SUBJECTS = ["investor", "lead", "task"] as const;
/** Per-subject human label column, aliased to `name` for the sample list. */
const LABEL_COL: Record<string, string> = { investor: "name", lead: "name", task: "title" };

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // Preview runs COUNT(*) + sample over tenant data — gate it like segment
    // creation so it isn't an open enumeration endpoint for any logged-in user.
    requireCap(session.roles, "segments.manage", session.permissions);
    const body = await req.json().catch(() => ({}));

    const subject: string = body.subject ?? "investor";
    if (!(PREVIEW_SUBJECTS as readonly string[]).includes(subject)) {
      return NextResponse.json({ error: `Unsupported subject "${subject}"` }, { status: 400 });
    }

    const astParse = FilterASTSchema.safeParse(body.ast);
    if (!astParse.success) {
      return NextResponse.json({ error: "invalid ast", issues: astParse.error.issues }, { status: 400 });
    }

    // Compile up-front so AST/field/depth errors return 400, not 500.
    let previewSql: string, previewParams: unknown[], countSql: string, countParams: unknown[];
    try {
      const label = LABEL_COL[subject];
      ({ sql: previewSql, params: previewParams } = compileToSelect(astParse.data, subject, {
        limit: 10,
        columns: label ? ["id", `${label} AS name`] : ["id"],
        tenantId: session.tenantId,
      }));
      ({ sql: countSql, params: countParams } = compileToSelect(astParse.data, subject, {
        count: true,
        tenantId: session.tenantId,
      }));
    } catch (e: any) {
      return NextResponse.json({ error: `Invalid filter: ${e?.message ?? e}` }, { status: 400 });
    }

    const result = await withTenant(session.tenantId, async (tx) => {
      // Bound the cost of an interactive preview (regex / deep relation EXISTS /
      // big COUNT) so it can't pin a DB connection.
      await tx.execute(sql`SET LOCAL statement_timeout = '8000ms'`);
      // bindCompiled re-binds $1, $2, … through Drizzle's tagged template so
      // every value is sent as a real bind parameter.
      const [countResult, sampleResult] = await Promise.all([
        tx.execute(bindCompiled(countSql, countParams) as any),
        tx.execute(bindCompiled(previewSql, previewParams) as any),
      ]);

      return {
        count: Number((countResult.rows[0] as any)?.count ?? 0),
        sample: sampleResult.rows,
      };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
