/**
 * Server-rendered portfolio valuation statement (PDF).
 *
 * Builds an emailable/printable MULTI-PAGE statement from the LIVE valuation
 * engine (valueInvestor + AMFI NAV) — not the stale stored figures. Pure
 * pdf-lib, no native deps / no headless Chrome. Returns a Buffer the API route
 * streams as application/pdf or attaches to an email.
 *
 * SEBI hygiene: every page carries the firm name + ARN + the standard market-
 * risk disclaimer, plus "Page X of Y" when the statement spans pages. A
 * Unicode font (DejaVu) is embedded so amounts render with a real ₹ glyph;
 * if the font can't load we fall back to Helvetica and "Rs ".
 */

import { PDFDocument, rgb, type PDFFont, type PDFPage, type PDFImage, type RGB } from "pdf-lib";
import { drawReportHeader, drawContinuationHeader, drawPageNumbers } from "@/lib/pdf/report-header";
import { embedPdfFonts, pdfSanitize } from "@/lib/pdf/fonts";
import type { InvestorValuation } from "./valuation";

export type StatementInvestor = {
  name: string | null;
  pan: string | null;
  clientCode?: string | null;
};

export type StatementBrand = {
  displayName?: string | null;
  legalName?: string | null;
  arn?: string | null;
  euin?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  logoUrl?: string | null;
  gstNumber?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
};

const ACCENT: RGB = rgb(0.055, 0.647, 0.914);
const INK: RGB = rgb(0.06, 0.09, 0.16);
const SLATE: RGB = rgb(0.2, 0.255, 0.333);
const MUTED: RGB = rgb(0.58, 0.64, 0.72);
const GREEN: RGB = rgb(0.02, 0.6, 0.41);
const RED: RGB = rgb(0.86, 0.15, 0.15);
const DEFAULT_PRIMARY: RGB = rgb(0.055, 0.145, 0.341);
const LINE: RGB = rgb(0.89, 0.91, 0.94);

const DISCLAIMER =
  "Mutual Fund investments are subject to market risks. Read all scheme related documents carefully. " +
  "Valuation is computed from recorded transactions priced at the latest available NAV and is indicative.";
// Fee transparency (CS8): MFDs earn trail from the AMC, embedded in the scheme
// expense ratio — clients pay no separate advisory fee. Stating it builds trust.
const FEE_NOTE =
  "Fee transparency: you hold Regular-plan units. We are compensated via trail commission paid by the AMC, " +
  "embedded in the scheme's expense ratio — no separate advisory fee is charged to you.";

export type RenderStatementArgs = {
  valuation: InvestorValuation;
  investor: StatementInvestor;
  brand: StatementBrand;
  /** ISO date the statement was generated (injected for determinism). */
  generatedAt: string;
  /** Audit reference (record id) — printed in the footer as "Ref XXXXXXXX". */
  refId?: string | null;
};

export async function renderValuationStatementPdf(args: RenderStatementArgs): Promise<Buffer> {
  const { valuation: v, investor, brand } = args;
  const doc = await PDFDocument.create();
  const { font: helv, bold, rupeeOk } = await embedPdfFonts(doc);
  const san = (s: string) => pdfSanitize(s, rupeeOk);
  const rupee = rupeeOk ? "₹" : "Rs ";
  const primary = hexToRgb(brand.primaryColor);
  const secondary = brand.secondaryColor ? hexToRgb(brand.secondaryColor) : ACCENT;

  doc.setTitle(ascii(`Portfolio statement — ${investor.name ?? "Client"}`));
  doc.setProducer("Equitywala");
  if (brand.legalName || brand.displayName) doc.setAuthor(ascii(brand.legalName ?? brand.displayName ?? ""));

  let page = doc.addPage([595.28, 841.89]); // A4
  const W = page.getWidth();
  const H = page.getHeight();
  const margin = 40;
  const BOTTOM = 110; // content floor — leaves room for the footer band
  let y = H;

  // Multi-page: when content reaches the floor, start a fresh page with the
  // shared slim continuation header (footers are stamped in a post-pass).
  const newPage = () => {
    page = doc.addPage([595.28, 841.89]);
    y = drawContinuationHeader({
      page, helv, bold, pageWidth: W, pageHeight: H, margin,
      firmName: brand.legalName ?? brand.displayName,
      title: "Portfolio statement",
      primary,
    });
  };
  const ensure = (need: number) => { if (y - need < BOTTOM) newPage(); };

  // ── Branded letterhead — the LOGO is the brand identity (no firm-name text
  //    when a logo is present), + ARN, + a gradient strip in the firm's own
  //    theme colours (primary → secondary). ───────────────────────────────
  const logo = await embedLogo(doc, brand.logoUrl);
  y = drawReportHeader({
    page,
    helv,
    bold,
    pageWidth: W,
    pageHeight: H,
    margin,
    logo,
    firmName: brand.legalName ?? brand.displayName,
    title: "PORTFOLIO STATEMENT",
    subtitles: [`As of ${fmtDate(v.asOf ?? args.generatedAt)}`],
    arn: brand.arn,
    primary,
    secondary,
  });

  // ── Client line ───────────────────────────────────────────────────────
  page.drawText(ascii(investor.name ?? "Client"), { x: margin, y, size: 15, font: bold, color: INK });
  const idBits = [
    investor.pan ? `PAN ${investor.pan}` : null,
    investor.clientCode ? `Code ${investor.clientCode}` : null,
  ].filter(Boolean).join("   ·   ");
  if (idBits) page.drawText(ascii(idBits), { x: margin, y: y - 16, size: 9.5, font: helv, color: SLATE });
  y -= 44;

  // ── Summary cards ─────────────────────────────────────────────────────
  const money = (n: number | null | undefined) =>
    n == null || !isFinite(n) ? `${rupee}0` : rupee + Math.round(n).toLocaleString("en-IN");
  const gainPositive = (v.gain ?? 0) >= 0;
  const cards: Array<{ label: string; value: string; tone?: RGB }> = [
    { label: "Current value", value: money(v.currentValue) },
    { label: "Net invested", value: money(v.pricedInvested) },
    { label: "Total gain", value: `${gainPositive ? "+" : ""}${money(v.gain)}`, tone: gainPositive ? GREEN : RED },
    {
      label: "Absolute return",
      value: v.absoluteReturn != null ? pct(v.absoluteReturn) : "—",
      tone: (v.absoluteReturn ?? 0) >= 0 ? GREEN : RED,
    },
    {
      label: "XIRR (p.a.)",
      value: v.xirr != null ? pct(v.xirr) : "—",
      tone: (v.xirr ?? 0) >= 0 ? GREEN : RED,
    },
  ];
  const gap = 10;
  const cardW = (W - 2 * margin - gap * (cards.length - 1)) / cards.length;
  const cardH = 54;
  cards.forEach((c, i) => {
    const x = margin + i * (cardW + gap);
    page.drawRectangle({ x, y: y - cardH, width: cardW, height: cardH, color: rgb(0.97, 0.98, 0.99), borderColor: LINE, borderWidth: 1 });
    page.drawText(ascii(c.label).toUpperCase(), { x: x + 8, y: y - 16, size: 6.6, font: bold, color: MUTED });
    const vs = fitText(san(c.value), bold, 12, cardW - 14, 8);
    page.drawText(san(c.value), { x: x + 8, y: y - 38, size: vs, font: bold, color: c.tone ?? INK });
  });
  y -= cardH + 30;

  // ── Holdings table ────────────────────────────────────────────────────
  page.drawText("HOLDINGS", { x: margin, y, size: 9, font: bold, color: primary });
  y -= 6;
  page.drawRectangle({ x: margin, y: y - 2, width: W - 2 * margin, height: 1, color: LINE });
  y -= 16;

  // Column layout
  const colScheme = margin;
  const colUnits = margin + 250;
  const colNav = margin + 330;
  const colVal = W - margin;
  const drawColHeaders = () => {
    const header = (t: string, x: number, right = false) => {
      const size = 7.5;
      const tw = right ? helv.widthOfTextAtSize(t, size) : 0;
      page.drawText(t, { x: right ? x - tw : x, y, size, font: bold, color: MUTED });
    };
    header("SCHEME", colScheme);
    header("UNITS", colUnits, true);
    header("NAV", colNav, true);
    header("VALUE", colVal, true);
    y -= 14;
  };
  drawColHeaders();

  // EVERY priced holding is rendered — the statement paginates instead of
  // silently dropping rows (a 20-folio client gets a complete statement).
  const priced = v.holdings.filter((h) => h.priced && (h.currentValue ?? 0) > 0);
  const rows = priced.length ? priced : v.holdings;
  for (const h of rows) {
    if (y - 16 < BOTTOM) { newPage(); drawColHeaders(); }
    const name = san(h.schemeName ?? h.schemeCode ?? "—");
    page.drawText(truncate(name, helv, 9, colUnits - colScheme - 12), { x: colScheme, y, size: 9, font: helv, color: INK });
    drawRight(page, helv, num(h.netUnits, 3), colUnits, y, 8.5, SLATE);
    drawRight(page, helv, h.latestNav != null ? num(h.latestNav, 2) : "—", colNav, y, 8.5, SLATE);
    drawRight(page, bold, h.currentValue != null ? san(money(h.currentValue)) : "—", colVal, y, 9, INK);
    y -= 16;
  }

  if (v.unpricedSchemes > 0) {
    ensure(20);
    y -= 4;
    page.drawText(
      ascii(`Note: ${v.unpricedSchemes} holding(s) could not be priced against a live NAV and are excluded from the value/return above.`),
      { x: margin, y, size: 7.5, font: helv, color: MUTED }
    );
    y -= 14;
  }

  // ── Per-page furniture (post-pass, once the page count is final) ──────
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    // Fee-transparency line — last page only, just above the footer band.
    if (i === pages.length - 1) {
      let fy = 74;
      p.drawText("FEE TRANSPARENCY", { x: margin, y: fy + 12, size: 6.4, font: bold, color: MUTED });
      for (const line of wrap(FEE_NOTE, helv, 7, W - 2 * margin).slice(0, 2)) {
        p.drawText(line, { x: margin, y: fy, size: 7, font: helv, color: SLATE });
        fy -= 9;
      }
    }
    drawFooter(p, { helv, bold, brand, primary, generatedAt: args.generatedAt, margin, refId: args.refId });
  });
  drawPageNumbers(doc, helv, W, 8);
  if (args.refId) doc.setSubject(`Ref ${String(args.refId).slice(0, 8)}`);

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

/* ───────────────────────── helpers ───────────────────────── */

function drawFooter(
  page: PDFPage,
  a: { helv: PDFFont; bold: PDFFont; brand: StatementBrand; primary: RGB; generatedAt: string; margin?: number; refId?: string | null }
) {
  const W = page.getWidth();
  const margin = a.margin ?? 40;
  // Thin top rule (matches the proposal footer; no filled band).
  page.drawRectangle({ x: margin, y: 52, width: W - 2 * margin, height: 1, color: LINE });
  const legal = ascii(a.brand.legalName ?? a.brand.displayName ?? "Your Advisor");
  const arn = ascii(`ARN-${(a.brand.arn ?? "—").toString().replace(/^ARN-?/i, "")}`);
  page.drawText(`${legal}  -  ${arn}`, { x: margin, y: 40, size: 8, font: a.bold, color: SLATE });
  const gen = ascii(
    `Generated ${fmtDateTime(a.generatedAt)}${a.refId ? ` - Ref ${String(a.refId).slice(0, 8).toUpperCase()}` : ""}`
  );
  const gw = a.helv.widthOfTextAtSize(gen, 7.5);
  page.drawText(gen, { x: W - margin - gw, y: 40, size: 7.5, font: a.helv, color: MUTED });
  let dy = 26;
  for (const line of wrap(DISCLAIMER, a.helv, 7, W - 2 * margin).slice(0, 2)) {
    page.drawText(line, { x: margin, y: dy, size: 7, font: a.helv, color: MUTED });
    dy -= 9;
  }
}

function drawRight(page: PDFPage, font: PDFFont, t: string, x: number, y: number, size: number, color: RGB) {
  const w = font.widthOfTextAtSize(t, size);
  page.drawText(t, { x: x - w, y, size, font, color });
}

/** Resolve a possibly-relative logo URL against the app origin. */
function absUrl(url: string): string {
  if (/^(https?:|data:)/i.test(url)) return url;
  const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "").replace(/\/+$/, "");
  if (!base) return url;
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** Fetch + embed the firm logo (PNG/JPG). Returns null on any failure so the
 *  statement still renders (just without the logo). */
async function embedLogo(doc: PDFDocument, rawUrl?: string | null): Promise<PDFImage | null> {
  if (!rawUrl) return null;
  try {
    const url = absUrl(rawUrl);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (ct.includes("png") || /\.png(\?|$)/i.test(url)) return await doc.embedPng(bytes);
    if (ct.includes("jpeg") || ct.includes("jpg") || /\.jpe?g(\?|$)/i.test(url)) return await doc.embedJpg(bytes);
    try { return await doc.embedPng(bytes); } catch { /* not png */ }
    try { return await doc.embedJpg(bytes); } catch { /* not jpg */ }
    return null;
  } catch {
    return null;
  }
}

/** Horizontal gradient bar (primary → accent) — pdf-lib has no native gradient. */
function drawGradientStrip(page: PDFPage, x: number, y: number, w: number, h: number, c1: RGB, c2: RGB) {
  const segs = 48;
  const sw = w / segs;
  for (let i = 0; i < segs; i++) {
    const t = i / (segs - 1);
    const col = rgb(
      c1.red + (c2.red - c1.red) * t,
      c1.green + (c2.green - c1.green) * t,
      c1.blue + (c2.blue - c1.blue) * t
    );
    page.drawRectangle({ x: x + i * sw, y, width: sw + 0.6, height: h, color: col });
  }
}

function num(n: number | null | undefined, dp: number): string {
  if (n == null || !isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function pct(dec: number): string {
  return `${dec >= 0 ? "+" : ""}${(dec * 100).toFixed(2)}%`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fitText(text: string, font: PDFFont, size: number, maxWidth: number, min: number): number {
  let s = size;
  while (s > min && font.widthOfTextAtSize(text, s) > maxWidth) s -= 0.5;
  return s;
}
function truncate(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > maxWidth) t = t.slice(0, -1);
  return `${t}...`;
}
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = (text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) <= maxWidth || !cur) cur = trial;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}
function ascii(s: string): string {
  if (!s) return "";
  return s
    .replace(/₹/g, "Rs ")
    .replace(/[•]/g, "-")
    .replace(/[–—]/g, "-")
    .replace(/[''‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/·/g, "-")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
}
function hexToRgb(hex: string | null | undefined): RGB {
  const m = (hex ?? "").replace(/^#/, "").match(/^([0-9a-fA-F]{6})$/);
  if (!m) return DEFAULT_PRIMARY;
  const parts = m[1].match(/.{2}/g)!;
  const [r, g, b] = parts.map((x) => parseInt(x, 16) / 255);
  return rgb(r, g, b);
}
