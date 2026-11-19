import { handleApiError } from "@/lib/api/error-handler";
/**
 * Search for the person a review meeting is with.
 *
 *   GET /api/review-meetings/subjects?kind=client|lead&q=<text>
 *
 * The scheduling form pre-loads a short list of clients / leads, but a book can
 * hold thousands, so typing in the picker searches the WHOLE book here - same data
 * wall as the Clients and Leads lists (an RM finds only their own clients).
 * Returns options shaped for the picker: { value, label, sub }.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { investorScopeSql } from "@/lib/investors/access";
import { leadScopeSql } from "@/lib/leads/access";

export const dynamic = "force-dynamic";

/** Escape LIKE wildcards so a typed "%" or "_" is searched literally. */
const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind") === "lead" ? "lead" : "client";
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
    if (q.length < 2) return NextResponse.json({ rows: [] });
    const like = likeOf(q);

    const rows = await withTenant(session.tenantId, async (tx) => {
      if (kind === "client") {
        const scope = await investorScopeSql(tx, session, "investors").catch(() => sql`FALSE`);
        const r = await tx.execute(sql`
          SELECT id, name, pan, segment_tag
          FROM investors
          WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' AND deleted_at IS NULL
            AND ${scope}
            AND (name ILIKE ${like} OR pan ILIKE ${like} OR phone ILIKE ${like})
          ORDER BY (lower(name) = lower(${q})) DESC, starts_with(lower(name), lower(${q})) DESC, name
          LIMIT 30
        `);
        return (r.rows as any[]).map((i) => ({
          value: String(i.id),
          label: String(i.name),
          sub: `${i.pan ?? ""}${i.segment_tag ? " · " + i.segment_tag : ""}`,
        }));
      }
      const scope = await leadScopeSql(tx, session, "leads").catch(() => sql`FALSE`);
      const r = await tx.execute(sql`
        SELECT id, name, phone, stage
        FROM leads
        WHERE tenant_id = ${session.tenantId}::uuid AND converted_investor_id IS NULL
          AND stage NOT IN ('lost', 'cold', 'not_interested')
          AND ${scope}
          AND (name ILIKE ${like} OR phone ILIKE ${like})
        ORDER BY (lower(name) = lower(${q})) DESC, name
        LIMIT 30
      `);
      return (r.rows as any[]).map((l) => ({
        value: String(l.id),
        label: String(l.name),
        sub: `${l.phone ? l.phone + " · " : ""}${String(l.stage ?? "").replace(/_/g, " ")}`,
      }));
    });
    return NextResponse.json({ rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}
