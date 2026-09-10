import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/leads/check-duplicate
 *   Body: { phone?, email?, pan? }
 *   Returns: { matches: Array<{ id, name, stage, source, createdAt, matchedOn }> }
 *
 * Used by the "New lead" form to warn the RM before creating a duplicate.
 * Match priority: phone (last 10 digits) → email (case-insensitive) → PAN.
 */

import { NextRequest, NextResponse } from "next/server";
import { desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { leads } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const Body = z.object({
  phone: z.string().optional(),
  email: z.string().optional(),
  pan: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const { phone, email, pan } = parsed.data;

    // Need at least one field
    if (!phone && !email && !pan) return NextResponse.json({ matches: [] });

    const last10 = phone ? phone.replace(/\D/g, "").slice(-10) : null;
    const emailLower = email ? email.trim().toLowerCase() : null;
    const panUpper = pan ? pan.trim().toUpperCase() : null;

    // Match on the INDEXED columns the schema maintains for exactly this:
    // phone_normalized / email_normalized (leads_phone_norm_idx / _email_norm_idx)
    // and the real `pan` column (leads_pan_idx). The old code matched PAN inside
    // free-text `notes` (never selected → never matched) and used unindexable
    // expressions on raw phone/email, full-scanning on every keystroke.
    const conds: any[] = [];
    if (last10) conds.push(sql`leads.phone_normalized = ${last10}`);
    if (emailLower) conds.push(sql`leads.email_normalized = ${emailLower}`);
    if (panUpper) conds.push(sql`upper(coalesce(leads.pan, '')) = ${panUpper}`);
    const where = sql.join(conds, sql` OR `);

    const rows = await withTenant(session.tenantId, async (tx) => {
      return tx.execute(sql`
        SELECT id, name, stage, source, phone, email, pan,
               phone_normalized, email_normalized, created_at
        FROM leads
        WHERE (${where})
          AND coalesce(lost_reason, '') <> '__deleted__'
          AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 5
      `);
    });

    const matches = (rows.rows as any[]).map((r) => {
      const matchedOn: string[] = [];
      if (last10 && r.phone_normalized === last10) matchedOn.push("phone");
      if (emailLower && (r.email_normalized ?? "") === emailLower) matchedOn.push("email");
      if (panUpper && (r.pan ?? "").toUpperCase() === panUpper) matchedOn.push("pan");
      return {
        id: r.id,
        name: r.name,
        stage: r.stage,
        source: r.source,
        phone: r.phone,
        email: r.email,
        createdAt: r.created_at,
        matchedOn,
      };
    });

    return NextResponse.json({ matches });
  } catch (err: any) {
    return handleApiError(err);
  }
}
