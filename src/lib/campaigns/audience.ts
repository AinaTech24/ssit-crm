/**
 * Ad-hoc campaign audiences — Zoho-style "select recipients" without needing a
 * saved Segment.
 *
 * A broadcast campaign still needs a `segmentId` (the dispatcher walks
 * `segment_memberships`). This helper builds a throwaway segment on demand from
 * one of three modes and materializes its members, so a user can target:
 *
 *   - "all"    → every client (investor) or lead in the tenant
 *   - "manual" → a hand-picked list of client/lead ids
 *   - "filter" → a Filter AST (reuses the dynamic-segment materializer)
 *
 * The segment is created with materializerEnabled=false so it is NOT re-refreshed
 * on the hourly cron — a campaign audience is a point-in-time snapshot. The
 * dispatcher + compliance gate handle recipients with no contact / no consent
 * (they're recorded as skipped, fully audited).
 */

import { v4 as uuid } from "uuid";
import { and, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { segments, investors, leads } from "@/db/schema";
import { materializeSegment } from "@/workers/segment-materializer";

export type AdhocAudienceInput = {
  tenantId: string;
  subjectType: "investor" | "lead";
  mode: "all" | "manual" | "filter";
  /** For mode='manual' — the chosen subject ids. */
  subjectIds?: string[];
  /** For mode='filter' — a Filter AST (see lib/filter/ast.ts). */
  ast?: unknown;
  /** Optional human label; a short unique suffix is always appended. */
  name?: string;
};

const MEMBERSHIP_CHUNK = 5000;

export async function createAdhocAudience(
  input: AdhocAudienceInput
): Promise<{ segmentId: string; memberCount: number }> {
  const { tenantId, subjectType, mode } = input;
  const segId = uuid();
  const name = `${(input.name?.trim() || "Campaign audience")} · ${segId.slice(0, 8)}`;

  // ── filter mode → a (one-shot) dynamic segment, reuse the materializer ──────
  if (mode === "filter") {
    if (!input.ast) throw new Error("filter mode requires an ast");
    await withTenant(tenantId, async (tx) => {
      await tx.insert(segments).values({
        id: segId,
        tenantId,
        name,
        description: "Ad-hoc campaign audience",
        kind: "dynamic",
        subjectType,
        ast: input.ast as any,
        materializerEnabled: false,
      } as any);
    });
    const m = await materializeSegment(tenantId, segId);
    return { segmentId: segId, memberCount: m.total };
  }

  // ── all / manual → a static segment with members written directly ───────────
  return withTenant(tenantId, async (tx) => {
    await tx.insert(segments).values({
      id: segId,
      tenantId,
      name,
      description: "Ad-hoc campaign audience",
      kind: "static",
      subjectType,
      ast: null,
      materializerEnabled: false,
    } as any);

    let ids: string[] = [];
    if (mode === "all") {
      const tbl = subjectType === "investor" ? investors : leads;
      const rows = await tx.select({ id: tbl.id }).from(tbl).where(eq(tbl.tenantId, tenantId));
      ids = rows.map((r) => r.id as string);
    } else {
      ids = Array.from(new Set((input.subjectIds ?? []).filter(Boolean)));
    }

    for (let i = 0; i < ids.length; i += MEMBERSHIP_CHUNK) {
      const batch = ids.slice(i, i + MEMBERSHIP_CHUNK);
      if (!batch.length) continue;
      const valuesSql = sql.join(
        batch.map((id) => sql`(${segId}::uuid, ${tenantId}::uuid, ${id}::uuid, now(), NULL)`),
        sql`, `
      );
      await tx.execute(
        sql`INSERT INTO segment_memberships (segment_id, tenant_id, subject_id, added_at, removed_at)
            VALUES ${valuesSql}
            ON CONFLICT (segment_id, subject_id) DO NOTHING`
      );
    }

    await tx
      .update(segments)
      .set({ memberCount: ids.length } as any)
      .where(and(eq(segments.id, segId), eq(segments.tenantId, tenantId)));

    return { segmentId: segId, memberCount: ids.length };
  });
}
