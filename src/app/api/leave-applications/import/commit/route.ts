import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/leave-applications/import/commit  { mapping, rows }
 *
 * Writes the mapped rows as leave applications. One transaction, so a sheet
 * either lands or it does not — a half-imported leave register is worse than
 * none, because nobody can tell which half is missing.
 *
 * Rows that cannot be placed are REPORTED rather than guessed at: an employee
 * name that matches nobody, a date that is not a date, a range that ends before
 * it starts. The importer returns them with their row number so the sheet can
 * be fixed and re-run, and the rest still import.
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
import { computeDays } from "@/lib/leave/policy";

export const dynamic = "force-dynamic";

const Body = z.object({
  mapping: z.record(z.string(), z.string()),
  rows: z.array(z.record(z.string(), z.any())).max(5000),
});

const VALID_STATUS = new Set(["requested", "approved", "rejected", "cancelled"]);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Accepts what a spreadsheet actually produces: an ISO string, a Date the
 * parser already coerced (cellDates), or dd/mm/yyyy and dd-mm-yyyy, which is
 * what an Indian firm's register is written in. Returns null rather than a
 * wrong date — a leave register with the month and day transposed is worse
 * than a rejected row.
 */
function toISODate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  if (!s) return null;
  if (ISO.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    const dd = Number(d);
    const mm = Number(mo);
    if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;
    return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "leave.manage.all", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const { mapping, rows } = parse.data;
    const clientMeta = clientMetaFromHeaders(req.headers);

    // mapping is { sheetHeader: ourField }; invert so a field reads its column.
    const reverse: Record<string, string> = {};
    for (const [header, field] of Object.entries(mapping)) {
      if (field) reverse[field] = header;
    }
    const pick = (row: Record<string, any>, field: string): string => {
      const header = reverse[field];
      if (!header) return "";
      const v = row[header];
      return v == null ? "" : String(v).trim();
    };
    const pickRaw = (row: Record<string, any>, field: string): unknown => {
      const header = reverse[field];
      return header ? row[header] : null;
    };

    const result = await withTenant(session.tenantId, async (tx) => {
      // Roster once, matched on name OR email, both case-insensitively — a
      // register written by a human says "Priya Nair", not a uuid.
      const userRes = await tx.execute(sql`
        SELECT id, name, email FROM users
        WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
      `);
      const byKey = new Map<string, string>();
      for (const u of userRes.rows as { id: string; name: string | null; email: string | null }[]) {
        if (u.name) byKey.set(u.name.trim().toLowerCase(), String(u.id));
        if (u.email) byKey.set(u.email.trim().toLowerCase(), String(u.id));
      }

      let inserted = 0;
      const errors: { rowIndex: number; error: string }[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const who = pick(row, "employee").toLowerCase();
        const employeeUserId = byKey.get(who);
        if (!employeeUserId) {
          errors.push({ rowIndex: i, error: who ? `no active employee matches "${pick(row, "employee")}"` : "employee is blank" });
          continue;
        }

        const fromDate = toISODate(pickRaw(row, "fromDate"));
        if (!fromDate) {
          errors.push({ rowIndex: i, error: "from date is missing or not a date" });
          continue;
        }
        const toDate = toISODate(pickRaw(row, "toDate")) ?? fromDate;
        if (toDate < fromDate) {
          errors.push({ rowIndex: i, error: "to date is before the from date" });
          continue;
        }

        const durationRaw = pick(row, "duration").toLowerCase().replace(/[\s-]/g, "_");
        const duration: "full_day" | "half_day" = durationRaw.includes("half") ? "half_day" : "full_day";

        const statusRaw = pick(row, "status").toLowerCase().trim();
        const status = VALID_STATUS.has(statusRaw) ? statusRaw : "approved";

        // Reason is compulsory on the form, so it is compulsory here too —
        // an imported register that loses the reason is a register nobody can
        // audit afterwards.
        const reason = pick(row, "reason");
        if (!reason) {
          errors.push({ rowIndex: i, error: "reason is blank" });
          continue;
        }

        const daysRaw = Number(pick(row, "noOfDays"));
        const noOfDays =
          Number.isFinite(daysRaw) && daysRaw > 0 ? daysRaw : computeDays(fromDate, toDate, duration);
        if (!noOfDays) {
          errors.push({ rowIndex: i, error: "could not work out the number of days" });
          continue;
        }

        try {
          await tx.execute(sql`
            INSERT INTO leave_applications
              (id, tenant_id, employee_user_id, leave_type, duration, from_date, to_date,
               no_of_days, reason, status, approver_user_id, decided_at, created_at, updated_at)
            VALUES (
              ${uuid()}, ${session.tenantId}::uuid, ${employeeUserId}::uuid,
              'casual', ${duration}, ${fromDate}::date, ${toDate}::date,
              ${noOfDays}, ${reason}, ${status},
              ${status === "approved" || status === "rejected" ? session.userId : null},
              ${status === "approved" || status === "rejected" ? sql`now()` : null},
              now(), now()
            )
          `);
          inserted++;
        } catch (err: any) {
          errors.push({ rowIndex: i, error: String(err?.message ?? "insert failed") });
        }
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "leave.bulk_import",
        entityType: "leave_application",
        entityId: null,
        meta: { inserted, errored: errors.length, totalRows: rows.length },
        ...clientMeta,
      });

      return { inserted, errors };
    });

    return NextResponse.json({
      inserted: result.inserted,
      skipped: 0,
      errors: result.errors,
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
