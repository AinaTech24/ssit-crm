/**
 * Shared letterhead header for all report PDF exports (proposal, portfolio
 * statement, risk profile, goal plan, calculators, …).
 *
 * Consistent layout across every export:
 *   - LEFT:  the firm's logo (from the organisation profile), or a firm-name
 *            fallback when no logo is available.
 *   - RIGHT: the document TITLE, then one or more subtitle lines (date / ref no),
 *            then the ARN — all right-aligned and stacked.
 *   - A brand-colour gradient strip underneath.
 *
 * Returns the Y coordinate where body content should start (just below the
 * gradient strip), so callers can set their cursor from it.
 */

import type { PDFDocument, PDFPage, PDFImage, PDFFont, RGB } from "pdf-lib";
import { rgb } from "pdf-lib";

const INK = rgb(0.09, 0.12, 0.2);
const SLATE = rgb(0.42, 0.47, 0.55);

/** Strip non-WinAnsi characters pdf-lib's standard fonts can't draw. */
function ascii(s: string): string {
  return (s ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/₹/g, "Rs.")
    .replace(/[^\x20-\x7E]/g, "");
}

function drawGradientStrip(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  c1: RGB,
  c2: RGB
): void {
  const seg = 48;
  const sw = w / seg;
  for (let i = 0; i < seg; i++) {
    const t = i / (seg - 1);
    page.drawRectangle({
      x: x + i * sw,
      y,
      width: sw + 0.6,
      height: h,
      color: rgb(
        c1.red + (c2.red - c1.red) * t,
        c1.green + (c2.green - c1.green) * t,
        c1.blue + (c2.blue - c1.blue) * t
      ),
    });
  }
}

export function drawReportHeader(opts: {
  page: PDFPage;
  helv: PDFFont;
  bold: PDFFont;
  pageWidth: number;
  pageHeight: number;
  margin: number;
  /** Embedded logo image, or null to fall back to the firm name. */
  logo: PDFImage | null;
  firmName?: string | null;
  /** Document heading, e.g. "INVESTMENT PROPOSAL". */
  title: string;
  /** Lines under the title (date / reference no), top-to-bottom. */
  subtitles?: (string | null | undefined)[];
  /** ARN number (with or without the "ARN" prefix); rendered last. */
  arn?: string | null;
  primary: RGB;
  secondary: RGB;
}): number {
  const { page, helv, bold, pageWidth: W, pageHeight: H, margin: M, logo, primary, secondary } = opts;
  const usable = W - 2 * M;
  const topY = H - M;
  const xRight = W - M;

  // ── LEFT: logo (or firm-name fallback) ──
  let leftBottom: number;
  if (logo) {
    const maxH = 46;
    const maxW = 215;
    let dw = (logo.width / logo.height) * maxH;
    let dh = maxH;
    if (dw > maxW) {
      dw = maxW;
      dh = (logo.height / logo.width) * maxW;
    }
    page.drawImage(logo, { x: M, y: topY - dh, width: dw, height: dh });
    leftBottom = topY - dh;
  } else {
    page.drawText(ascii(opts.firmName ?? "Your Advisor"), {
      x: M,
      y: topY - 16,
      size: 15,
      font: bold,
      color: INK,
    });
    leftBottom = topY - 28;
  }

  // ── RIGHT: title → subtitles → ARN (right-aligned, stacked) ──
  const titleSize = 13;
  let y = topY - titleSize;
  const titleStr = ascii(opts.title);
  page.drawText(titleStr, {
    x: xRight - bold.widthOfTextAtSize(titleStr, titleSize),
    y,
    size: titleSize,
    font: bold,
    color: primary,
  });
  y -= 16;

  for (const raw of opts.subtitles ?? []) {
    if (!raw) continue;
    const s = ascii(String(raw));
    page.drawText(s, {
      x: xRight - helv.widthOfTextAtSize(s, 9.5),
      y,
      size: 9.5,
      font: helv,
      color: SLATE,
    });
    y -= 13;
  }

  if (opts.arn) {
    const arnStr = ascii(`ARN ${String(opts.arn).replace(/^ARN[-\x3a\s]*/i, "")}`);
    page.drawText(arnStr, {
      x: xRight - helv.widthOfTextAtSize(arnStr, 9.5),
      y,
      size: 9.5,
      font: helv,
      color: SLATE,
    });
    y -= 13;
  }
  const rightBottom = y + 13;

  // ── Gradient strip under the taller column ──
  const stripY = Math.min(leftBottom, rightBottom) - 12;
  drawGradientStrip(page, M, stripY, usable, 4.5, primary, secondary);

  return stripY - 24;
}

/**
 * Slim header for continuation pages (page 2+): firm name on the left, the
 * document title + "(continued)" on the right, and a thin brand rule below.
 * One shared implementation so continuation pages can't drift from the
 * letterhead when it changes. Returns the Y where body content should start.
 */
export function drawContinuationHeader(opts: {
  page: PDFPage;
  helv: PDFFont;
  bold: PDFFont;
  pageWidth: number;
  pageHeight: number;
  margin: number;
  firmName?: string | null;
  /** e.g. "Goal plan (continued)" — pass the base title; "(continued)" is appended. */
  title: string;
  primary: RGB;
}): number {
  const { page, helv, bold, pageWidth: W, pageHeight: H, margin: M, primary } = opts;
  const topY = H - M;
  page.drawText(ascii(opts.firmName ?? ""), { x: M, y: topY - 10, size: 9.5, font: bold, color: INK });
  const t = ascii(`${opts.title} (continued)`);
  page.drawText(t, { x: W - M - helv.widthOfTextAtSize(t, 9), y: topY - 10, size: 9, font: helv, color: SLATE });
  page.drawLine({ start: { x: M, y: topY - 18 }, end: { x: W - M, y: topY - 18 }, thickness: 1, color: primary });
  return topY - 34;
}

/**
 * Post-pass page numbering — call AFTER all content is drawn (the total is
 * unknowable earlier). Draws a centered "Page X of Y" at `y` on every page.
 * Single-page documents are skipped (a "Page 1 of 1" is just noise).
 */
export function drawPageNumbers(doc: PDFDocument, helv: PDFFont, pageWidth: number, y: number): void {
  const pages = doc.getPages();
  if (pages.length < 2) return;
  pages.forEach((p, i) => {
    const s = `Page ${i + 1} of ${pages.length}`;
    p.drawText(s, { x: (pageWidth - helv.widthOfTextAtSize(s, 7.5)) / 2, y, size: 7.5, font: helv, color: SLATE });
  });
}
