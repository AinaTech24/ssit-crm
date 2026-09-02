import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/reports/saved/[id]/export — download a saved report.
 *   ?format=xlsx (default) | csv
 * Detailed → a row table; matrix → a cross-tab with a totals column;
 * summary → a grouped table with sub-totals + a grand-total row.
 */
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { savedReports } from "@/db/schema";
import { runDetailed, runMatrix, runSummary, type SummaryGroupNode } from "@/lib/reports/run";

export const dynamic = "force-dynamic";

function slug(s: string) {
  return (s || "report").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "reports.manage", session.permissions);
    const format = (new URL(req.url).searchParams.get("format") ?? "xlsx").toLowerCase() === "csv" ? "csv" : "xlsx";

    const data = await withTenant(session.tenantId, async (tx) => {
      const r = (await tx.select().from(savedReports).where(and(eq(savedReports.id, id), eq(savedReports.tenantId, session.tenantId))).limit(1))[0];
      if (!r) return null;
      if (r.reportType === "matrix") {
        const m = await runMatrix(tx, { subject: r.subject, ast: r.ast as any, matrix: r.matrix as any, tenantId: session.tenantId });
        return { name: r.name, aoa: matrixAoa(m) };
      }
      if (r.reportType === "summary") {
        const s = await runSummary(tx, { subject: r.subject, ast: r.ast as any, summary: r.summary as any, tenantId: session.tenantId });
        return { name: r.name, aoa: summaryAoa(s) };
      }
      const d = await runDetailed(tx, {
        subject: r.subject,
        ast: r.ast as any,
        columns: r.columns as string[] | null,
        sort: r.sort as any,
        tenantId: session.tenantId,
        limit: 5000,
      });
      return {
        name: r.name,
        aoa: [d.columns.map((c) => c.label), ...d.rows.map((row) => d.columns.map((c) => fmt(row[c.key])))] as (string | number)[][],
      };
    });
    if (!data) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });

    const ws = XLSX.utils.aoa_to_sheet(data.aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report");

    if (format === "csv") {
      const csv = XLSX.utils.sheet_to_csv(ws);
      return new Response(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${slug(data.name)}.csv"`,
        },
      });
    }

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    return new Response(buf, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${slug(data.name)}.xlsx"`,
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}

function matrixAoa(m: Awaited<ReturnType<typeof runMatrix>>): (string | number)[][] {
  return [
    [m.groupByLabel, ...m.colLabels, "Total"],
    ...m.rows.map((row) => [row.key, ...row.cells, row.total]),
  ];
}

/** Flatten a summary report into a grouped AOA: group cols + Records + aggregates. */
function summaryAoa(s: Awaited<ReturnType<typeof runSummary>>): (string | number)[][] {
  const header = [...s.groupLabels, "Records", ...s.aggregateDefs.map((a) => a.label)];
  const out: (string | number)[][] = [header];
  const walk = (node: SummaryGroupNode, depth: number) => {
    const row: (string | number)[] = new Array(s.groupLabels.length).fill("");
    row[depth] = node.key;
    out.push([...row, node.count, ...node.aggregates]);
    for (const c of node.children ?? []) walk(c, depth + 1);
  };
  for (const root of s.tree) walk(root, 0);
  const grandRow: (string | number)[] = new Array(s.groupLabels.length).fill("");
  grandRow[0] = "Grand Total";
  out.push([...grandRow, s.grand.count, ...s.grand.aggregates]);
  return out;
}

function fmt(v: unknown): string | number {
  if (v == null) return "";
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}
