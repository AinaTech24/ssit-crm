/**
 * Scheduled-report delivery. Runs a saved report and emails an HTML summary to
 * its configured recipients. These are INTERNAL staff emails (the firm's own
 * team), so they go straight through the email adapter — no consent/compliance
 * gate (that gate is for client-facing sends). The renderer caps rows so a big
 * report doesn't produce a monster email; recipients open the CRM for the full
 * set + Excel export.
 */
import { withTenant } from "@/db/client";
import { emailAdapter } from "@/lib/comms/adapters/resend";
import { loadTenant } from "@/lib/comms/pipeline";
import { runDetailed, runMatrix, runSummary, type DetailedResult, type MatrixResult, type SummaryResult, type SummaryGroupNode } from "./run";
import type { SavedReport } from "@/db/schema";

const MAX_EMAIL_ROWS = 50;

function esc(v: unknown): string {
  if (v == null || v === "") return "—";
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function num(v: number): string {
  return Number(v).toLocaleString("en-IN");
}

function detailedToHtml(d: DetailedResult): string {
  const head = d.columns.map((c) => `<th style="text-align:left;padding:6px 10px;border-bottom:2px solid #e5e7eb;font-size:12px;color:#475569">${esc(c.label)}</th>`).join("");
  const body = d.rows
    .slice(0, MAX_EMAIL_ROWS)
    .map(
      (row) =>
        `<tr>${d.columns.map((c) => `<td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:13px">${esc(row[c.key])}</td>`).join("")}</tr>`
    )
    .join("");
  const more = d.rows.length > MAX_EMAIL_ROWS ? `<p style="font-size:12px;color:#6b7280">…and ${d.rows.length - MAX_EMAIL_ROWS} more rows. Open the CRM for the full report.</p>` : "";
  return `<table style="border-collapse:collapse;width:100%"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${more}`;
}

function matrixToHtml(m: MatrixResult): string {
  const head = `<th style="text-align:left;padding:6px 10px;border-bottom:2px solid #e5e7eb;font-size:12px;color:#475569">${esc(m.groupByLabel)}</th>${m.colLabels
    .map((c) => `<th style="text-align:right;padding:6px 10px;border-bottom:2px solid #e5e7eb;font-size:12px;color:#475569">${esc(c)}</th>`)
    .join("")}<th style="text-align:right;padding:6px 10px;border-bottom:2px solid #e5e7eb;font-size:12px;color:#475569">Total</th>`;
  const body = m.rows
    .slice(0, MAX_EMAIL_ROWS)
    .map(
      (row) =>
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:600">${esc(row.key)}</td>${row.cells
          .map((v) => `<td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:13px;text-align:right">${num(v)}</td>`)
          .join("")}<td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:13px;text-align:right;font-weight:600">${num(row.total)}</td></tr>`
    )
    .join("");
  return `<table style="border-collapse:collapse;width:100%"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function summaryToHtml(s: SummaryResult): string {
  const aggCols = s.aggregateDefs.map((a) => a.label);
  const head = `<th style="text-align:left;padding:6px 10px;border-bottom:2px solid #e5e7eb;font-size:12px;color:#475569">Group</th><th style="text-align:right;padding:6px 10px;border-bottom:2px solid #e5e7eb;font-size:12px;color:#475569">Records</th>${aggCols
    .map((c) => `<th style="text-align:right;padding:6px 10px;border-bottom:2px solid #e5e7eb;font-size:12px;color:#475569">${esc(c)}</th>`)
    .join("")}`;
  const rows: string[] = [];
  const walk = (node: SummaryGroupNode, depth: number) => {
    const indent = depth * 16;
    rows.push(
      `<tr><td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:600;padding-left:${10 + indent}px">${esc(node.key)}</td><td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:13px;text-align:right">${num(node.count)}</td>${node.aggregates
        .map((v) => `<td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:13px;text-align:right">${num(v)}</td>`)
        .join("")}</tr>`
    );
    for (const c of node.children ?? []) walk(c, depth + 1);
  };
  for (const root of s.tree.slice(0, MAX_EMAIL_ROWS)) walk(root, 0);
  rows.push(
    `<tr style="background:#f8fafc"><td style="padding:6px 10px;font-size:13px;font-weight:700">Grand Total</td><td style="padding:6px 10px;font-size:13px;text-align:right;font-weight:700">${num(s.grand.count)}</td>${s.grand.aggregates
      .map((v) => `<td style="padding:6px 10px;font-size:13px;text-align:right;font-weight:700">${num(v)}</td>`)
      .join("")}</tr>`
  );
  return `<table style="border-collapse:collapse;width:100%"><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

function wrapHtml(name: string, inner: string, tenant: any, appUrl: string): string {
  const sig = [tenant?.legalName, tenant?.arn ? `ARN-${tenant.arn}` : ""].filter(Boolean).join(" · ");
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;max-width:760px;margin:0 auto">
  <h2 style="font-size:18px;margin:0 0 4px">${esc(name)}</h2>
  <p style="font-size:12px;color:#6b7280;margin:0 0 16px">Scheduled report · generated ${new Date().toLocaleString("en-IN")}</p>
  ${inner}
  <p style="margin-top:20px"><a href="${appUrl}" style="font-size:13px;color:#0ea5e9">Open in the CRM →</a></p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:18px 0"/>
  <p style="font-size:11px;color:#94a3b8;margin:0">${esc(sig)}</p>
</div>`;
}

/** Render the report to an email body — no send (testable, reusable). */
export async function renderReportEmail(
  tx: Parameters<typeof loadTenant>[0],
  report: SavedReport
): Promise<{ subject: string; html: string; text: string }> {
  const appUrl = `${process.env.APP_BASE_URL ?? ""}/dashboard/reports/custom/${report.id}`;
  const tenant = await loadTenant(tx, report.tenantId);
  let inner: string;
  if (report.reportType === "matrix") {
    const m = await runMatrix(tx, { subject: report.subject, ast: report.ast as any, matrix: report.matrix as any, tenantId: report.tenantId });
    inner = matrixToHtml(m);
  } else if (report.reportType === "summary") {
    const s = await runSummary(tx, { subject: report.subject, ast: report.ast as any, summary: report.summary as any, tenantId: report.tenantId });
    inner = summaryToHtml(s);
  } else {
    const d = await runDetailed(tx, {
      subject: report.subject,
      ast: report.ast as any,
      columns: report.columns as string[] | null,
      sort: report.sort as any,
      tenantId: report.tenantId,
      limit: 200,
    });
    inner = detailedToHtml(d);
  }
  return {
    subject: `[Report] ${report.name}`,
    html: wrapHtml(report.name, inner, tenant, appUrl),
    text: `${report.name} — your scheduled report is ready. Open the CRM to view + export.`,
  };
}

export async function deliverReport(report: SavedReport): Promise<{ sent: number; errors: string[] }> {
  const emails = (report.schedule?.emails ?? []).filter(Boolean);
  if (!emails.length) return { sent: 0, errors: ["no recipients"] };

  const { subject, html, text } = await withTenant(report.tenantId, (tx) => renderReportEmail(tx, report));

  let sent = 0;
  const errors: string[] = [];
  for (const to of emails) {
    try {
      await emailAdapter.send({
        tenantId: report.tenantId,
        tokens: {},
        rendered: { subject, text, tokens: {} },
        recipient: to,
        category: "transactional",
        inlineHtml: html,
      });
      sent++;
    } catch (e: any) {
      errors.push(`${to}: ${e?.message ?? e}`);
    }
  }
  return { sent, errors };
}
