/**
 * Render the client-facing "business confirmation" email for a Business Closing
 * Entry — a factual, transactional summary of what was booked (no advice, no
 * returns claims), with the mandatory MF risk line.
 */

import { emailLogoHeaderHtml } from "@/lib/comms/email-logo";

const TXN_LABEL: Record<string, string> = {
  sip: "SIP", sip_topup: "SIP Top-Up", other: "Others", lumpsum: "Lumpsum", additional_purchase: "Additional Purchase",
  switch: "Switch", stp: "STP", swp: "SWP", redemption: "Redemption",
};
const PRODUCT_LABEL: Record<string, string> = {
  mutual_fund: "Mutual Fund", pms: "PMS", aif: "AIF", sif: "SIF", bond: "Bond", ncd: "NCD", other: "Investment",
};

function inr(n: string | number): string {
  return `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
}
function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export type EmailLine = {
  schemeName: string;
  txnType: string;
  amount: string | number;
  frequency?: string | null;
  fromSchemeName?: string | null;
};

export function renderBusinessEmail(input: {
  clientName: string;
  firmName: string;
  productType: string;
  businessDate: string;
  total: string | number;
  lines: EmailLine[];
  arn?: string | null;
  logoUrl?: string | null;
}): { subject: string; text: string; html: string } {
  const dateStr = new Date(input.businessDate).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
  const product = PRODUCT_LABEL[input.productType] ?? "Investment";
  const subject = `${product} confirmation — ${dateStr}`;

  const rows = input.lines
    .map((l) => {
      const freq = l.frequency ? ` (${l.frequency.replace(/_/g, " ")})` : "";
      const from = l.fromSchemeName ? ` — from ${l.fromSchemeName}` : "";
      return { name: `${l.schemeName}${from}`, type: `${TXN_LABEL[l.txnType] ?? l.txnType}${freq}`, amt: inr(Number(l.amount)) };
    });

  const text = [
    `Dear ${input.clientName},`,
    ``,
    `Thank you for your continued trust. Here is a summary of the ${product} transactions we have processed for you on ${dateStr}:`,
    ``,
    ...rows.map((r) => `• ${r.name} — ${r.type} — ${r.amt}`),
    ``,
    `Total: ${inr(input.total)}`,
    ``,
    `If anything looks incorrect, please reply to this email and we'll fix it right away.`,
    ``,
    `Warm regards,`,
    `${input.firmName}${input.arn ? ` · ARN-${input.arn}` : ""}`,
    ``,
    `Mutual fund investments are subject to market risks. Read all scheme related documents carefully.`,
  ].join("\n");

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#0f172a;">
    ${emailLogoHeaderHtml(input.logoUrl, input.firmName)}
    <p>Dear ${esc(input.clientName)},</p>
    <p>Thank you for your continued trust. Here is a summary of the <strong>${esc(product)}</strong> transactions we have processed for you on <strong>${esc(dateStr)}</strong>:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
      <thead>
        <tr style="background:#f1f5f9;text-align:left;">
          <th style="padding:8px;border-bottom:1px solid #e2e8f0;">Scheme</th>
          <th style="padding:8px;border-bottom:1px solid #e2e8f0;">Type</th>
          <th style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => `<tr>
          <td style="padding:8px;border-bottom:1px solid #f1f5f9;">${esc(r.name)}</td>
          <td style="padding:8px;border-bottom:1px solid #f1f5f9;">${esc(r.type)}</td>
          <td style="padding:8px;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap;">${esc(r.amt)}</td>
        </tr>`).join("")}
        <tr>
          <td colspan="2" style="padding:8px;text-align:right;font-weight:bold;">Total</td>
          <td style="padding:8px;text-align:right;font-weight:bold;white-space:nowrap;">${esc(inr(input.total))}</td>
        </tr>
      </tbody>
    </table>
    <p>If anything looks incorrect, please reply to this email and we'll fix it right away.</p>
    <p style="margin-top:24px;">Warm regards,<br/><strong>${esc(input.firmName)}</strong>${input.arn ? ` · ARN-${esc(input.arn)}` : ""}</p>
    <p style="font-size:11px;color:#64748b;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:12px;">
      Mutual fund investments are subject to market risks. Read all scheme related documents carefully.
    </p>
  </div>`;

  return { subject, text, html };
}
