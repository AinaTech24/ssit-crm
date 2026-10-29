import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/amc-empanelments/catalog/import/commit  { mapping, rows }
 *
 * Adds the sheet's AMCs to this firm's AMC list (amc_master) — the dropdown
 * offered when an empanelment is added. Idempotent: an AMC already on the list,
 * under the same name OR a spelling that normalises to it ("HDFC" vs "HDFC
 * Mutual Fund"), is skipped rather than duplicated, so re-uploading a sheet with
 * new rows added only adds the new ones.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { amcCodeFromName, normaliseAmcName } from "@/lib/amc/standard-list";

export const dynamic = "force-dynamic";

const Body = z.object({
  mapping: z.record(z.string(), z.string()),
  rows: z.array(z.record(z.string(), z.any())).max(2000),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["amc_empanelment.add"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const { mapping, rows } = parse.data;
    const clientMeta = clientMetaFromHeaders(req.headers);

    const reverse: Record<string, string> = {};
    for (const [header, field] of Object.entries(mapping)) if (field) reverse[field] = header;
    const pick = (row: Record<string, any>, field: string): string => {
      const header = reverse[field];
      if (!header) return "";
      const v = row[header];
      return v == null ? "" : String(v).trim();
    };

    const result = await withTenant(session.tenantId, async (tx) => {
      const existing = await tx.execute(sql`
        SELECT code, name FROM amc_master WHERE tenant_id = ${session.tenantId}::uuid
      `);
      const seenNames = new Set<string>();
      const seenCodes = new Set<string>();
      for (const r of existing.rows as { code: string; name: string }[]) {
        seenNames.add(normaliseAmcName(r.name));
        seenCodes.add(String(r.code));
      }

      let inserted = 0;
      let skipped = 0;
      const errors: { rowIndex: number; error: string }[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const name = pick(row, "amcName");
        if (!name) {
          errors.push({ rowIndex: i, error: "AMC name is blank" });
          continue;
        }
        const key = normaliseAmcName(name);
        if (!key || seenNames.has(key)) {
          skipped++;
          continue;
        }
        const suppliedCode = pick(row, "amcCode").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
        let code = suppliedCode || amcCodeFromName(name);
        // Two different names can derive the same code; keep the first, suffix the rest.
        for (let n = 2; seenCodes.has(code); n++) code = `${(suppliedCode || amcCodeFromName(name)).slice(0, 36)}_${n}`;
        try {
          await tx.execute(sql`
            INSERT INTO amc_master (id, tenant_id, code, name, is_active, created_at, updated_at)
            VALUES (gen_random_uuid(), ${session.tenantId}::uuid, ${code}, ${name}, true, now(), now())
          `);
          seenNames.add(key);
          seenCodes.add(code);
          inserted++;
        } catch (err: any) {
          errors.push({ rowIndex: i, error: String(err?.message ?? "insert failed") });
        }
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "amc_catalog.bulk_import",
        entityType: "amc_master",
        entityId: null,
        meta: { inserted, skipped, errored: errors.length, totalRows: rows.length },
        ...clientMeta,
      });

      return { inserted, skipped, errors };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
