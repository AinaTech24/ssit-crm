/**
 * calc-pdf — render a professional A4 calculator report (single calculator) OR a
 * combined multi-calculator client report, from captured inputs + result blocks.
 * Built with pdf-lib (Node runtime). Used by the calculator Download / Email /
 * WhatsApp paths, the "combined report" tray, and the client Wealth Story.
 *
 * Every page carries the firm header band (page 1) and a footer band (firm
 * disclaimer + "Page X of Y") on every page. Content flows strictly between the
 * bands; long tables paginate and repeat their header; charts never split.
 * A combined report adds a cover (title + client/advisor + contents list) and
 * starts each calculator on its own page with a numbered heading.
 *
 * The visual language is theme-aware: every accent derives from the tenant's
 * `primaryHex` (with luminance-picked on-colour text so a light OR dark brand
 * colour both read cleanly), so the report always looks like the firm's own.
 */

import { PDFDocument, rgb, type RGB, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";
import { embedPdfFonts } from "@/lib/pdf/fonts";

export type PdfBlock =
  | { type: "stat"; label: string; value: string }
  | { type: "section"; text: string }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "insight"; text: string }
  | { type: "image"; dataUrl: string; w?: number; h?: number };

/** Firm + client branding common to single and combined reports. */
type ReportCommon = {
  firmName: string;
  arn?: string | null;
  preparedBy?: string | null;
  firmPhone?: string | null;
  firmEmail?: string | null;
  firmWebsite?: string | null;
  clientName?: string | null;
  clientEmail?: string | null;
  clientMobile?: string | null;
  logoBytes?: Uint8Array | null;
  primaryHex?: string | null;
  generatedAt?: string | null;
};

/** One calculator's captured payload. */
export type CalcItem = {
  calcName: string;
  inputs?: { label: string; value: string; group?: string }[];
  blocks: PdfBlock[];
};

export type CalcPdfInput = ReportCommon & {
  calcName: string;
  inputs?: { label: string; value: string; group?: string }[];
  blocks: PdfBlock[];
};

export type CombinedCalcPdfInput = ReportCommon & {
  reportTitle?: string | null;
  items: CalcItem[];
};

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 42;
const HEADER_H = 88;
const FOOTER_H = 52;

/** Normalise text for PDF drawing. keepRupee=true preserves ₹ (only safe when a
 *  Unicode font is embedded); otherwise ₹ → "Rs " and all non-ASCII is stripped
 *  so the built-in Helvetica fallback never fails to encode a glyph. */
const sanitize = (s: string, keepRupee = false) => {
  let t = (s ?? "")
    .replace(/[•·]/g, "-")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
  t = keepRupee ? t.replace(/[^\x20-\x7E₹]/g, "") : t.replace(/₹/g, "Rs ").replace(/[^\x20-\x7E]/g, "");
  return t.replace(/\s+/g, " ").trim();
};
const ascii = (s: string) => sanitize(s, false);

function hexToRgb(hex?: string | null) {
  const h = (hex ?? "#841f21").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  if (!Number.isFinite(n)) return rgb(0.06, 0.09, 0.16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
/** Relative luminance — decides white vs ink text on a coloured fill. */
const lum = (c: RGB) => 0.2126 * c.red + 0.7152 * c.green + 0.0722 * c.blue;
/** Lighten a colour toward white by fraction t (0 = colour, 1 = white). */
const toward = (c: RGB, t: number) => rgb(c.red + (1 - c.red) * t, c.green + (1 - c.green) * t, c.blue + (1 - c.blue) * t);

function clip(text: string, font: PDFFont, size: number, maxWidth: number, keepRupee = false): string {
  let s = sanitize(text, keepRupee);
  if (font.widthOfTextAtSize(s, size) <= maxWidth) return s;
  while (s.length > 1 && font.widthOfTextAtSize(s + "...", size) > maxWidth) s = s.slice(0, -1);
  return s + "...";
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number, keepRupee = false): string[] {
  const words = sanitize(text, keepRupee).split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

const DISCLAIMER =
  "This report is for illustration purposes only and is not a guarantee of returns. " +
  "Calculations are based on the inputs and assumptions provided. Mutual fund investments are " +
  "subject to market risks; read all scheme related documents carefully.";

/** Shared renderer for single + combined reports. */
async function renderReport(
  c: ReportCommon,
  items: CalcItem[],
  opts: { title: string; ctxLabel: string; combined: boolean }
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  // Shared Unicode font embed (DejaVu Sans) so ₹ renders as a real glyph, with
  // a built-in Helvetica fallback (₹ → "Rs ") if font files can't be read.
  const { font, bold, rupeeOk } = await embedPdfFonts(doc);

  // ── Theme palette (all derived from the firm's brand colour) ──
  const primary = hexToRgb(c.primaryHex);
  const onPrimary = lum(primary) > 0.62 ? rgb(0.12, 0.15, 0.2) : rgb(1, 1, 1);          // text on a primary fill
  const onPrimaryDim = lum(primary) > 0.62 ? rgb(0.35, 0.39, 0.45) : rgb(0.86, 0.89, 0.95); // secondary text on primary
  const primarySoft = toward(primary, 0.9);   // very light tint — card / header fills
  const primaryTint = toward(primary, 0.82);  // light tint — table header fill
  const primaryEdge = toward(primary, 0.55);  // card borders
  const ink = rgb(0.11, 0.14, 0.19);
  const slate = rgb(0.42, 0.47, 0.55);
  const line = rgb(0.86, 0.88, 0.91);
  const zebra = rgb(0.975, 0.982, 0.99);
  const positive = rgb(0.11, 0.55, 0.33);
  const positiveBg = rgb(0.94, 0.98, 0.955);
  const positiveEdge = rgb(0.78, 0.91, 0.83);
  const positiveInk = rgb(0.06, 0.28, 0.16);

  let logo: PDFImage | null = null;
  if (c.logoBytes && c.logoBytes.length) {
    try { logo = await doc.embedPng(c.logoBytes); }
    catch { try { logo = await doc.embedJpg(c.logoBytes); } catch { logo = null; } }
  }

  doc.setTitle(ascii(`${opts.title} - ${c.clientName || "Client"} - ${c.firmName}`));
  doc.setProducer("Equitywala");

  const W = A4[0], H = A4[1];
  const contentW = W - MARGIN * 2;
  const TOP1 = H - HEADER_H;
  const TOP2 = H - MARGIN;
  const BOTTOM = FOOTER_H;
  const fullPageH = TOP2 - BOTTOM;

  let page: PDFPage = doc.addPage(A4);
  let y = TOP1;

  const newPage = () => { page = doc.addPage(A4); y = TOP2; };
  const need = (h: number) => { if (y - h < BOTTOM) newPage(); };
  const keepTogether = (h: number) => { if (h <= fullPageH && y - h < BOTTOM) newPage(); };
  const estTableHeight = (head: string[], rows: string[][]) => (head.length ? 24 : 0) + rows.length * 16 + 10;
  const drawRight = (p: PDFPage, t: string, xRight: number, yy: number, size: number, f: PDFFont, col: RGB = ink) => {
    const s = ascii(t);
    p.drawText(s, { x: xRight - f.widthOfTextAtSize(s, size), y: yy, size, font: f, color: col });
  };
  const kvLines = (pairs: [string, string][], x: number, startY: number, colW: number) => {
    let yy = startY;
    for (const [k, v] of pairs) {
      if (!v) continue;
      const label = ascii(k).toUpperCase();
      page.drawText(label, { x, y: yy, size: 7, font: bold, color: slate });
      const kW = bold.widthOfTextAtSize(label + "   ", 7);
      page.drawText(clip(v, font, 9, colW - kW), { x: x + kW, y: yy - 0.3, size: 9, font, color: ink });
      yy -= 14;
    }
    return yy;
  };

  // ── content drawers ──
  const sectionHead = (text: string) => {
    need(30);
    y -= 8;
    page.drawRectangle({ x: MARGIN, y: y - 13, width: 3.5, height: 15, color: primary });
    page.drawText(ascii(text), { x: MARGIN + 12, y: y - 11, size: 12, font: bold, color: ink });
    page.drawLine({ start: { x: MARGIN, y: y - 19 }, end: { x: W - MARGIN, y: y - 19 }, thickness: 0.6, color: line });
    y -= 25;
  };
  // Combined-report per-calculator banner (filled bar) — always starts a page.
  const itemHeading = (n: number, name: string) => {
    page.drawRectangle({ x: MARGIN, y: y - 28, width: contentW, height: 28, color: primary });
    page.drawRectangle({ x: MARGIN, y: y - 28, width: 4, height: 28, color: onPrimary });
    page.drawText(ascii(`${n}. ${name}`), { x: MARGIN + 14, y: y - 19, size: 13, font: bold, color: onPrimary });
    y -= 40;
  };
  const drawStats = (group: { label: string; value: string }[]) => {
    // 1-2 stats go full-width / 2-up (bigger, more impactful); 4 → 2x2; else 3-up.
    const cols = group.length <= 2 ? Math.max(group.length, 1) : group.length === 4 ? 2 : 3;
    const gap = 10;
    const cw = (contentW - gap * (cols - 1)) / cols;
    const ch = 50;
    for (let g = 0; g < group.length; g += cols) {
      need(ch + 10);
      const row = group.slice(g, g + cols);
      row.forEach((s, col) => {
        const x = MARGIN + col * (cw + gap);
        page.drawRectangle({ x, y: y - ch, width: cw, height: ch, color: primarySoft, borderColor: primaryEdge, borderWidth: 0.8 });
        page.drawRectangle({ x, y: y - 3, width: cw, height: 3, color: primary }); // top accent
        page.drawText(clip(s.label.toUpperCase(), bold, 7, cw - 22), { x: x + 12, y: y - 19, size: 7, font: bold, color: slate });
        page.drawText(clip(s.value, bold, 16, cw - 22, rupeeOk), { x: x + 12, y: y - 39, size: 16, font: bold, color: primary });
      });
      y -= ch + 10;
    }
  };
  const drawTable = (head: string[], rows: string[][]) => {
    const ncol = Math.max(head.length, ...rows.map((r) => r.length), 1);
    const weights = Array.from({ length: ncol }, (_, i) => (i === 0 ? (ncol <= 3 ? 1.6 : 1.15) : 1));
    const wsum = weights.reduce((a, b) => a + b, 0);
    const colX: number[] = [];
    let acc = MARGIN;
    const colW2 = weights.map((w) => (w / wsum) * contentW);
    colW2.forEach((w) => { colX.push(acc); acc += w; });
    const cellPad = 8;
    const rowH = 16;
    const bSize = 8.5;
    const hSize = 7.5;
    const headLines = head.map((h, col) => wrap(h, bold, hSize, colW2[col] - cellPad * 2, rupeeOk).slice(0, 2));
    const headH = head.length ? Math.max(23, Math.max(1, ...headLines.map((l) => l.length)) * 9 + 7) : 0;
    keepTogether(headH + rows.length * rowH + 10);
    const drawHeader = () => {
      need(headH + 4);
      page.drawRectangle({ x: MARGIN, y: y - headH, width: contentW, height: headH, color: primaryTint });
      headLines.forEach((lines, col) => {
        const leftAlign = col === 0;
        lines.forEach((s, li) => {
          const tx = leftAlign ? colX[col] + cellPad : colX[col] + colW2[col] - cellPad - bold.widthOfTextAtSize(s, hSize);
          page.drawText(s, { x: tx, y: y - 12 - li * 9, size: hSize, font: bold, color: primary });
        });
      });
      y -= headH;
    };
    if (head.length) drawHeader();
    rows.forEach((row, ri) => {
      if (y - rowH < BOTTOM) { newPage(); if (head.length) drawHeader(); }
      if (ri % 2 === 1) page.drawRectangle({ x: MARGIN, y: y - rowH, width: contentW, height: rowH, color: zebra });
      for (let col = 0; col < ncol; col++) {
        const cell = row[col] ?? "";
        const leftAlign = col === 0;
        const cellFont = leftAlign ? font : bold; // numbers (right cols) get weight
        const s = clip(cell, cellFont, bSize, colW2[col] - cellPad * 2, rupeeOk);
        const tx = leftAlign ? colX[col] + cellPad : colX[col] + colW2[col] - cellPad - cellFont.widthOfTextAtSize(s, bSize);
        page.drawText(s, { x: tx, y: y - 12, size: bSize, font: cellFont, color: leftAlign ? ink : ink });
      }
      page.drawLine({ start: { x: MARGIN, y: y - rowH }, end: { x: W - MARGIN, y: y - rowH }, thickness: 0.3, color: line });
      y -= rowH;
    });
    y -= 8;
  };
  const drawInsight = (text: string) => {
    const lines = wrap(text, font, 9, contentW - 34, rupeeOk);
    const ih = lines.length * 12 + 16;
    need(ih + 8);
    page.drawRectangle({ x: MARGIN, y: y - ih, width: contentW, height: ih, color: positiveBg, borderColor: positiveEdge, borderWidth: 0.8 });
    page.drawRectangle({ x: MARGIN, y: y - ih, width: 3, height: ih, color: positive });
    // small check bullet
    page.drawText(ascii("+"), { x: MARGIN + 12, y: y - 16, size: 11, font: bold, color: positive });
    lines.forEach((ln, k) => page.drawText(ln, { x: MARGIN + 24, y: y - 16 - k * 12, size: 9, font, color: positiveInk }));
    y -= ih + 10;
  };
  const drawInputs = (inputs: { label: string; value: string; group?: string }[]) => {
    sectionHead("Input Details");
    const order: string[] = [];
    const byGroup = new Map<string, { label: string; value: string }[]>();
    for (const it of inputs) {
      const g = it.group || "";
      if (!byGroup.has(g)) { byGroup.set(g, []); order.push(g); }
      byGroup.get(g)!.push(it);
    }
    for (const g of order) {
      const gRows = byGroup.get(g)!.map((i) => [i.label, i.value]);
      if (g) {
        keepTogether(18 + Math.min(estTableHeight(["Field", "Value"], gRows), fullPageH - 18));
        page.drawText(ascii(g), { x: MARGIN, y: y - 10, size: 9, font: bold, color: primary });
        y -= 18;
      }
      drawTable(["Field", "Value"], gRows);
    }
  };
  const drawBlocks = async (blocks: PdfBlock[]) => {
    let resultsHeaderDrawn = false;
    let i = 0;
    while (i < blocks.length) {
      const b = blocks[i];
      if (b.type === "stat") {
        if (!resultsHeaderDrawn) { sectionHead("Results & Summary"); resultsHeaderDrawn = true; }
        const group: { label: string; value: string }[] = [];
        while (i < blocks.length && blocks[i].type === "stat") {
          const s = blocks[i] as Extract<PdfBlock, { type: "stat" }>;
          group.push({ label: s.label, value: s.value });
          i++;
        }
        drawStats(group);
        continue;
      }
      if (b.type === "section") {
        const next = blocks[i + 1];
        let withH = 24;
        if (next?.type === "table") withH += estTableHeight(next.head, next.rows);
        else if (next?.type === "stat") withH += 56;
        keepTogether(Math.min(withH, fullPageH));
        sectionHead(b.text); i++; continue;
      }
      if (b.type === "table") { drawTable(b.head, b.rows); i++; continue; }
      if (b.type === "insight") { drawInsight(b.text); i++; continue; }
      if (b.type === "image") {
        try {
          const b64 = (b.dataUrl.split(",")[1] || "");
          if (b64) {
            const png = await doc.embedPng(Buffer.from(b64, "base64"));
            let w = contentW;
            let h = (png.height / png.width) * contentW;
            const maxH = fullPageH - 16;
            if (h > maxH) { const s = maxH / h; w *= s; h *= s; }
            keepTogether(h + 10);
            page.drawImage(png, { x: MARGIN + (contentW - w) / 2, y: y - h, width: w, height: h });
            y -= h + 10;
          }
        } catch { /* skip an unembeddable image */ }
        i++; continue;
      }
      i++;
    }
  };

  // ════════════════ COVER / PAGE 1 ════════════════
  // Full-bleed primary hero band — the report's title + who it's for.
  const titleBandH = 49;
  need(titleBandH + 8);
  page.drawRectangle({ x: 0, y: y - titleBandH, width: W, height: titleBandH, color: primary });
  page.drawRectangle({ x: 0, y: y - titleBandH, width: 5, height: titleBandH, color: onPrimary }); // left accent edge
  const genDate = c.generatedAt || new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  page.drawText(clip(opts.title, bold, 20, contentW - 150), { x: MARGIN + 6, y: y - 26, size: 20, font: bold, color: onPrimary });
  const heroSub = c.clientName ? `Prepared for ${c.clientName}` : "Personalised illustration";
  page.drawText(clip(heroSub, font, 9.5, contentW - 150), { x: MARGIN + 6, y: y - 41, size: 9.5, font, color: onPrimaryDim });
  drawRight(page, genDate, W - MARGIN - 4, y - 24, 9.5, bold, onPrimary);
  drawRight(page, "ILLUSTRATION", W - MARGIN - 4, y - 40, 7, bold, onPrimaryDim);
  y -= titleBandH + 15;

  const advisorPairs: [string, string][] = [
    ["Firm", c.firmName],
    ["Advisor", c.preparedBy || ""],
    ["ARN", (c.arn || "").replace(/^ARN[-\s]*/i, "")],
  ];
  const clientPairs: [string, string][] = [
    ["Name", c.clientName || "-"],
    ["Report date", genDate],
  ];
  const boxRows = Math.max(advisorPairs.filter((p) => p[1]).length, clientPairs.filter((p) => p[1]).length);
  const boxH = 26 + boxRows * 14;
  need(boxH + 12);
  page.drawRectangle({ x: MARGIN, y: y - boxH, width: contentW, height: boxH, borderColor: line, borderWidth: 1, color: rgb(0.988, 0.992, 0.997) });
  const colW = (contentW - 24) / 2;
  const midX = MARGIN + 12 + colW + 6;
  page.drawLine({ start: { x: midX, y: y - 12 }, end: { x: midX, y: y - boxH + 12 }, thickness: 0.6, color: line }); // column divider
  page.drawText("ADVISOR", { x: MARGIN + 12, y: y - 15, size: 8, font: bold, color: primary });
  page.drawText("CLIENT", { x: midX + 12, y: y - 15, size: 8, font: bold, color: primary });
  kvLines(advisorPairs, MARGIN + 12, y - 32, colW - 12);
  kvLines(clientPairs, midX + 12, y - 32, colW - 12);
  y -= boxH + 15;

  // Combined: contents list on the cover.
  if (opts.combined && items.length > 1) {
    sectionHead("Included in this report");
    drawTable(["#", "Calculator"], items.map((it, i) => [String(i + 1), it.calcName]));
  }

  // ════════════════ EACH CALCULATOR ════════════════
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    if (opts.combined) { newPage(); itemHeading(idx + 1, item.calcName); }
    if (item.inputs && item.inputs.length) drawInputs(item.inputs);
    await drawBlocks(item.blocks);
  }

  // ════════════════ NOTES (once) ════════════════
  need(44);
  sectionHead("Notes & Assumptions");
  wrap(
    "All figures are projections based on the inputs above and the stated rate of return, which is not assured. " +
      "Actual results will vary with market performance, fund selection, costs and taxes.",
    font, 8.5, contentW
  ).forEach((ln) => { page.drawText(ln, { x: MARGIN, y: y - 4, size: 8.5, font, color: slate }); y -= 12; });

  // ════════════════ HEADER + FOOTER ════════════════
  const dt = c.generatedAt || new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  const ruleY = H - 56;
  const pages = doc.getPages();
  pages.forEach((p, idx) => {
    if (idx === 0) {
      const contact = [c.firmPhone, c.firmEmail, c.firmWebsite].map((s) => ascii(s ?? "")).filter(Boolean).join("   ·   ").replace(/·/g, "-");
      if (logo) {
        const boxW = 175, boxH2 = 38;
        const scale = Math.min(boxW / logo.width, boxH2 / logo.height);
        p.drawImage(logo, { x: MARGIN, y: H - 20 - logo.height * scale, width: logo.width * scale, height: logo.height * scale });
      } else {
        p.drawText(ascii(c.firmName), { x: MARGIN, y: H - 32, size: 15, font: bold, color: ink });
      }
      if (contact) p.drawText(clip(contact, font, 7.5, contentW - 130), { x: MARGIN, y: H - (logo ? 60 : 46), size: 7.5, font, color: slate });
      // ARN pill, right-aligned.
      const arnTxt = ascii(c.arn ?? "");
      if (arnTxt) {
        const aw = bold.widthOfTextAtSize(arnTxt, 8.5) + 18;
        p.drawRectangle({ x: W - MARGIN - aw, y: H - 32, width: aw, height: 17, color: primaryTint });
        p.drawText(arnTxt, { x: W - MARGIN - aw + 9, y: H - 27.5, size: 8.5, font: bold, color: primary });
      }
      drawRight(p, `Generated ${dt}`, W - MARGIN, H - 44, 7.5, font, slate);
      p.drawLine({ start: { x: MARGIN, y: ruleY }, end: { x: W - MARGIN, y: ruleY }, thickness: 2, color: primary });
    }
    p.drawLine({ start: { x: MARGIN, y: FOOTER_H - 2 }, end: { x: W - MARGIN, y: FOOTER_H - 2 }, thickness: 0.6, color: line });
    p.drawText(clip(c.firmName, bold, 7.5, contentW / 2), { x: MARGIN, y: FOOTER_H - 14, size: 7.5, font: bold, color: primary });
    drawRight(p, `Page ${idx + 1} of ${pages.length}`, W - MARGIN, FOOTER_H - 14, 7.5, bold, slate);
    wrap(DISCLAIMER, font, 6.5, contentW).slice(0, 2).forEach((ln, k) =>
      p.drawText(ln, { x: MARGIN, y: FOOTER_H - 24 - k * 8, size: 6.5, font, color: slate })
    );
  });

  return Buffer.from(await doc.save());
}

/** Single-calculator report (Download / Email / WhatsApp). */
export async function renderCalcPdf(input: CalcPdfInput): Promise<Buffer> {
  return renderReport(
    input,
    [{ calcName: input.calcName, inputs: input.inputs, blocks: input.blocks }],
    {
      title: `${input.calcName} Report`,
      ctxLabel: `${input.calcName} Report` + (input.clientName ? `  -  ${input.clientName}` : ""),
      combined: false,
    }
  );
}

/** Combined multi-calculator client report (the report tray). */
export async function renderCombinedCalcPdf(input: CombinedCalcPdfInput): Promise<Buffer> {
  const title = input.reportTitle || `${input.clientName ? input.clientName + " - " : ""}Financial Plan`;
  const ctxLabel = title + (input.clientName && !title.includes(input.clientName) ? `  -  ${input.clientName}` : "");
  return renderReport(input, input.items, { title, ctxLabel, combined: true });
}
