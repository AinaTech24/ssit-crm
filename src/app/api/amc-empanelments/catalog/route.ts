import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/amc-empanelments/catalog  { name }
 *
 * Adds an AMC to this firm's catalogue (amc_master) from the empanelment form,
 * so a house that is not on the list can be added on the spot instead of
 * stopping the whole entry. Idempotent on the code: adding a name that already
 * exists returns the existing row rather than failing.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { amcCodeFromName, normaliseAmcName } from "@/lib/amc/standard-list";

export const dynamic = "force-dynamic";

const Body = z.object({ name: z.string().trim().min(2).max(120) });

/**
 * DELETE /api/amc-empanelments/catalog  { code }
 *
 * Removes an AMC name from this firm's list (a typo, a test entry). It is hidden
 * rather than erased — amc_master rows are referenced by schemes and history —
 * and refused while an empanelment still uses it, so nothing is orphaned.
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["compliance.edit", "amc_empanelment.view"], session.permissions);
    const parse = z.object({ code: z.string().trim().min(1).max(120) }).safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "AMC code is required" }, { status: 400 });
    const code = parse.data.code;

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const used = await tx.execute(sql`
        SELECT 1 FROM amc_empanelments
         WHERE tenant_id = ${session.tenantId}::uuid AND amc_code = ${code}
         LIMIT 1
      `);
      if (used.rows.length) return "in_use" as const;
      await tx.execute(sql`
        UPDATE amc_master SET is_active = false, updated_at = now()
         WHERE tenant_id = ${session.tenantId}::uuid AND code = ${code}
      `);
      return "ok" as const;
    });
    if (outcome === "in_use") {
      return NextResponse.json(
        { error: "This AMC already has an empanelment. Delete or terminate that first." },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["compliance.edit", "amc_empanelment.view"], session.permissions);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "AMC name is required" }, { status: 400 });
    }
    const name = parse.data.name;
    const code = amcCodeFromName(name);

    const row = await withTenant(session.tenantId, async (tx) => {
      // Same house under a different spelling ("HDFC" vs "HDFC Mutual Fund")
      // must not become a second row.
      const existing = await tx.execute(sql`
        SELECT code, name FROM amc_master
         WHERE tenant_id = ${session.tenantId}::uuid
      `);
      const key = normaliseAmcName(name);
      const dupe = (existing.rows as { code: string; name: string }[]).find(
        (r) => r.code === code || normaliseAmcName(r.name) === key
      );
      if (dupe) return { code: String(dupe.code), name: String(dupe.name) };

      await tx.execute(sql`
        INSERT INTO amc_master (id, tenant_id, code, name, is_active, created_at, updated_at)
        VALUES (gen_random_uuid(), ${session.tenantId}::uuid, ${code}, ${name}, true, now(), now())
        ON CONFLICT (tenant_id, code) DO NOTHING
      `);
      return { code, name };
    });

    return NextResponse.json({ amc: row });
  } catch (err: any) {
    return handleApiError(err);
  }
}
