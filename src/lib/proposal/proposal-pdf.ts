/**
 * Server-rendered investment-proposal PDF (pdf-lib, no headless Chrome).
 *
 * Carries the SAME detail as the on-screen proposal report: logo + ARN + theme
 * gradient letterhead, cover note, the investment/corpus/risk summary, and a
 * detailed per-kind product table (MF: scheme/AMC/lumpsum/SIP/term/return/
 * projected; Insurance: policy/insurer/sum-assured/premium/term; PMS & AIF:
 * strategy/manager/min/proposed/return/horizon/projected). Returned as a Buffer
 * so the "Send via email" route attaches it.
 */

import { PDFDocument, rgb, type PDFFont, type PDFPage, type PDFImage, type RGB } from "pdf-lib";
import { drawReportHeader, drawContinuationHeader, drawPageNumbers } from "@/lib/pdf/report-header";
import { embedPdfFonts, pdfSanitize } from "@/lib/pdf/fonts";

export type ProposalBrand = {
  displayName?: string | null;
  legalName?: string | null;
  arn?: string | null;
  euin?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  logoUrl?: string | null;
};

export type ProposalData = {
  title?: string | null;
  proposalNumber?: string | null;
  recipientName?: string | null;
  coverLetter?: string | null;
  totalInvestment?: number | string | null;
  expectedCorpus?: number | string | null;
  riskRating?: string | null;
  validUntil?: string | Date | null;
  products?: Array<Record<string, any>> | null;
};

const INK: RGB = rgb(0.06, 0.09, 0.16);
const SLATE: RGB = rgb(0.2, 0.255, 0.333);
const MUTED: RGB = rgb(0.45, 0.5, 0.58);
const GREEN: RGB = rgb(0.02, 0.6, 0.41);
const LINE: RGB = rgb(0.89, 0.91, 0.94);
const HEADBG: RGB = rgb(0.97, 0.98, 0.99);
const ACCENT: RGB = rgb(0.055, 0.647, 0.914);
const DEFAULT_PRIMARY: RGB = rgb(0.055, 0.145, 0.341);

const KIND_TITLE: Record<string, string> = {
  mf: "Mutual Funds", insurance: "Insurance", pms: "Portfolio Management Services", aif: "Alternative Investment Funds",
};
const DISCLAIMER =
  "Mutual Fund investments are subject to market risks. Read all scheme related documents carefully. " +
  "Projections are illustrative, not guaranteed.";

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 40;

// Glyph switches — set per render from the embedded font (process-stable, so a
// module flag is safe); lets amt()/ascii() render a real ₹ without threading
// a parameter through every call site.
let KEEP_RUPEE = false;
let CUR = "Rs ";

type Col = { h: string; w: number; align?: "l" | "r"; get: (it: any) => string };

function colsFor(kind: string): Col[] {
  if (kind === "insurance")
    return [
      { h: "Policy", w: 0.30, get: (it) => it.policyName ?? "-" },
      { h: "Insurer / Type", w: 0.26, get: (it) => [it.insurer, it.policyType].filter(Boolean).join(" - ") || "-" },
      { h: "Sum Assured", w: 0.17, align: "r", get: (it) => amt(it.sumAssured) },
      { h: "Premium", w: 0.15, align: "r", get: (it) => amt(it.annualPremium) },
      { h: "Term", w: 0.12, align: "r", get: (it) => yrs(it.termYears) },
    ];
  if (kind === "pms" || kind === "aif")
    return [
      { h: "Strategy", w: 0.26, get: (it) => it.strategyName ?? it.fundName ?? "-" },
      { h: "Manager", w: 0.18, get: (it) => it.manager ?? "-" },
      { h: "Min", w: 0.13, align: "r", get: (it) => amt(it.minInvestment) },
      { h: "Proposed", w: 0.15, align: "r", get: (it) => amt(it.proposedAmount) },
      { h: "Return", w: 0.10, align: "r", get: (it) => pctv(it.expectedReturn) },
      { h: "Horizon", w: 0.09, align: "r", get: (it) => yrs(it.termYears) },
      { h: "Projected", w: 0.09, align: "r", get: (it) => amt(projected(it.proposedAmount, it.expectedReturn, it.termYears)) },
    ];
  // mutual funds (default)
  return [
    { h: "Scheme", w: 0.24, get: (it) => it.schemeName ?? "-" },
    { h: "AMC", w: 0.16, get: (it) => it.amcName ?? "-" },
    { h: "Lumpsum", w: 0.13, align: "r", get: (it) => amt(it.lumpsum) },
    { h: "SIP/mo", w: 0.13, align: "r", get: (it) => amt(it.monthlyAmount) },
    { h: "Term", w: 0.09, align: "r", get: (it) => yrs(it.sipTermYears) },
    { h: "Return", w: 0.09, align: "r", get: (it) => pctv(it.expectedReturn) },
    { h: "Projected", w: 0.16, align: "r", get: (it) => amt(it.projectedCorpus) },
  ];
}

export async function renderProposalPdf(args: { proposal: ProposalData; brand: ProposalBrand; generatedAt?: string }): Promise<Buffer> {
  const { proposal: p, brand } = args;
  const generatedAt = args.generatedAt ?? new Date().toISOString();
  const doc = await PDFDocument.create();
  const { font: helv, bold, rupeeOk } = await embedPdfFonts(doc);
  KEEP_RUPEE = rupeeOk;
  CUR = rupeeOk ? "₹" : "Rs ";
  const primary = hexToRgb(brand.primaryColor);
  const secondary = brand.secondaryColor ? hexToRgb(brand.secondaryColor) : ACCENT;

  doc.setTitle(ascii(`Proposal ${p.proposalNumber ?? ""} — ${p.recipientName ?? "Client"}`));
  doc.setProducer("SSIT CRM");
  if (brand.legalName || brand.displayName) doc.setAuthor(ascii(brand.legalName ?? brand.displayName ?? ""));

  const logo = await embedLogo(doc, brand.logoUrl);
  const W = A4[0];
  const usable = W - 2 * MARGIN;

  // Cursor — pages are added as content overflows, each opening with the
  // shared slim continuation header.
  const cur = { page: doc.addPage(A4), y: 0 };
  const newPage = () => {
    cur.page = doc.addPage(A4);
    cur.y = drawContinuationHeader({
      page: cur.page, helv, bold, pageWidth: W, pageHeight: A4[1], margin: MARGIN,
      firmName: brand.legalName ?? brand.displayName, title: "Investment proposal", primary,
    });
  };
  const ensure = (need: number) => {
    if (cur.y - need < 96) newPage();
  };

  // ── Letterhead (first page only) — shared report header ──
  cur.y = drawReportHeader({
    page: cur.page,
    helv,
    bold,
    pageWidth: W,
    pageHeight: A4[1],
    margin: MARGIN,
    logo,
    firmName: brand.legalName ?? brand.displayName,
    title: "INVESTMENT PROPOSAL",
    subtitles: [fmtDate(generatedAt)],
    arn: brand.arn,
    primary,
    secondary,
  });

  // ── Title + recipient ──
  cur.page.drawText(ascii(p.title ?? "Investment Proposal"), { x: MARGIN, y: cur.y, size: 16, font: bold, color: INK });
  cur.y -= 18;
  cur.page.drawText(ascii(`Prepared for ${p.recipientName ?? "Client"}`), { x: MARGIN, y: cur.y, size: 10, font: helv, color: SLATE });
  cur.y -= 24;

  // ── Cover note — flows across pages, never silently truncated ──
  if (p.coverLetter && p.coverLetter.trim()) {
    for (const ln of wrap(ascii(p.coverLetter), helv, 9.5, usable)) {
      ensure(13);
      cur.page.drawText(ln, { x: MARGIN, y: cur.y, size: 9.5, font: helv, color: SLATE });
      cur.y -= 13;
    }
    cur.y -= 12;
  }

  // ── Summary cards ──
  const cards: Array<{ label: string; value: string; tone?: RGB }> = [
    { label: "Total investment", value: amt(p.totalInvestment) },
    { label: "Projected corpus", value: amt(p.expectedCorpus), tone: GREEN },
    { label: "Risk rating", value: p.riskRating ? ascii(p.riskRating) : "-" },
    { label: "Valid until", value: p.validUntil ? fmtDate(p.validUntil) : "-" },
  ];
  ensure(70);
  {
    const gap = 10;
    const cw = (usable - gap * (cards.length - 1)) / cards.length;
    const ch = 50;
    cards.forEach((c, i) => {
      const x = MARGIN + i * (cw + gap);
      cur.page.drawRectangle({ x, y: cur.y - ch, width: cw, height: ch, color: HEADBG, borderColor: LINE, borderWidth: 1 });
      cur.page.drawText(ascii(c.label).toUpperCase(), { x: x + 8, y: cur.y - 15, size: 6.6, font: bold, color: MUTED });
      const vs = fitText(ascii(c.value), bold, 12, cw - 14, 7);
      cur.page.drawText(ascii(c.value), { x: x + 8, y: cur.y - 36, size: vs, font: bold, color: c.tone ?? INK });
    });
    cur.y -= ch + 26;
  }

  // ── Detailed per-kind product tables ──
  const products = (p.products ?? []) as any[];
  const groups: Record<string, any[]> = {};
  for (const it of products) (groups[it?.kind ?? "mf"] ??= []).push(it);

  for (const [kind, items] of Object.entries(groups)) {
    const cols = colsFor(kind);
    ensure(40);
    cur.page.drawText(ascii(KIND_TITLE[kind] ?? kind).toUpperCase(), { x: MARGIN, y: cur.y, size: 9, font: bold, color: primary });
    cur.y -= 14;

    // Header row
    const drawHeader = () => {
      cur.page.drawRectangle({ x: MARGIN, y: cur.y - 4, width: usable, height: 15, color: HEADBG });
      let x = MARGIN + 4;
      for (const c of cols) {
        const cw = c.w * usable;
        if (c.align === "r") cur.page.drawText(c.h, { x: x + cw - 8 - helv.widthOfTextAtSize(c.h, 6.8), y: cur.y, size: 6.8, font: bold, color: MUTED });
        else cur.page.drawText(c.h, { x, y: cur.y, size: 6.8, font: bold, color: MUTED });
        x += cw;
      }
      cur.y -= 16;
    };
    drawHeader();

    for (const it of items) {
      const pageBefore = cur.page;
      ensure(15);
      if (cur.page !== pageBefore) drawHeader(); // re-draw header on a fresh page
      let x = MARGIN + 4;
      for (const c of cols) {
        const cw = c.w * usable;
        const val = ascii(String(c.get(it) ?? "-"));
        const isProjected = c.h === "Projected";
        if (c.align === "r") {
          // Money never gets chopped — a "Rs 11,5..." reads as a wrong amount.
          // Shrink the font to fit the column so the FULL value always renders.
          const f = isProjected ? bold : helv;
          const fs = fitText(val, f, 8.5, cw - 8, 6);
          cur.page.drawText(val, { x: x + cw - 6 - f.widthOfTextAtSize(val, fs), y: cur.y, size: fs, font: f, color: isProjected ? GREEN : INK });
        } else {
          cur.page.drawText(truncate(val, helv, 8.5, cw - 6), { x, y: cur.y, size: 8.5, font: c.h === cols[0].h ? bold : helv, color: INK });
        }
        x += cw;
      }
      cur.page.drawRectangle({ x: MARGIN, y: cur.y - 4, width: usable, height: 0.6, color: LINE });
      cur.y -= 16;
    }
    cur.y -= 8;
  }

  // ── Footer on every page + centered page numbers ──
  for (const pg of doc.getPages()) drawFooter(pg, { helv, bold, brand, generatedAt, refId: p.proposalNumber });
  drawPageNumbers(doc, helv, W, 8);
  if (p.proposalNumber) doc.setSubject(`Ref ${p.proposalNumber}`);

  return Buffer.from(await doc.save());
}

/* ── helpers ── */
function drawFooter(page: PDFPage, a: { helv: PDFFont; bold: PDFFont; brand: ProposalBrand; generatedAt: string; refId?: string | null }) {
  const W = page.getWidth();
  page.drawRectangle({ x: MARGIN, y: 52, width: W - 2 * MARGIN, height: 1, color: LINE });
  const legal = ascii(a.brand.legalName ?? a.brand.displayName ?? "Your Advisor");
  const arn = ascii(`ARN-${(a.brand.arn ?? "—").toString().replace(/^ARN-?/i, "")}`);
  page.drawText(`${legal}  -  ${arn}`, { x: MARGIN, y: 40, size: 8, font: a.bold, color: SLATE });
  const gen = ascii(`Generated ${fmtDate(a.generatedAt)}${a.refId ? ` - Ref ${a.refId}` : ""}`);
  const gw = a.helv.widthOfTextAtSize(gen, 7.5);
  page.drawText(gen, { x: W - MARGIN - gw, y: 40, size: 7.5, font: a.helv, color: MUTED });
  let dy = 26;
  for (const line of wrap(DISCLAIMER, a.helv, 7, W - 2 * MARGIN).slice(0, 2)) {
    page.drawText(line, { x: MARGIN, y: dy, size: 7, font: a.helv, color: MUTED });
    dy -= 9;
  }
}
function projected(amount: any, ret: any, years: any): number | null {
  const a = Number(amount), r = Number(ret), y = Number(years);
  if (!isFinite(a) || a <= 0 || !isFinite(r) || !isFinite(y) || y <= 0) return null;
  return Math.round(a * Math.pow(1 + r / 100, y));
}
function amt(n: any): string {
  const v = typeof n === "string" ? Number(n) : n;
  if (v == null || !isFinite(v) || v === 0) return "-";
  return CUR + Math.round(v).toLocaleString("en-IN");
}
function yrs(n: any): string {
  const v = Number(n);
  return isFinite(v) && v > 0 ? `${v} yrs` : "-";
}
function pctv(n: any): string {
  const v = Number(n);
  return isFinite(v) && v !== 0 ? `${v}%` : "-";
}
function fmtDate(iso: string | Date): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "-" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function absUrl(url: string): string {
  if (/^(https?:|data:)/i.test(url)) return url;
  const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "").replace(/\/+$/, "");
  return base ? `${base}${url.startsWith("/") ? "" : "/"}${url}` : url;
}
async function embedLogo(doc: PDFDocument, rawUrl?: string | null): Promise<PDFImage | null> {
  if (!rawUrl) return null;
  try {
    const res = await fetch(absUrl(rawUrl), { cache: "no-store" });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (ct.includes("png")) return await doc.embedPng(bytes);
    if (ct.includes("jpeg") || ct.includes("jpg")) return await doc.embedJpg(bytes);
    try { return await doc.embedPng(bytes); } catch {}
    try { return await doc.embedJpg(bytes); } catch {}
    return null;
  } catch { return null; }
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
  const lines: string[] = [];
  for (const para of (text || "").split(/\n/)) {
    let cur = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const trial = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(trial, size) <= maxWidth || !cur) cur = trial;
      else { lines.push(cur); cur = w; }
    }
    lines.push(cur);
  }
  return lines.length ? lines : [""];
}
function ascii(s: string): string {
  if (!s) return "";
  // Keeps "₹" when the Unicode font is embedded; strips/converts otherwise.
  return pdfSanitize(s.replace(/·/g, "-"), KEEP_RUPEE);
}
function hexToRgb(hex: string | null | undefined): RGB {
  const m = (hex ?? "").replace(/^#/, "").match(/^([0-9a-fA-F]{6})$/);
  if (!m) return DEFAULT_PRIMARY;
  const [r, g, b] = m[1].match(/.{2}/g)!.map((x) => parseInt(x, 16) / 255);
  return rgb(r, g, b);
}
