import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/transactions/export — download the (filtered) MF-transaction list as
 * an .xlsx. Applies the EXACT same filters as the list page via the shared
 * buildTransactionConditions helper, so the file always matches what's on
 * screen (search / type / status / RM / AMC / source / date range). MFD ops
 * export this constantly for CAMS/KFintech reconciliation. RLS scopes the tenant.
 */

import { NextRequest } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { transactions, investors, users } from "@/db/schema";
import { buildTransactionConditions } from "@/lib/transactions/list-filters";

export const dynamic = "force-dynamic";

const MAX_ROWS = 10000;

function ymd(v: unknown): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(v as any);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();

    const sp: Record<string, string | undefined> = {};
    req.nextUrl.searchParams.forEach((v, k) => {
      sp[k] = v;
    });

    const rows = await withTenant(session.tenantId, async (tx) => {
      const conds = buildTransactionConditions(sp);
      const baseQ = tx
        .select({ tx: transactions, investorName: investors.name, rmName: users.name })
        .from(transactions)
        .leftJoin(investors, eq(investors.id, transactions.investorId))
        .leftJoin(users, eq(users.id, transactions.executedByUserId));
      return conds.length
        ? await baseQ
            .where(sql.join(conds, sql` AND `) as any)
            .orderBy(desc(transactions.orderDate), desc(transactions.createdAt))
            .limit(MAX_ROWS)
        : await baseQ.orderBy(desc(transactions.orderDate), desc(transactions.createdAt)).limit(MAX_ROWS);
    });

    const data = rows.map(({ tx: t, investorName, rmName }) => ({
      "Order date": ymd(t.orderDate),
      Investor: investorName ?? "",
      Folio: t.folioNumber ?? "",
      AMC: t.amcName ?? t.amcCode ?? "",
      Scheme: t.schemeName ?? t.schemeCode ?? "",
      Category: t.schemeCategory ?? "",
      Type: t.type ?? "",
      Direction: t.direction ?? "",
      "Amount (INR)": t.amount != null ? Number(t.amount) : "",
      Units: t.units != null ? Number(t.units) : "",
      NAV: t.nav != null ? Number(t.nav) : "",
      Status: t.status ?? "",
      Source: t.sourceFeed ?? "",
      RM: rmName ?? "",
      Remarks: t.remarks ?? (t as any).reasonDescription ?? "",
      "Created at": ymd(t.createdAt),
    }));

    const ws = XLSX.utils.json_to_sheet(
      data.length ? data : [{ "Order date": "(no transactions match the current filters)" }]
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transactions");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="transactions-${stamp}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
