import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/amc-empanelments/import/commit  { mapping, rows }
 *
 * Writes the mapped rows as empanelments.
 *
 * An AMC CODE is unique per tenant (amc_empanelments has a unique index on it),
 * so a row whose code already exists UPDATES that panel entry rather than
 * failing. Re-uploading a corrected sheet is the normal way people fix an
 * import, and making the second upload collide with the first would leave them
 * deleting rows by hand before they could retry.
 *
 * Rows with no usable name are reported with their row number rather than
 * guessed at, so the sheet can be fixed and re-run.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const Body = z.object({
  mapping: z.record(z.string(), z.string()),
  rows: z.array(z.record(z.string(), z.any())).max(2000),
});

const VALID_STATUS = new Set(["empanelled", "pending", "terminated"]);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function toISODate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  if (!s) return null;
  if (ISO.test(s)) return s;
  // dd/mm/yyyy and dd-mm-yyyy — what an Indian firm's sheet is written in.
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    const dd = Number(d);
    const mm = Number(mo);
    if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;
    return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  const parsed = new Date(s);
  return isNaN(parsed.getTime())
    ? null
    : `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

/** A code the firm did not supply — derived from the name so the unique index
 *  still has something stable to hold, and a re-upload matches the same row. */
function codeFromName(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "AMC";
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
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
    const pickRaw = (row: Record<string, any>, field: string): unknown =>
      reverse[field] ? row[reverse[field]] : null;
    const orNull = (s: string) => (s === "" ? null : s);

    const result = await withTenant(session.tenantId, async (tx) => {
      let inserted = 0;
      let updated = 0;
      const errors: { rowIndex: number; error: string }[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const amcName = pick(row, "amcName");
        if (!amcName) {
          errors.push({ rowIndex: i, error: "AMC name is blank" });
          continue;
        }
        const amcCode = pick(row, "amcCode") || codeFromName(amcName);
        const statusRaw = pick(row, "status").toLowerCase();
        const status = VALID_STATUS.has(statusRaw) ? statusRaw : "empanelled";

        try {
          const res = await tx.execute(sql`
            INSERT INTO amc_empanelments (
              id, tenant_id, amc_code, amc_name, category, distributor_code,
              empanelment_date, status,
              rm_name, rm_email, rm_phone,
              ops_name, ops_email, ops_phone,
              escalation_name, escalation_email, escalation_phone,
              portal_url, remarks, created_at, updated_at
            ) VALUES (
              ${uuid()}, ${session.tenantId}::uuid, ${amcCode}, ${amcName},
              ${orNull(pick(row, "category"))}, ${orNull(pick(row, "distributorCode"))},
              ${toISODate(pickRaw(row, "empanelmentDate"))}::date, ${status},
              ${orNull(pick(row, "rmName"))}, ${orNull(pick(row, "rmEmail"))}, ${orNull(pick(row, "rmPhone"))},
              ${orNull(pick(row, "opsName"))}, ${orNull(pick(row, "opsEmail"))}, ${orNull(pick(row, "opsPhone"))},
              ${orNull(pick(row, "escalationName"))}, ${orNull(pick(row, "escalationEmail"))}, ${orNull(pick(row, "escalationPhone"))},
              ${orNull(pick(row, "portalUrl"))}, ${orNull(pick(row, "remarks"))},
              now(), now()
            )
            ON CONFLICT (tenant_id, amc_code) DO UPDATE SET
              amc_name = EXCLUDED.amc_name,
              category = COALESCE(EXCLUDED.category, amc_empanelments.category),
              distributor_code = COALESCE(EXCLUDED.distributor_code, amc_empanelments.distributor_code),
              empanelment_date = COALESCE(EXCLUDED.empanelment_date, amc_empanelments.empanelment_date),
              status = EXCLUDED.status,
              rm_name = COALESCE(EXCLUDED.rm_name, amc_empanelments.rm_name),
              rm_email = COALESCE(EXCLUDED.rm_email, amc_empanelments.rm_email),
              rm_phone = COALESCE(EXCLUDED.rm_phone, amc_empanelments.rm_phone),
              ops_name = COALESCE(EXCLUDED.ops_name, amc_empanelments.ops_name),
              ops_email = COALESCE(EXCLUDED.ops_email, amc_empanelments.ops_email),
              ops_phone = COALESCE(EXCLUDED.ops_phone, amc_empanelments.ops_phone),
              escalation_name = COALESCE(EXCLUDED.escalation_name, amc_empanelments.escalation_name),
              escalation_email = COALESCE(EXCLUDED.escalation_email, amc_empanelments.escalation_email),
              escalation_phone = COALESCE(EXCLUDED.escalation_phone, amc_empanelments.escalation_phone),
              portal_url = COALESCE(EXCLUDED.portal_url, amc_empanelments.portal_url),
              remarks = COALESCE(EXCLUDED.remarks, amc_empanelments.remarks),
              updated_at = now()
            RETURNING (xmax = 0) AS was_insert
          `);
          const wasInsert = (res.rows[0] as { was_insert?: boolean } | undefined)?.was_insert;
          if (wasInsert) inserted++;
          else updated++;
        } catch (err: any) {
          errors.push({ rowIndex: i, error: String(err?.message ?? "insert failed") });
        }
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "amc_empanelment.bulk_import",
        entityType: "amc_empanelment",
        entityId: null,
        meta: { inserted, updated, errored: errors.length, totalRows: rows.length },
        ...clientMeta,
      });

      return { inserted, updated, errors };
    });

    return NextResponse.json({
      inserted: result.inserted,
      // The wizard shows this as "skipped"; here it is the more useful
      // "already on the panel, refreshed from the sheet".
      skipped: result.updated,
      errors: result.errors,
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
