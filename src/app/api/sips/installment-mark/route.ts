import { handleApiError } from "@/lib/api/error-handler";
/**
 * Manual override for a New-SIP installment-watch cell.
 *   POST /api/sips/installment-mark
 *     { sipId, installmentNo (1..6), status: 'deducted'|'bounced'|'pending'|null, note? }
 *   status=null clears the manual mark (cell reverts to the feed-derived status).
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

const MANAGE_ROLES = ["owner", "branch_head", "rm", "back_office", "ops"];
const seesAllEntries = (s: { roles: string[]; permissions?: string[] | null }) =>
  can(s.roles, "investor.view.all", s.permissions) || can(s.roles, "reports.business", s.permissions);

const Body = z.object({
  sipId: z.string().uuid(),
  installmentNo: z.number().int().min(1).max(6),
  status: z.enum(["deducted", "bounced", "pending"]).nullable(),
  note: z.string().max(280).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!session.roles.some((r) => MANAGE_ROLES.includes(r))) {
      return NextResponse.json({ error: "Not permitted" }, { status: 403 });
    }
    const { sipId, installmentNo, status, note } = Body.parse(await req.json());

    await withTenant(session.tenantId, async (tx) => {
      // Confirm the SIP belongs to this tenant (RLS-scoped) and, for an RM, that
      // it's in their book — they shouldn't mark a SIP they can't see.
      const own = await tx.execute(sql`
        SELECT s.rm_id, i.rm_id AS inv_rm
          FROM sips s LEFT JOIN investors i ON i.id = s.investor_id
         WHERE s.id = ${sipId}::uuid LIMIT 1
      `);
      const row = own.rows[0] as { rm_id: string | null; inv_rm: string | null } | undefined;
      if (!row) throw new Error("SIP not found");
      if (!seesAllEntries(session) && row.rm_id !== session.userId && row.inv_rm !== session.userId) {
        throw Object.assign(new Error("you can only mark SIPs in your book"), { status: 403 });
      }

      if (status === null) {
        await tx.execute(sql`
          DELETE FROM sip_installment_marks
           WHERE tenant_id = ${session.tenantId}::uuid AND sip_id = ${sipId}::uuid AND installment_no = ${installmentNo}
        `);
        return;
      }

      await tx.execute(sql`
        INSERT INTO sip_installment_marks (tenant_id, sip_id, installment_no, status, note, marked_by_id)
        VALUES (${session.tenantId}::uuid, ${sipId}::uuid, ${installmentNo}, ${status}, ${note ?? null}, ${session.userId}::uuid)
        ON CONFLICT (tenant_id, sip_id, installment_no) DO UPDATE SET
          status = EXCLUDED.status,
          note = EXCLUDED.note,
          marked_by_id = EXCLUDED.marked_by_id,
          updated_at = now()
      `);
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
