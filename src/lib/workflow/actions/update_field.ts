import { eq, sql } from "drizzle-orm";
import { investors, leads, tasks } from "@/db/schema";
import { getCatalog, getField } from "@/lib/filter/catalog";
import { resolveExpression } from "../context";
import type { ActionHandler } from "./index";

/**
 * Update fields on the subject record. Only fields declared `writable: true`
 * in the catalog can be written — this is the line of defense against
 * arbitrary SQL via configuration.
 */
export const updateFieldHandler: ActionHandler<any> = {
  type: "update_field",
  async execute(ctx, node, tx) {
    const target = node.config.target ?? "subject";
    if (target !== "subject") {
      throw new Error("update_field: only 'subject' target supported in v1");
    }
    if (!ctx.subjectType || !ctx.subjectId) {
      throw new Error("update_field: no subject");
    }

    const catalog = getCatalog(ctx.subjectType);
    const updates: Record<string, any> = {};
    for (const [key, raw] of Object.entries(node.config.updates as Record<string, unknown>)) {
      const def = getField(ctx.subjectType, key);
      if (!def.writable) {
        throw new Error(`update_field: field '${key}' is not writable`);
      }
      const value = typeof raw === "string" ? resolveExpression(raw, ctx) : raw;
      updates[snakeCaseToDrizzleKey(key)] = value;
    }

    if (Object.keys(updates).length === 0) {
      return { kind: "continue", output: { updated: 0 } };
    }

    switch (ctx.subjectType) {
      case "investor":
        await tx.update(investors).set(updates as any).where(eq(investors.id, ctx.subjectId));
        break;
      case "lead":
        await tx.update(leads).set(updates as any).where(eq(leads.id, ctx.subjectId));
        break;
      case "task":
        await tx.update(tasks).set(updates as any).where(eq(tasks.id, ctx.subjectId));
        break;
      default:
        throw new Error(`update_field: unsupported subject '${ctx.subjectType}'`);
    }

    return { kind: "continue", output: { updated: Object.keys(updates).length, fields: Object.keys(updates) } };
  },
};

/** Convert catalog key (`segment_tag`) to Drizzle ORM field name (`segmentTag`). */
function snakeCaseToDrizzleKey(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
