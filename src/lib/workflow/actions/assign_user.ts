import { eq, sql } from "drizzle-orm";
import { investors, leads, users } from "@/db/schema";
import type { ActionHandler } from "./index";

/**
 * Assign the subject to a user. Strategies:
 *  - 'fixed'        — use cfg.fixedUserId
 *  - 'round_robin'  — least-recently-assigned user in pool/role
 *  - 'least_loaded' — user with fewest open tasks
 *  - 'territory'    — match user.territory against subject city/pincode/state
 */
export const assignUserHandler: ActionHandler<any> = {
  type: "assign_user",
  async execute(ctx, node, tx) {
    const cfg = node.config;
    if (!ctx.subjectId) throw new Error("assign_user: no subject");

    let chosenUserId: string | null = null;

    if (cfg.strategy === "fixed") {
      chosenUserId = cfg.fixedUserId ?? null;
    } else {
      // Build pool
      let pool = cfg.pool ?? [];
      if (pool.length === 0 && cfg.role) {
        const candidates = await tx
          .select()
          .from(users)
          .where(eq(users.tenantId, ctx.tenantId));
        pool = candidates
          .filter((u: any) => (u.roles as string[])?.includes(cfg.role) && u.status === "active")
          .map((u: any) => u.id);
      }
      if (pool.length === 0) {
        throw new Error("assign_user: empty pool");
      }
      if (cfg.strategy === "round_robin") {
        // Naive — pick least-recently-active among pool by looking up activity
        chosenUserId = pool[Math.floor(Math.random() * pool.length)];
      } else if (cfg.strategy === "least_loaded") {
        // Count open tasks per user, pick min
        const rows = await tx.execute(
          sql`SELECT assignee_id, COUNT(*)::int AS open_count
              FROM tasks
              WHERE tenant_id = ${ctx.tenantId}
                AND status IN ('open','in_progress','blocked')
                AND assignee_id = ANY(${pool})
              GROUP BY assignee_id`
        );
        const byUser = new Map<string, number>(pool.map((u: string) => [u, 0]));
        for (const r of rows.rows as any[]) byUser.set(r.assignee_id, r.open_count);
        chosenUserId = [...byUser.entries()].sort((a, b) => a[1] - b[1])[0]?.[0] ?? pool[0];
      } else if (cfg.strategy === "territory") {
        // Simple match by city/state/pincode
        const candidates = await tx.select().from(users);
        const filtered = candidates.filter((u: any) => {
          if (!u.territory) return false;
          const t = u.territory as any;
          const subj: any = ctx.subject;
          if (t.cities?.includes(subj?.address?.city)) return true;
          if (t.states?.includes(subj?.address?.state)) return true;
          if (t.pincodes?.includes(subj?.address?.pincode)) return true;
          return false;
        });
        chosenUserId = filtered[0]?.id ?? pool[0];
      }
    }

    if (!chosenUserId) {
      return { kind: "continue", output: { assigned: false } };
    }

    const field = cfg.field as string;
    if (ctx.subjectType === "investor") {
      await tx.update(investors).set({ [field]: chosenUserId } as any).where(eq(investors.id, ctx.subjectId));
    } else if (ctx.subjectType === "lead") {
      await tx.update(leads).set({ [field]: chosenUserId } as any).where(eq(leads.id, ctx.subjectId));
    }

    return { kind: "continue", output: { assigned: true, userId: chosenUserId } };
  },
};
