import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/ai/ask-book
 * Body: { question: string (3..300) }
 *
 * "Ask your book" — the advisor asks a natural-language question about their
 * client book ("clients with SIPs over ₹10,000") and gets a live filtered
 * list. Safety architecture: the AI only ever emits a FilterAST — it is
 * Zod-validated, restricted to catalog fields, and compiled to parameterized
 * SQL by the SAME compiler the segments preview uses. The model can never
 * write SQL.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { nlToFilterAst } from "@/lib/ai/assistant";
import { compileToSelect, bindCompiled } from "@/lib/filter/compiler";

export const dynamic = "force-dynamic";

const Body = z.object({ question: z.string().min(3).max(300) });

const REPHRASE_MSG = "I couldn't turn that into a safe filter — try rephrasing.";

/** Display columns for the result list (investor subject; catalog alias `inv`). */
const DISPLAY_COLUMNS = [
  "inv.id",
  "inv.name",
  "inv.aum",
  "inv.active_sip_amount",
  "inv.status",
  "(inv.address->>'city') AS city",
];

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // Same gating as /api/segments/preview — this runs COUNT(*) + a sample
    // over tenant data, so it must not be an open enumeration endpoint for
    // any logged-in user.
    requireCap(session.roles, "segments.manage", session.permissions);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

    const result = await nlToFilterAst(parse.data.question, "investor", { explain: true });
    if ("error" in result) {
      // Schema failure = the model wandered off the catalog → ask to rephrase.
      if (/schema validation/i.test(result.error)) {
        return NextResponse.json({ error: REPHRASE_MSG }, { status: 422 });
      }
      // Not-configured (and other assistant-layer messages) pass through verbatim.
      const status = /isn't set up yet/i.test(result.error) ? 503 : 502;
      return NextResponse.json({ error: result.error }, { status });
    }

    // Compile up-front (exactly like segments preview) so a hallucinated
    // field / too-deep AST fails here with a friendly 422, never a 500 —
    // the compiler is the safety net.
    let rowsSql: string, rowsParams: unknown[], countSql: string, countParams: unknown[];
    try {
      ({ sql: rowsSql, params: rowsParams } = compileToSelect(result.ast, "investor", {
        limit: 50,
        columns: DISPLAY_COLUMNS,
        tenantId: session.tenantId,
      }));
      ({ sql: countSql, params: countParams } = compileToSelect(result.ast, "investor", {
        count: true,
        tenantId: session.tenantId,
      }));
    } catch {
      return NextResponse.json({ error: REPHRASE_MSG }, { status: 422 });
    }

    const data = await withTenant(session.tenantId, async (tx) => {
      // Bound the cost of an interactive query so it can't pin a DB connection.
      await tx.execute(sql`SET LOCAL statement_timeout = '8000ms'`);
      // bindCompiled re-binds $1, $2, … through Drizzle's tagged template so
      // every value is sent as a real bind parameter.
      const [countResult, rowsResult] = await Promise.all([
        tx.execute(bindCompiled(countSql, countParams) as any),
        tx.execute(bindCompiled(rowsSql, rowsParams) as any),
      ]);
      return {
        count: Number((countResult.rows[0] as any)?.count ?? 0),
        rows: rowsResult.rows,
      };
    });

    return NextResponse.json({ explanation: result.explanation, ast: result.ast, ...data });
  } catch (err: any) {
    return handleApiError(err);
  }
}
