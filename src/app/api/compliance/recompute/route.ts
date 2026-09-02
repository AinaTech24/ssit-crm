import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { ddqScores } from "@/db/schema";
import { saveDdqScore } from "@/lib/compliance/ddq-calculator";

export const dynamic = "force-dynamic";

// Don't recompute (and insert a new row) more often than this — the DDQ score
// moves slowly and the underlying scan is non-trivial. Repeated clicks within
// the window return the most recent score instead of flooding ddq_scores.
const DEDUP_WINDOW_MIN = 5;

export async function POST(_req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);

    const result = await withTenant(session.tenantId, async (tx) => {
      // Dedup: if a score was computed very recently, return it as-is.
      const [recent] = await tx
        .select()
        .from(ddqScores)
        .where(
          and(
            eq(ddqScores.tenantId, session.tenantId),
            gt(ddqScores.computedAt, sql`now() - (${DEDUP_WINDOW_MIN} || ' minutes')::interval`)
          )
        )
        .orderBy(desc(ddqScores.computedAt))
        .limit(1);

      if (recent) {
        return {
          overallScore: Number(recent.overallScore),
          breakdown: recent.breakdown,
          deduped: true,
          computedAt: recent.computedAt,
        };
      }

      const saved = await saveDdqScore(tx, session.tenantId);
      return { ...saved, deduped: false };
    });

    return NextResponse.json({ success: true, data: result });
  } catch (err: any) {
    return handleApiError(err);
  }
}
