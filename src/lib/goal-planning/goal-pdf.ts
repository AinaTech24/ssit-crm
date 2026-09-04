/**
 * Server-rendered DETAILED goal-plan PDF (pdf-lib, no headless Chrome) — carries
 * the same detail as the on-screen "Detailed PDF": logo + ARN + theme gradient
 * letterhead, headline cards (target / time / required SIP / status), the plan
 * breakdown, the return-sensitivity table (flat SIP & lumpsum per return rate),
 * and the full year-by-year projection. Multi-page with repeating headers +
 * footer. Returned as a Buffer for the goal "Email" attachment.
 */

import { PDFDocument, rgb, type PDFFont, type PDFPage, type PDFImage, type RGB } from "pdf-lib";
import { drawReportHeader, drawContinuationHeader, drawPageNumbers } from "@/lib/pdf/report-header";
import { embedPdfFonts, pdfSanitize } from "@/lib/pdf/fonts";
import { computeGoal, monthsBetween, sensitivitySipRates, projectYearly } from "./calc";

export type GoalBrand = {
  displayName?: string | null;
  legalName?: string | null;
  arn?: string | null;
  euin?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  logoUrl?: string | null;
};

const INK: RGB = rgb(0.06, 0.09, 0.16);
const SLATE: RGB = rgb(0.2, 0.255, 0.333);
const MUTED: RGB = rgb(0.45, 0.5, 0.58);
const GREEN: RGB = rgb(0.02, 0.6, 0.41);
const RED: RGB = rgb(0.86, 0.15, 0.15);
const LINE: RGB = rgb(0.89, 0.91, 0.94);
const HEADBG: RGB = rgb(0.97, 0.98, 0.99);
const ACCENT: RGB = rgb(0.055, 0.647, 0.914);
const DEFAULT_PRIMARY: RGB = rgb(0.055, 0.145, 0.341);

const STATUS_LABEL: Record<string, string> = {
  not_started: "Not started", on_track: "On track", behind_track: "Behind track", achieved: "Achieved",
};
const DISCLAIMER =
  "Mutual Fund investments are subject to market risks. Read all scheme related documents carefully. " +
  "Projections are illustrative based on the stated assumptions and are not guaranteed.";

const PW = 595.28, PH = 841.89, MARGIN = 40;
type Col = { h: string; w: number; align?: "r"; get: (r: any) => string };

// Glyph switches — set per render from the embedded font's capabilities. The
// Unicode embed is process-stable (depends only on font files on disk), so a
// module-level flag is safe and lets every helper (inr/ascii) pick it up
// without threading a parameter through each call site.
let KEEP_RUPEE = false;
let CUR = "Rs ";

export async function renderGoalPdf(args: {
  goal: Record<string, any>;
  investor: { name?: string | null } | null;
  brand: GoalBrand;
  generatedAt?: string;
  /** Audit reference (goal id) — printed in the footer as "Ref XXXXXXXX". */
  refId?: string | null;
}): Promise<Buffer> {
  const { goal, investor, brand } = args;
  const generatedAt = args.generatedAt ?? new Date().toISOString();

  const targetAmount = Number(goal.targetAmount);
  const currentValue = Number(goal.currentValue ?? 0);
  const ret = Number(goal.expectedReturn ?? 12);
  const monthsLeft = monthsBetween(new Date(), new Date(goal.targetDate));
  const calc = computeGoal({
    futureTarget: targetAmount,
    currentValue,
    existingMonthlySip: Number(goal.existingMonthlySip ?? goal.monthlyContribution ?? 0),
    monthsLeft,
    expectedReturnPct: ret,
    inflationPct: goal.inflationPct ? Number(goal.inflationPct) : 6,
    stepUpPct: goal.stepUpPct ? Number(goal.stepUpPct) : 10,
  } as any);
  const sensitivity = sensitivitySipRates(targetAmount, currentValue, monthsLeft);
  const projection = projectYearly({
    currentValue,
    initialMonthlySip: calc.requiredMonthlySipTotal,
    annualReturnPct: ret,
    months: monthsLeft,
  } as any);

  const doc = await PDFDocument.create();
  const { font: helv, bold, rupeeOk } = await embedPdfFonts(doc);
  KEEP_RUPEE = rupeeOk;
  CUR = rupeeOk ? "₹" : "Rs ";
  const primary = hexToRgb(brand.primaryColor);
  const secondary = brand.secondaryColor ? hexToRgb(brand.secondaryColor) : ACCENT;
  doc.setTitle(ascii(`Goal plan — ${goal.name ?? "Goal"}`));
  doc.setProducer("Equitywala");
  if (brand.legalName || brand.displayName) doc.setAuthor(ascii(brand.legalName ?? brand.displayName ?? ""));

  const usable = PW - 2 * MARGIN;
  const logo = await embedLogo(doc, brand.logoUrl);
  const cur = { page: doc.addPage([PW, PH]), y: 0 };
  const newPage = () => {
    cur.page = doc.addPage([PW, PH]);
    cur.y = drawContinuationHeader({
      page: cur.page, helv, bold, pageWidth: PW, pageHeight: PH, margin: MARGIN,
      firmName: brand.legalName ?? brand.displayName, title: "Goal plan", primary,
    });
  };
  const ensure = (need: number) => { if (cur.y - need < 92) { newPage(); return true; } return false; };

  // ── Letterhead — shared report header ──
  cur.y = drawReportHeader({
    page: cur.page,
    helv,
    bold,
    pageWidth: PW,
    pageHeight: PH,
    margin: MARGIN,
    logo,
    firmName: brand.legalName ?? brand.displayName,
    title: "GOAL PLAN",
    subtitles: [`Prepared ${fmtDate(generatedAt)}`],
    arn: brand.arn,
    primary,
    secondary,
  });

  // ── Headline ──
  cur.page.drawText(ascii(goal.name ?? "Goal"), { x: MARGIN, y: cur.y, size: 16, font: bold, color: INK });
  cur.y -= 18;
  cur.page.drawText(ascii(`Prepared for ${investor?.name ?? "Investor"} - ${monthsLeft} months to target`), { x: MARGIN, y: cur.y, size: 10, font: helv, color: SLATE });
  cur.y -= 26;

  // ── Headline cards ──
  const statusTone = calc.status === "on_track" || calc.status === "achieved" ? GREEN : calc.status === "behind_track" ? RED : SLATE;
  const cards: Array<{ label: string; value: string; tone?: RGB }> = [
    { label: "Target amount", value: inr(calc.futureTarget) },
    { label: "Time to goal", value: `${calc.yearsLeft ?? Math.round((monthsLeft / 12) * 10) / 10} yrs` },
    { label: "Required monthly SIP", value: inr(calc.requiredMonthlySipTotal), tone: primary },
    { label: "Status", value: STATUS_LABEL[calc.status] ?? calc.status, tone: statusTone },
  ];
  {
    const gap = 10, cw = (usable - gap * 3) / 4, ch = 52;
    cards.forEach((c, i) => {
      const x = MARGIN + i * (cw + gap);
      cur.page.drawRectangle({ x, y: cur.y - ch, width: cw, height: ch, color: HEADBG, borderColor: LINE, borderWidth: 1 });
      cur.page.drawText(ascii(c.label).toUpperCase(), { x: x + 8, y: cur.y - 15, size: 6.4, font: bold, color: MUTED });
      const vs = fitText(ascii(c.value), bold, 12, cw - 14, 8);
      cur.page.drawText(ascii(c.value), { x: x + 8, y: cur.y - 37, size: vs, font: bold, color: c.tone ?? INK });
    });
    cur.y -= ch + 26;
  }

  // ── Plan breakdown (label : value) ──
  section(cur, primary, bold, "PLAN BREAKDOWN", usable);
  const rows: Array<[string, string]> = [
    ["Target date", fmtDate(goal.targetDate)],
    ["Current value", inr(currentValue)],
    ["Expected return (p.a.)", `${calc.expectedReturnPct}%`],
    ["Inflation assumed", `${calc.inflationPct}%`],
    ["Annual step-up", `${calc.stepUpPct}%`],
    ["Projected value at goal", inr(calc.projectedTotalFV)],
    ["Shortfall / gap", inr(calc.gapAmount)],
    ["Required step-up starting SIP", inr(calc.requiredStepUpInitialSip)],
    ["Additional monthly SIP needed", inr(calc.additionalMonthlySipNeeded)],
  ];
  for (const [label, val] of rows) {
    ensure(15);
    cur.page.drawText(ascii(label), { x: MARGIN, y: cur.y, size: 9.5, font: helv, color: SLATE });
    const tv = ascii(val);
    cur.page.drawText(tv, { x: PW - MARGIN - bold.widthOfTextAtSize(tv, 9.5), y: cur.y, size: 9.5, font: bold, color: INK });
    cur.y -= 8;
    cur.page.drawRectangle({ x: MARGIN, y: cur.y + 2, width: usable, height: 0.6, color: LINE });
    cur.y -= 12;
  }
  cur.y -= 8;

  // ── Return sensitivity ──
  const sensCols: Col[] = [
    { h: "Return p.a.", w: 0.34, get: (s) => `${s.ratePct}%` },
    { h: "Flat SIP needed", w: 0.33, align: "r", get: (s) => inr(Math.round(s.sip)) },
    { h: "Lumpsum today", w: 0.33, align: "r", get: (s) => inr(Math.round(s.lumpsum)) },
  ];
  section(cur, primary, bold, "RETURN SENSITIVITY", usable);
  drawTable(cur, { helv, bold }, sensCols, sensitivity, usable, newPage, ensure);
  cur.y -= 10;

  // ── Year-by-year projection ──
  const projCols: Col[] = [
    { h: "Year", w: 0.16, get: (r) => String(r.year) },
    { h: "Contributed", w: 0.21, align: "r", get: (r) => inr(Math.round(r.contributedThisYear)) },
    { h: "Cumulative", w: 0.21, align: "r", get: (r) => inr(Math.round(r.cumulativeContributed)) },
    { h: "Corpus EoY", w: 0.24, align: "r", get: (r) => inr(Math.round(r.endOfYearCorpus)) },
    { h: "% to target", w: 0.18, align: "r", get: (r) => `${Math.round((r.endOfYearCorpus / targetAmount) * 100)}%` },
  ];
  section(cur, primary, bold, "YEAR-BY-YEAR PROJECTION", usable);
  cur.page.drawText(ascii(`Assumes ${inr(currentValue)} today + ${inr(Math.round(calc.requiredMonthlySipTotal))}/mo, compounding at ${ret}% p.a.`), { x: MARGIN, y: cur.y, size: 7.5, font: helv, color: MUTED });
  cur.y -= 14;
  drawTable(cur, { helv, bold }, projCols, projection, usable, newPage, ensure);

  for (const pg of doc.getPages()) drawFooter(pg, { helv, bold, brand, generatedAt, refId: args.refId });
  drawPageNumbers(doc, helv, PW, 8);
  if (args.refId) doc.setSubject(`Ref ${String(args.refId).slice(0, 8)}`);
  return Buffer.from(await doc.save());
}

/* ── helpers ── */
function section(cur: { page: PDFPage; y: number }, primary: RGB, bold: PDFFont, title: string, usable: number) {
  if (cur.y < 120) { /* let drawTable/ensure handle page; here just keep simple */ }
  cur.page.drawText(title, { x: MARGIN, y: cur.y, size: 9, font: bold, color: primary });
  cur.y -= 6;
  cur.page.drawRectangle({ x: MARGIN, y: cur.y - 2, width: usable, height: 1, color: LINE });
  cur.y -= 16;
}
function drawTable(
  cur: { page: PDFPage; y: number },
  f: { helv: PDFFont; bold: PDFFont },
  cols: Col[],
  data: any[],
  usable: number,
  newPage: () => void,
  ensure: (n: number) => boolean,
) {
  const header = () => {
    cur.page.drawRectangle({ x: MARGIN, y: cur.y - 4, width: usable, height: 15, color: HEADBG });
    let x = MARGIN + 6;
    for (const c of cols) {
      const cw = c.w * usable;
      if (c.align === "r") cur.page.drawText(c.h, { x: x + cw - 8 - f.helv.widthOfTextAtSize(c.h, 6.8), y: cur.y, size: 6.8, font: f.bold, color: MUTED });
      else cur.page.drawText(c.h, { x, y: cur.y, size: 6.8, font: f.bold, color: MUTED });
      x += cw;
    }
    cur.y -= 16;
  };
  header();
  for (const r of data) {
    if (ensure(15)) header();
    let x = MARGIN + 6;
    for (const c of cols) {
      const cw = c.w * usable;
      const v = ascii(String(c.get(r) ?? "-"));
      if (c.align === "r") cur.page.drawText(truncate(v, f.helv, 8.5, cw - 8), { x: x + cw - 6 - f.helv.widthOfTextAtSize(truncate(v, f.helv, 8.5, cw - 8), 8.5), y: cur.y, size: 8.5, font: c.h === "Corpus EoY" ? f.bold : f.helv, color: INK });
      else cur.page.drawText(truncate(v, f.helv, 8.5, cw - 6), { x, y: cur.y, size: 8.5, font: f.helv, color: INK });
      x += cw;
    }
    cur.page.drawRectangle({ x: MARGIN, y: cur.y - 4, width: usable, height: 0.6, color: LINE });
    cur.y -= 16;
  }
}
function drawFooter(page: PDFPage, a: { helv: PDFFont; bold: PDFFont; brand: GoalBrand; generatedAt: string; refId?: string | null }) {
  const pw = page.getWidth();
  page.drawRectangle({ x: MARGIN, y: 52, width: pw - 2 * MARGIN, height: 1, color: LINE });
  const legal = ascii(a.brand.legalName ?? a.brand.displayName ?? "Your Advisor");
  const arn = ascii(`ARN-${(a.brand.arn ?? "—").toString().replace(/^ARN-?/i, "")}`);
  page.drawText(`${legal}  -  ${arn}`, { x: MARGIN, y: 40, size: 8, font: a.bold, color: SLATE });
  const gen = ascii(`Generated ${fmtDate(a.generatedAt)}${a.refId ? ` - Ref ${String(a.refId).slice(0, 8).toUpperCase()}` : ""}`);
  const gw = a.helv.widthOfTextAtSize(gen, 7.5);
  page.drawText(gen, { x: pw - MARGIN - gw, y: 40, size: 7.5, font: a.helv, color: MUTED });
  let dy = 26;
  for (const line of wrap(DISCLAIMER, a.helv, 7, pw - 2 * MARGIN).slice(0, 2)) {
    page.drawText(line, { x: MARGIN, y: dy, size: 7, font: a.helv, color: MUTED });
    dy -= 9;
  }
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
function drawGradientStrip(page: PDFPage, x: number, y: number, w: number, h: number, c1: RGB, c2: RGB) {
  const segs = 48, sw = w / segs;
  for (let i = 0; i < segs; i++) {
    const t = i / (segs - 1);
    page.drawRectangle({ x: x + i * sw, y, width: sw + 0.6, height: h, color: rgb(c1.red + (c2.red - c1.red) * t, c1.green + (c2.green - c1.green) * t, c1.blue + (c2.blue - c1.blue) * t) });
  }
}
function inr(n: any): string {
  const v = typeof n === "string" ? Number(n) : n;
  if (v == null || !isFinite(v)) return `${CUR}0`;
  return CUR + Math.round(v).toLocaleString("en-IN");
}
function fmtDate(iso: string | Date): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "-" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
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
  // Keeps "₹" when the Unicode font is embedded; strips/converts otherwise.
  return pdfSanitize(s.replace(/·/g, "-"), KEEP_RUPEE);
}
function hexToRgb(hex: string | null | undefined): RGB {
  const m = (hex ?? "").replace(/^#/, "").match(/^([0-9a-fA-F]{6})$/);
  if (!m) return DEFAULT_PRIMARY;
  const [r, g, b] = m[1].match(/.{2}/g)!.map((x) => parseInt(x, 16) / 255);
  return rgb(r, g, b);
}
