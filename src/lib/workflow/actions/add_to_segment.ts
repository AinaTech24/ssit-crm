import { sql } from "drizzle-orm";
import { segmentMemberships } from "@/db/schema";
import type { ActionHandler } from "./index";

/**
 * Add or remove the subject from a STATIC segment. Dynamic segments are
 * managed by the segment materializer and cannot be mutated by workflows.
 */
export const addToSegmentHandler: ActionHandler<any> = {
  type: "add_to_segment",
  async execute(ctx, node, tx) {
    const cfg = node.config;
    if (!ctx.subjectId) throw new Error("add_to_segment: no subject");

    if (cfg.add) {
      // Upsert membership
      await tx.execute(sql`
        INSERT INTO segment_memberships (segment_id, tenant_id, subject_id, added_at, removed_at)
        VALUES (${cfg.segmentId}, ${ctx.tenantId}, ${ctx.subjectId}, now(), NULL)
        ON CONFLICT (segment_id, subject_id) DO UPDATE
          SET added_at = EXCLUDED.added_at, removed_at = NULL
      `);
    } else {
      await tx.execute(sql`
        UPDATE segment_memberships
        SET removed_at = now()
        WHERE segment_id = ${cfg.segmentId}
          AND subject_id = ${ctx.subjectId}
          AND tenant_id = ${ctx.tenantId}
      `);
    }

    return { kind: "continue", output: { segmentId: cfg.segmentId, added: cfg.add } };
  },
};
