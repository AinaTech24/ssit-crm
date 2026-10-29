/**
 * Printable Risk Profile Questionnaire (PDF) — the firm's published questions as
 * a blank form: tick-box options (no scores shown), client details, signature
 * lines. Handed to a client to fill in on paper, then uploaded via the
 * "attach signed form" route.
 *
 * Branded like the completed-profile statement and built the same way (pdf-lib).
 */

import { PDFDocument, rgb, type PDFPage, type RGB } from "pdf-lib";
import { drawReportHeader, drawContinuationHeader, drawPageNumbers } from "@/lib/pdf/report-header";
import { embedPdfFonts, pdfSanitize } from "@/lib/pdf/fonts";
import type { StatementBrand } from "@/lib/finance/valuation-pdf";
import { embedLogo, fmtDate, hexToRgb, wrap } from "./risk-profile-pdf";

export type QuestionnaireForm = {
  name: string;
  description?: string | null;
  versionNumber?: number | null;
  questions: Array<{
    label: string;
    helperText?: string | null;
    options: Array<{ label: string }>;
  }>;
};

const INK: RGB = rgb(0.06, 0.09, 0.16);
const SLATE: RGB = rgb(0.2, 0.255, 0.333);
const MUTED: RGB = rgb(0.58, 0.64, 0.72);
const LINE: RGB = rgb(0.89, 0.91, 0.94);
const RULE: RGB = rgb(0.6, 0.65, 0.72);

const W = 595.28;
const H = 841.89; // A4
const MARGIN = 40;
const FOOTER_TOP = 56;

const DECLARATION =
  "I confirm that the answers above are my own and are given to help my distributor recommend suitable " +
  "investments. Mutual Fund investments are subject to market risks; read all scheme related documents carefully.";

export async function renderQuestionnairePdf(args: {
  form: QuestionnaireForm;
  brand: StatementBrand;
  generatedAt: string;
}): Promise<Buffer> {
  const { form, brand } = args;
  const doc = await PDFDocument.create();
  const { font: helv, bold, rupeeOk } = await embedPdfFonts(doc);
  const clean = (s: string) => pdfSanitize((s ?? "").replace(/·/g, "-"), rupeeOk);
  const primary = hexToRgb(brand.primaryColor);
  const secondary = brand.secondaryColor ? hexToRgb(brand.secondaryColor) : primary;
  const logo = await embedLogo(doc, brand.logoUrl);
  const firm = brand.legalName ?? brand.displayName;
  const contentW = W - 2 * MARGIN;

  doc.setTitle(clean(form.name || "Risk profile questionnaire"));
  doc.setProducer("Equitywala");
  if (firm) doc.setAuthor(clean(firm));

  const arnNo = brand.arn ? String(brand.arn).replace(/^ARN[-\s]*/i, "") : "";
  const footer = (page: PDFPage) => {
    page.drawRectangle({ x: MARGIN, y: 52, width: contentW, height: 1, color: LINE });
    const legal = clean(firm ?? "Your Advisor");
    page.drawText(clean(arnNo ? `${legal}  -  ARN-${arnNo}` : legal), { x: MARGIN, y: 40, size: 8, font: bold, color: SLATE });
    const gen = clean(`Generated ${fmtDate(args.generatedAt)}${form.versionNumber ? ` - Version ${form.versionNumber}` : ""}`);
    page.drawText(gen, { x: W - MARGIN - helv.widthOfTextAtSize(gen, 7.5), y: 40, size: 7.5, font: helv, color: MUTED });
  };

  let page = doc.addPage([W, H]);
  let y = drawReportHeader({
    page, helv, bold, pageWidth: W, pageHeight: H, margin: MARGIN, logo,
    firmName: firm, title: "RISK PROFILE QUESTIONNAIRE",
    subtitles: [clean(form.name || "")].filter(Boolean),
    arn: brand.arn, primary, secondary,
  });

  const ensure = (need: number) => {
    if (y - need < FOOTER_TOP + 10) {
      footer(page);
      page = doc.addPage([W, H]);
      y = drawContinuationHeader({
        page, helv, bold, pageWidth: W, pageHeight: H, margin: MARGIN,
        firmName: firm, title: "Risk profile questionnaire", primary,
      });
    }
  };

  /** "Label ______" — a captioned writing line. */
  const field = (label: string, x: number, width: number) => {
    page.drawText(label, { x, y, size: 8.5, font: bold, color: SLATE });
    const lx = x + bold.widthOfTextAtSize(label, 8.5) + 6;
    page.drawRectangle({ x: lx, y: y - 2, width: x + width - lx, height: 0.7, color: RULE });
  };

  // ── Client details ────────────────────────────────────────────────────
  ensure(80);
  page.drawText("CLIENT DETAILS", { x: MARGIN, y, size: 9, font: bold, color: primary });
  y -= 6;
  page.drawRectangle({ x: MARGIN, y: y - 2, width: contentW, height: 1, color: LINE });
  y -= 20;
  field("Name", MARGIN, contentW * 0.62);
  field("PAN", MARGIN + contentW * 0.66, contentW * 0.34);
  y -= 22;
  field("Date of birth", MARGIN, contentW * 0.4);
  field("Date", MARGIN + contentW * 0.44, contentW * 0.26);
  field("Mobile", MARGIN + contentW * 0.74, contentW * 0.26);
  y -= 30;

  if (form.description) {
    for (const ln of wrap(clean(form.description), helv, 8.5, contentW).slice(0, 3)) {
      page.drawText(ln, { x: MARGIN, y, size: 8.5, font: helv, color: SLATE });
      y -= 11;
    }
    y -= 8;
  }

  ensure(30);
  page.drawText("QUESTIONNAIRE  (tick one answer for each question)", { x: MARGIN, y, size: 9, font: bold, color: primary });
  y -= 6;
  page.drawRectangle({ x: MARGIN, y: y - 2, width: contentW, height: 1, color: LINE });
  y -= 20;

  // ── Questions ─────────────────────────────────────────────────────────
  form.questions.forEach((q, i) => {
    const qLines = wrap(clean(`${i + 1}. ${q.label}`), bold, 9.5, contentW);
    const hLines = q.helperText ? wrap(clean(q.helperText), helv, 8, contentW - 14) : [];
    const optLines = q.options.map((o) => wrap(clean(o.label), helv, 9.5, contentW - 34));
    const optH = optLines.reduce((n, l) => n + l.length * 12 + 4, 0);
    ensure(qLines.length * 13 + hLines.length * 10 + optH + 16);

    for (const ln of qLines) {
      page.drawText(ln, { x: MARGIN, y, size: 9.5, font: bold, color: INK });
      y -= 13;
    }
    for (const ln of hLines) {
      page.drawText(ln, { x: MARGIN + 14, y, size: 8, font: helv, color: MUTED });
      y -= 10;
    }
    y -= 3;
    optLines.forEach((lines) => {
      page.drawRectangle({ x: MARGIN + 14, y: y - 1.5, width: 9, height: 9, borderColor: RULE, borderWidth: 0.9 });
      lines.forEach((ln, k) => {
        page.drawText(ln, { x: MARGIN + 30, y: y - k * 12, size: 9.5, font: helv, color: SLATE });
      });
      y -= lines.length * 12 + 4;
    });
    y -= 8;
  });

  // ── Declaration + signatures ──────────────────────────────────────────
  ensure(110);
  y -= 4;
  page.drawRectangle({ x: MARGIN, y: y + 6, width: contentW, height: 1, color: LINE });
  y -= 10;
  for (const ln of wrap(clean(DECLARATION), helv, 8, contentW)) {
    page.drawText(ln, { x: MARGIN, y, size: 8, font: helv, color: SLATE });
    y -= 10.5;
  }
  y -= 30;
  field("Client signature", MARGIN, contentW * 0.46);
  field("Distributor / RM", MARGIN + contentW * 0.54, contentW * 0.46);

  footer(page);
  drawPageNumbers(doc, helv, W, 8);
  return Buffer.from(await doc.save());
}
