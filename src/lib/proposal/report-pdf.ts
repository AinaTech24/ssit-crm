/**
 * The proposal as an "Investment Analysis & Performance Report", laid out like the
 * firm's reference report (A4 landscape):
 *
 *   1. Cover         - navy sidebar (logo, prepared for / by, contact, website) and the
 *                      report title, date and disclaimer on the right.
 *   2. Particulars   - investor, SIP / lumpsum amount, period, expected returns, riskometer.
 *   3. Suggested schemes - category, risk, period, return, amounts, allocation, grand total
 *                      and the projected value.
 *   4. Trailing returns and the historical return of a monthly SIP (XIRR) - worked out
 *                      from each scheme's NAV history. Left out for a scheme whose
 *                      history cannot be fetched.
 *   5. "What if" the SIP is topped up 5 / 10 / 15% a year.
 *   6. Allocation by AMC, asset class and category.
 *   7. Insurance / PMS / AIF items, in the same boxed format.
 *   8. Disclaimer page.
 *
 * Not included: scheme AUM, peer rank, category averages and the top-10 sector /
 * holdings tables - those need a fund-data provider the CRM does not have.
 *
 * Text is Helvetica (metric twin of the reference's Arial); only the rupee sign is
 * drawn from the embedded DejaVu font, as Helvetica has no such glyph.
 */

import { PDFDocument, StandardFonts, rgb, setCharacterSpacing, type PDFFont, type PDFPage, type PDFImage, type RGB } from "pdf-lib";
import { embedPdfFonts, pdfSanitize } from "@/lib/pdf/fonts";
import { lineItemFutureValue, lineItemInvestment } from "@/lib/proposals/projections";
import { colsFor, isBlankCell, pruneEmptyCols, type ProposalData } from "@/lib/proposal/proposal-pdf";
import {
  assetClassOf,
  loadSchemeAnalytics,
  stepUpSip,
  type SchemeAnalytics,
} from "@/lib/proposal/report-analytics";

export type ReportBrand = {
  displayName?: string | null;
  legalName?: string | null;
  arn?: string | null;
  euin?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  logoUrl?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: { line1?: string; line2?: string; city?: string; state?: string; pincode?: string } | string | null;
};

const c = (r: number, g: number, b: number): RGB => rgb(r / 255, g / 255, b / 255);
const NAVY = c(22, 43, 74);
const NAVY_LINE = c(52, 74, 106);
const SIDE_LABEL = c(143, 165, 192);
const TEAL = c(0, 145, 170);
const TITLE_BLUE = c(27, 58, 99);
const ACCENT = c(41, 171, 212);
const BLUE = c(60, 91, 147);
const HEAD_BLUE = c(31, 63, 143);
const LINK_BLUE = c(26, 40, 190);
const BORDER = c(125, 150, 190);
const BAND_BG = c(240, 240, 240);
const HEAD_BG = c(250, 250, 251);
const ZEBRA = c(247, 248, 250);
const DOT = c(150, 150, 150);
const INK = c(15, 15, 15);
const GREY = c(110, 110, 110);
const MUTED = c(122, 132, 148);
const WHITE = rgb(1, 1, 1);
const G1 = c(228, 240, 220);
const G3 = c(253, 243, 212);
const G5 = c(230, 235, 247);
const G10 = c(251, 229, 229);

const PW = 841.89;
const PH = 595.28;
const ML = 45;
const CW = PW - 2 * ML;
const BOTTOM = 30;
const GAP = 12;
const BAND_H = 20;
const HEAD_H = 21.5;
const ROW_H = 20.8;
const SZ = 8.2;
const PAD = 4;

const MF_DISCLAIMER =
  "Mutual Fund Investments are subject to market risks, read all scheme related documents carefully. Past performance may or may not be sustained in the future. Investors should consult with their Mutual Fund Distributor or Financial Advisor before investing.";

const LONG_DISCLAIMER_1 =
  "We have gathered all the data, information, statistics from the sources believed to be highly reliable and true. All necessary precautions have been taken to avoid any error, lapse or insufficiency; however, no representations or warranties are made (express or implied) as to the reliability, accuracy or completeness of such information. We cannot be held liable for any loss arising directly or indirectly from the use of, or any action taken on, any information appearing herein. The user is advised to verify the contents of the report independently. It is not an Investment recommendation or personal financial, Investment or professional advice and should not be treated as such.";
const LONG_DISCLAIMER_2 =
  "The Risk Level of any of the schemes must always be commensurate with the risk profile, Investment objective or financial goals of the investor concerned. Therefore, the Investors should assess their risk profile before making any Investment decision and consider the asset allocation accordingly.";
const LONG_DISCLAIMER_3 =
  "Returns less than 1 year are in absolute (%) and greater than 1 year are compounded annualised (CAGR %). SIP returns are shown in XIRR (%). Expected returns are assumptions supplied for illustration and are not guaranteed.";

const KIND_TITLE: Record<string, string> = {
  insurance: "Insurance",
  pms: "Portfolio Management Services",
  aif: "Alternative Investment Funds",
};

type McItem = {
  name: string;
  amc: string;
  category: string;
  risk: string;
  years: number;
  ret: number;
  monthly: number;
  lumpsum: number;
  invested: number;
  fv: number;
  code: string;
};

type Al = "l" | "r" | "c";
type CellObj = {
  t?: string;
  parts?: Array<{ t: string; b?: boolean }>;
  span?: number;
  al?: Al;
  b?: boolean;
  size?: number;
  fill?: RGB;
  color?: RGB;
  draw?: (x: number, top: number, w: number, h: number) => void;
};
type Cell = string | CellObj;
type ColSpec = { w: number; al: Al };
type Row = { cells: Cell[]; fill?: RGB; minH?: number; noDots?: boolean };
type TableSpec = {
  title?: string;
  titleAl?: Al;
  cols: ColSpec[];
  head?: Cell[][];
  rows: Row[];
  zebra?: boolean;
};

/** Build the report. `analytics` may be passed in (tests); otherwise it is fetched. */
export async function renderProposalReportPdf(args: {
  proposal: ProposalData;
  brand: ReportBrand;
  generatedAt?: string;
  analytics?: Map<string, SchemeAnalytics>;
}): Promise<Buffer> {
  const { proposal: p, brand } = args;
  const generatedAt = args.generatedAt ?? new Date().toISOString();

  const doc = await PDFDocument.create();
  const dj = await embedPdfFonts(doc); // DejaVu: only for the rupee sign
  const rupeeOk = dj.rupeeOk;
  const hv = await doc.embedFont(StandardFonts.Helvetica);
  const hb = await doc.embedFont(StandardFonts.HelveticaBold);
  const T = (s: string | null | undefined) => pdfSanitize(String(s ?? "").replace(/·/g, "-"), rupeeOk);

  const firm = brand.legalName ?? brand.displayName ?? "Your Advisor";
  const arnText = brand.arn ? `ARN-${String(brand.arn).replace(/^ARN[-:\s]*/i, "")}` : "";
  const house = T(brand.displayName ?? brand.legalName ?? "Your Advisor").toUpperCase();

  doc.setTitle(T(`Investment report ${p.proposalNumber ?? ""} - ${p.recipientName ?? "Client"}`));
  doc.setProducer("Equitywala");
  doc.setAuthor(T(firm));
  if (p.proposalNumber) doc.setSubject(`Ref ${p.proposalNumber}`);

  const logo = await embedLogo(doc, brand.logoUrl);

  // ── text primitives (Helvetica, rupee sign from DejaVu) ──
  const segs = (s: string) => s.split(/(₹)/).filter(Boolean);
  const fontFor = (seg: string, b: boolean): PDFFont => (seg === "₹" ? (b ? dj.bold : dj.font) : b ? hb : hv);
  const tw = (s: string, size: number, b = false) => segs(s).reduce((a, x) => a + fontFor(x, b).widthOfTextAtSize(x, size), 0);
  /** Draw at a baseline measured from the page top. */
  const put = (s: string, x: number, top: number, size: number, b: boolean, color: RGB, spacing = 0) => {
    const page = cur.page;
    let cx = x;
    if (spacing) page.pushOperators(setCharacterSpacing(spacing));
    for (const seg of segs(s)) {
      const f = fontFor(seg, b);
      page.drawText(seg, { x: cx, y: PH - top, size, font: f, color });
      cx += f.widthOfTextAtSize(seg, size) + (spacing ? spacing * seg.length : 0);
    }
    if (spacing) page.pushOperators(setCharacterSpacing(0));
  };
  const wrapT = (text: string, size: number, b: boolean, maxW: number): string[] => {
    const lines: string[] = [];
    for (const para of (text || "").split(/\n/)) {
      let line = "";
      for (const w of para.split(/\s+/).filter(Boolean)) {
        const trial = line ? `${line} ${w}` : w;
        if (tw(trial, size, b) <= maxW || !line) line = trial;
        else {
          lines.push(line);
          line = w;
        }
      }
      lines.push(line);
    }
    return lines.length ? lines : [""];
  };
  const fit = (text: string, size: number, b: boolean, maxW: number, min = 6) => {
    let s = size;
    while (s > min && tw(text, s, b) > maxW) s -= 0.4;
    return s;
  };

  // ── What is in the proposal ──
  const products = (p.products ?? []) as Array<Record<string, any>>;
  const mf: McItem[] = products
    .filter((it) => (it?.kind ?? "mf") === "mf")
    .map((it) => {
      const monthly = Number(it.monthlyAmount ?? 0) || 0;
      const years = Number(it.sipTermYears ?? 0) || 0;
      const lumpsum = Number(it.lumpsum ?? 0) || 0;
      return {
        name: String(it.schemeName ?? "-"),
        amc: String(it.amcName ?? "-"),
        category: String(it.category ?? ""),
        risk: String(it.riskRating ?? ""),
        years,
        ret: Number(it.expectedReturn ?? 0) || 0,
        monthly,
        lumpsum,
        invested: lineItemInvestment(it as any),
        fv: lineItemFutureValue(it as any) ?? 0,
        code: String(it.schemeCode ?? ""),
      };
    });
  const hasSip = mf.some((m) => m.monthly > 0);
  const hasLump = mf.some((m) => m.lumpsum > 0);
  const kindLabel = hasSip && hasLump ? "SIP + Lumpsum" : hasLump ? "Lumpsum" : "SIP";
  const hasMf = mf.length > 0;
  const reportTitle = hasMf ? "INVESTMENT ANALYSIS & PERFORMANCE REPORT" : "INVESTMENT PROPOSAL";
  const subtitle = hasMf ? `Investment Presentation - ${kindLabel}` : p.title || "Investment Proposal";
  const reportDate = dmy(generatedAt);

  const analytics =
    args.analytics ?? (hasMf ? await loadSchemeAnalytics(mf.map((m) => m.code).filter(Boolean)) : new Map<string, SchemeAnalytics>());

  // ── page flow (cursor = distance from the page top) ──
  const cover = doc.addPage([PW, PH]);
  const body1 = doc.addPage([PW, PH]);
  const cur = { page: body1, top: 0 };

  const addrLines = addressLines(brand.address);
  const contactLine = [brand.phone ? `Phone: ${brand.phone}` : "", brand.email ? `Email: ${brand.email}` : ""].filter(Boolean).join(" | ");

  const drawLogoFit = (page: PDFPage, img: PDFImage, x: number, top: number, maxW: number, maxH: number, rightAlign = false) => {
    let w = (img.width / img.height) * maxH;
    let h = maxH;
    if (w > maxW) {
      w = maxW;
      h = (img.height / img.width) * maxW;
    }
    page.drawImage(img, { x: rightAlign ? x - w : x, y: PH - top - h, width: w, height: h });
  };

  const newPage = () => {
    cur.page = doc.addPage([PW, PH]);
    put(house, ML, 18.5, 11.6, true, HEAD_BLUE);
    put("AMFI Registered Mutual Fund Distributor", ML, 34.5, 9.4, false, INK);
    cur.top = 51;
  };
  const limit = PH - BOTTOM;
  const ensure = (h: number) => {
    if (cur.top + h > limit) newPage();
  };

  // ═══════════════ COVER ═══════════════
  {
    cur.page = cover;
    cover.drawRectangle({ x: 0, y: 0, width: 219.2, height: PH, color: NAVY });
    // logo card
    cover.drawSvgPath(roundedRect(166, 62.3, 4), { x: 26.2, y: PH - 27, color: WHITE });
    if (logo) drawLogoFit(cover, logo, 26.2 + 12, 27 + 10, 142, 42.3);
    else {
      const nm = T(brand.displayName ?? firm);
      const s = fit(nm, 13, true, 140);
      put(nm, 26.2 + 83 - tw(nm, s, true) / 2, 27 + 36, s, true, NAVY);
    }
    const hr = (top: number) => cover.drawRectangle({ x: 26.2, y: PH - top, width: 166, height: 0.7, color: NAVY_LINE });
    const label = (s: string, top: number) => put(s, 26.2, top, 6.6, false, SIDE_LABEL, 2.1);
    const side = (s: string, top: number, size = 9.6) => put(s, 26.2, top, size, false, WHITE);
    hr(115.3);
    label("PREPARED FOR", 150);
    let y = 171;
    for (const l of wrapT(T(p.recipientName ?? "Client"), 9.6, false, 166)) {
      side(l, y);
      y += 16;
    }
    hr(203);
    label("PREPARED BY", 237.5);
    y = 258.5;
    for (const l of [...wrapT(T(firm), 9.6, false, 166), ...(brand.arn ? wrapT(`AMFI Registered Mutual Fund Distributor (${arnText})`, 9.6, false, 166) : [])]) {
      side(l, y);
      y += 16.4;
    }
    y = Math.max(y - 16.4 + 36, 328);
    if (brand.phone || brand.email || addrLines.length) {
      label("CONTACT", y);
      y += 21;
      const icon = (kind: "phone" | "mail" | "pin", top: number) => {
        const ix = 26.2;
        if (kind === "phone") cover.drawSvgPath("M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z", { x: ix - 1, y: PH - (top - 7.2), scale: 0.45, color: WHITE });
        if (kind === "mail") {
          cover.drawRectangle({ x: ix, y: PH - (top + 1), width: 8.4, height: 6, color: WHITE });
          cover.drawLine({ start: { x: ix, y: PH - (top - 5) }, end: { x: ix + 4.2, y: PH - (top - 1.2) }, thickness: 0.8, color: NAVY });
          cover.drawLine({ start: { x: ix + 8.4, y: PH - (top - 5) }, end: { x: ix + 4.2, y: PH - (top - 1.2) }, thickness: 0.8, color: NAVY });
        }
        if (kind === "pin") {
          cover.drawSvgPath("M0 0 L5.6 0 L2.8 6.6 Z", { x: ix + 1.2, y: PH - (top - 3.6), color: WHITE });
          cover.drawCircle({ x: ix + 4, y: PH - (top - 5.2), size: 3.3, color: WHITE });
          cover.drawCircle({ x: ix + 4, y: PH - (top - 5.2), size: 1.2, color: NAVY });
        }
      };
      if (brand.phone) {
        icon("phone", y);
        put(T(brand.phone), 40, y, 9, false, WHITE);
        y += 15;
      }
      if (brand.email) {
        icon("mail", y);
        put(T(brand.email), 40, y, 9, false, WHITE);
        y += 15;
      }
      if (addrLines.length) {
        icon("pin", y);
        const lines = wrapT(T(addrLines.join(", ")), 9, false, 150);
        for (const l of lines) {
          put(l, 40, y, 9, false, WHITE);
          y += 15;
        }
      }
      y += 16;
    }
    if (brand.website) {
      label("WEBSITE", y);
      side(T(brand.website), y + 23, 9);
    }

    // right side
    const target = 438;
    const ts = 13.4;
    const nat = tw(reportTitle, ts, true);
    const sp = Math.max(0.6, (target - nat) / (reportTitle.length - 1));
    put(reportTitle, 264, 55.5, ts, true, TEAL, sp);
    const sub = T(subtitle);
    const sSize = fit(sub, 26.2, true, 540, 14);
    put(sub, 264, 149, sSize, true, TITLE_BLUE);
    cover.drawRectangle({ x: 264, y: PH - 180, width: 52, height: 3, color: ACCENT });
    put("REPORT DATE", 264, 251.5, 6.6, false, MUTED, 2.1);
    put(reportDate, 264, 271, 11, true, TITLE_BLUE);
    let dy = 474.5;
    const dl = wrapT(`Disclaimer : ${MF_DISCLAIMER}`, 9.3, false, 505);
    dl.forEach((l, i) => {
      if (i === 0 && l.startsWith("Disclaimer :")) {
        put("Disclaimer :", 264, dy, 9.3, true, c(110, 110, 110));
        put(l.slice("Disclaimer :".length), 264 + tw("Disclaimer :", 9.3, true), dy, 9.3, false, c(130, 130, 130));
      } else put(l, 264, dy, 9.3, false, c(130, 130, 130));
      dy += 16.9;
    });
  }

  // ═══════════════ BODY page 1: letterhead ═══════════════
  {
    cur.page = body1;
    put(house, ML, 36, 11.6, true, INK);
    put(T(brand.arn ? `AMFI Registered Mutual Fund Distributor (${arnText})` : "AMFI Registered Mutual Fund Distributor"), ML, 51.3, 10.3, false, INK);
    let ay = 85.7;
    const small = [...addrLines.map((l, i) => (i < addrLines.length - 1 && !l.endsWith(",") ? `${l},` : l)), contactLine].filter(Boolean);
    for (const l of small) {
      put(T(l), ML, ay, 7.4, false, INK);
      ay += 11.6;
    }
    if (logo) drawLogoFit(cur.page, logo, PW - ML - 7, 47, 150, 34, true);
    else {
      const nm = T(brand.displayName ?? firm);
      put(nm, PW - ML - 7 - tw(nm, 16, true), 70, 16, true, TITLE_BLUE);
    }
    if (brand.website) {
      const w = T(brand.website);
      put(w, PW - ML - tw(w, 7.4), 111, 7.4, false, LINK_BLUE);
    }
    cur.page.drawRectangle({ x: ML, y: PH - 122, width: CW, height: 1.3, color: c(30, 30, 30) });
    put(T(subtitle), ML, 146, 12.6, false, BLUE);
    const rd = `Report as on: ${reportDate}`;
    put(rd, PW - ML - tw(rd, 8.6), 141, 8.6, false, INK);
    cur.top = 158;
  }

  // ═══════════════ table engine ═══════════════
  const norm = (cols: ColSpec[], total: number) => {
    const sum = cols.reduce((a, x) => a + x.w, 0) || 1;
    return cols.map((x) => (x.w / sum) * total);
  };
  const place = (cells: Cell[], widths: number[]) => {
    const out: Array<{ c: CellObj; x: number; w: number; ci: number }> = [];
    let ci = 0;
    let x = 0;
    for (const raw of cells) {
      const cell: CellObj = typeof raw === "string" ? { t: raw } : raw;
      const span = cell.span ?? 1;
      let w = 0;
      for (let k = 0; k < span; k++) w += widths[ci + k] ?? 0;
      out.push({ c: cell, x, w, ci });
      x += w;
      ci += span;
    }
    return out;
  };
  const LEAD = SZ + 1.8;
  const cellLines = (cell: CellObj, w: number, al: Al): string[] => {
    if (cell.parts) return [""];
    const txt = T(cell.t ?? "");
    if (al !== "l" || cell.draw) return [txt];
    return wrapT(txt, cell.size ?? SZ, !!cell.b, w - PAD * 2).slice(0, 3);
  };
  const rowHeight = (row: Row, spec: TableSpec, widths: number[]) => {
    let lines = 1;
    for (const pl of place(row.cells, widths)) {
      const al = pl.c.al ?? spec.cols[pl.ci]?.al ?? "l";
      lines = Math.max(lines, cellLines(pl.c, pl.w, al).length);
    }
    return Math.max(row.minH ?? ROW_H, lines * LEAD + 11);
  };
  const dotted = (x: number, top: number, w: number) =>
    cur.page.drawLine({ start: { x, y: PH - top }, end: { x: x + w, y: PH - top }, thickness: 0.6, color: DOT, dashArray: [0.8, 1.3] });

  const drawCell = (pl: { c: CellObj; x: number; w: number; ci: number }, spec: TableSpec, x0: number, top: number, h: number, base: { b?: boolean; color?: RGB; size?: number }) => {
    const cell = pl.c;
    const al = cell.al ?? spec.cols[pl.ci]?.al ?? "l";
    const x = x0 + pl.x;
    if (cell.fill) cur.page.drawRectangle({ x, y: PH - top - h, width: pl.w, height: h, color: cell.fill });
    if (cell.draw) {
      cell.draw(x, top, pl.w, h);
      return;
    }
    const b = cell.b ?? base.b ?? false;
    const color = cell.color ?? base.color ?? INK;
    let size = cell.size ?? base.size ?? SZ;
    if (cell.parts) {
      const adv = (q: { t: string; b?: boolean }) => tw(T(q.t), size, !!q.b) + (/\s$/.test(q.t) ? tw(" ", size, !!q.b) : 0);
      const whole = cell.parts.reduce((a, q) => a + adv(q), 0);
      let cx = al === "r" ? x + pl.w - PAD - whole : al === "c" ? x + (pl.w - whole) / 2 : x + PAD;
      for (const q of cell.parts) {
        put(T(q.t), cx, top + h / 2 + size * 0.34, size, !!q.b, color);
        cx += adv(q);
      }
      return;
    }
    const lines = cellLines(cell, pl.w, al);
    if (al !== "l") size = fit(lines[0], size, b, pl.w - PAD * 2);
    const block = lines.length * LEAD;
    lines.forEach((ln, k) => {
      if (!ln) return;
      const base0 = top + h / 2 - block / 2 + LEAD * k + LEAD / 2 + size * 0.34 - 0.4;
      const wv = tw(ln, size, b);
      const lx = al === "r" ? x + pl.w - PAD - wv : al === "c" ? x + (pl.w - wv) / 2 : x + PAD;
      put(ln, lx, base0, size, b, color);
    });
  };

  const drawBand = (spec: TableSpec, x: number, top: number, w: number) => {
    cur.page.drawRectangle({ x, y: PH - top - BAND_H, width: w, height: BAND_H, color: BAND_BG });
    const t = T(spec.title ?? "");
    const tx = spec.titleAl === "c" ? x + (w - tw(t, SZ + 0.2, true)) / 2 : x + PAD + 0.5;
    put(t, tx, top + BAND_H / 2 + 2.9, SZ + 0.2, true, BLUE);
    return BAND_H;
  };
  const drawHead = (spec: TableSpec, widths: number[], x: number, top: number, w: number) => {
    let t = top;
    const rows = spec.head ?? [];
    rows.forEach((hr, i) => {
      cur.page.drawRectangle({ x, y: PH - t - HEAD_H, width: w, height: HEAD_H, color: HEAD_BG });
      for (const pl of place(hr, widths)) drawCell(pl, spec, x, t, HEAD_H, { b: true, color: BLUE });
      if (i === rows.length - 1) cur.page.drawRectangle({ x, y: PH - t - HEAD_H, width: w, height: 0.9, color: c(25, 25, 25) });
      t += HEAD_H;
    });
    return rows.length * HEAD_H;
  };
  const drawBodyRow = (spec: TableSpec, row: Row, idx: number, widths: number[], x: number, top: number, w: number, h: number) => {
    const fill = row.fill ?? (spec.zebra && idx % 2 === 1 ? ZEBRA : undefined);
    if (fill) cur.page.drawRectangle({ x, y: PH - top - h, width: w, height: h, color: fill });
    for (const pl of place(row.cells, widths)) drawCell(pl, spec, x, top, h, {});
    if (!row.noDots) dotted(x, top + h, w);
  };
  const border = (x: number, top: number, w: number, bottom: number) =>
    cur.page.drawRectangle({ x, y: PH - bottom, width: w, height: bottom - top, borderColor: BORDER, borderWidth: 0.9 });

  /** A full-width table that flows over pages, repeating its heading on each. */
  const table = (spec: TableSpec) => {
    const widths = norm(spec.cols, CW);
    const headH = (spec.head?.length ?? 0) * HEAD_H;
    const bandH = spec.title ? BAND_H : 0;
    const heights = spec.rows.map((r) => rowHeight(r, spec, widths));
    ensure(bandH + headH + (heights[0] ?? 0) + 2);
    let boxTop = cur.top;
    const start = () => {
      boxTop = cur.top;
      if (spec.title) cur.top += drawBand(spec, ML, cur.top, CW);
      cur.top += drawHead(spec, widths, ML, cur.top, CW);
    };
    start();
    spec.rows.forEach((row, i) => {
      if (cur.top + heights[i] > limit) {
        border(ML, boxTop, CW, cur.top);
        newPage();
        start();
      }
      drawBodyRow(spec, row, i, widths, ML, cur.top, CW, heights[i]);
      cur.top += heights[i];
    });
    border(ML, boxTop, CW, cur.top);
    cur.top += GAP;
  };

  /** A box of a fixed size at a given spot (for the side-by-side allocation tables). */
  const boxHeightOf = (spec: TableSpec, w: number) => {
    const widths = norm(spec.cols, w);
    return (spec.title ? BAND_H : 0) + (spec.head?.length ?? 0) * HEAD_H + spec.rows.reduce((a, r) => a + rowHeight(r, spec, widths), 0);
  };
  const staticBox = (spec: TableSpec, x: number, top: number, w: number) => {
    const widths = norm(spec.cols, w);
    let t = top;
    if (spec.title) t += drawBand(spec, x, t, w);
    t += drawHead(spec, widths, x, t, w);
    spec.rows.forEach((row, i) => {
      const h = rowHeight(row, spec, widths);
      drawBodyRow(spec, row, i, widths, x, t, w, h);
      t += h;
    });
    border(x, top, w, t);
    return t - top;
  };

  /** Boxed block of wrapped text (the advisor's note). */
  const textBox = (title: string, text: string) => {
    const lines = wrapT(T(text), 8.6, false, CW - 2 * PAD - 6);
    const lead = 12;
    ensure(BAND_H + lead * 2 + 14);
    let boxTop = cur.top;
    const spec: TableSpec = { title, cols: [{ w: 1, al: "l" }], rows: [] };
    cur.top += drawBand(spec, ML, cur.top, CW);
    cur.top += 6;
    for (const l of lines) {
      if (cur.top + lead + 6 > limit) {
        border(ML, boxTop, CW, cur.top + 4);
        newPage();
        boxTop = cur.top;
        cur.top += 6;
      }
      put(l, ML + PAD + 3, cur.top + 8, 8.6, false, INK);
      cur.top += lead;
    }
    cur.top += 6;
    border(ML, boxTop, CW, cur.top);
    cur.top += GAP;
  };

  // ── numbers/format helpers used below ──
  const risk = p.riskRating ? String(p.riskRating) : highestRisk(mf.map((m) => m.risk));
  const riskometer = (x: number, top: number, w: number, h: number) => {
    const bw = 150;
    const bx = x + (w - bw) / 2;
    const by = top + h / 2 - 3;
    const seg = bw / 5;
    const cols = [c(125, 190, 66), c(181, 211, 52), c(240, 179, 35), c(235, 140, 40), c(200, 76, 70)];
    cols.forEach((col, i) => cur.page.drawRectangle({ x: bx + i * seg, y: PH - by - 7.7, width: seg + 0.2, height: 7.7, color: col }));
    put("Riskometer", bx, top + 6.4, 4.8, true, INK);
    put("Conservative", bx, by + 17, 4.6, false, c(90, 140, 90));
    const mid = "Moderate / Aggressive";
    put(mid, bx + bw * 0.5 - tw(mid, 4.6) / 2 + 6, by + 17, 4.6, false, c(235, 140, 40));
    put("Aggressive", bx + bw - tw("Aggressive", 4.6), by + 17, 4.6, false, c(110, 120, 150));
    const idx = riskIndex(risk);
    if (idx != null) {
      const mx = bx + idx * seg + seg / 2;
      cur.page.drawSvgPath("M0 0 L6 0 L3 5 Z", { x: mx - 3, y: PH - (by - 6), color: NAVY });
    }
  };

  // ── Advisor's note ──
  if (p.coverLetter && p.coverLetter.trim()) textBox("Note from your advisor:", p.coverLetter);

  // ═══════════════ MUTUAL FUNDS ═══════════════
  if (hasMf) {
    const totalInvested = mf.reduce((s, m) => s + m.invested, 0);
    const totalFv = mf.reduce((s, m) => s + m.fv, 0);
    const totalMonthly = mf.reduce((s, m) => s + m.monthly, 0);
    const totalLump = mf.reduce((s, m) => s + m.lumpsum, 0);
    const wRet = totalInvested > 0 ? mf.reduce((s, m) => s + m.ret * m.invested, 0) / totalInvested : 0;
    const maxYears = Math.max(...mf.map((m) => m.years), 0);

    // Particulars
    {
      const cols: ColSpec[] = [{ w: 151, al: "c" }];
      const head: Cell[] = ["Investor Name"];
      const row: Cell[] = [{ t: p.recipientName ?? "-", b: true, size: 8.6 }];
      if (hasSip) {
        cols.push({ w: 147, al: "c" });
        head.push("SIP Inv. Amt.");
        row.push({ t: `₹${inr(totalMonthly)}`, b: true, size: 8.6 });
      }
      if (hasLump) {
        cols.push({ w: 147, al: "c" });
        head.push("Lumpsum Inv. Amt.");
        row.push({ t: `₹${inr(totalLump)}`, b: true, size: 8.6 });
      }
      cols.push({ w: 70, al: "c" }, { w: 258, al: "c" }, { w: 351, al: "c" });
      head.push("Period", "Expected Returns", "Risk Profile");
      row.push(
        { t: maxYears ? `${trim(maxYears)} Years` : "-", b: true, size: 8.6 },
        { t: "Custom Expected Returns", b: true, size: 8.6 },
        { t: "", draw: riskometer }
      );
      table({ title: "Particulars", titleAl: "c", cols, head: [head], rows: [{ cells: row, minH: 29.5, noDots: true }] });
    }

    // Suggested schemes
    {
      const cols: ColSpec[] = [
        { w: 256, al: "l" }, { w: 127, al: "l" }, { w: 78, al: "l" }, { w: 47, al: "r" }, { w: 123, al: "r" },
      ];
      const head: Cell[] = ["Scheme", "Category", "Risk Profile", "Period", "Expected Ret (%)*"];
      if (hasLump) {
        cols.push({ w: 120, al: "r" });
        head.push("Lumpsum Amt (₹)");
      }
      if (hasSip) {
        cols.push({ w: 130, al: "r" });
        head.push("Monthly SIP Amt (₹)");
      }
      cols.push({ w: 120, al: "r" }, { w: 96, al: "r" });
      head.push("Total Invested (₹)", "Allocation (%)");
      const rows: Row[] = mf.map((m) => {
        const r: Cell[] = [m.name, m.category || "-", m.risk || "-", m.years ? `${trim(m.years)} Yrs` : "-", m.ret ? m.ret.toFixed(2) : "-"];
        if (hasLump) r.push(m.lumpsum ? inr(m.lumpsum) : "-");
        if (hasSip) r.push(m.monthly ? inr(m.monthly) : "-");
        r.push(inr(m.invested), totalInvested ? pct2((m.invested / totalInvested) * 100) : "-");
        return { cells: r };
      });
      const gt: Cell[] = [{ t: "Grand Total:", span: 4, al: "r", b: true }, ""];
      const ex: Cell[] = [{ t: "Expected Return (%):", span: 4, al: "r", b: true }, { t: wRet ? wRet.toFixed(2) : "-", b: true }];
      if (hasLump) {
        gt.push({ t: inr(totalLump), b: true });
        ex.push("");
      }
      if (hasSip) {
        gt.push({ t: inr(totalMonthly), b: true });
        ex.push("");
      }
      gt.push({ t: inr(totalInvested), b: true }, { t: "100.00", b: true });
      ex.push({ t: totalFv > 0 ? inr(totalFv) : "-", b: true }, "");
      rows.push({ cells: gt, fill: ZEBRA, minH: 22 }, { cells: ex, fill: ZEBRA, minH: 22 });
      table({
        title: hasSip && !hasLump ? "Suggested SIP Schemes:" : hasLump && !hasSip ? "Suggested Lumpsum Schemes:" : "Suggested Schemes:",
        cols, head: [head], rows, zebra: true,
      });
    }

    // Trailing returns + historical SIP (only for schemes with NAV history)
    const withData = mf.filter((m) => analytics.get(cleanCode(m.code)));
    if (withData.length) {
      const f = (v: number | null) => (v == null ? "-" : v.toFixed(2));
      table({
        title: "Trailing Returns:",
        cols: [
          { w: 277, al: "l" }, { w: 160, al: "l" }, { w: 100, al: "r" },
          { w: 110, al: "r" }, { w: 110, al: "r" }, { w: 110, al: "r" }, { w: 110, al: "r" },
        ],
        head: [
          ["", "", "", "1 Yr", "3 Yrs", "5 Yrs", "10 Yrs"],
          ["Scheme", "Category", "Incep Date", "Ret (%)", "Ret (%)", "Ret (%)", "Ret (%)"],
        ],
        rows: withData.map((m) => {
          const a = analytics.get(cleanCode(m.code))!;
          return { cells: [m.name, m.category || "-", a.inceptionDate ? dmy(a.inceptionDate) : "-", f(a.returns.y1), f(a.returns.y3), f(a.returns.y5), f(a.returns.y10)] };
        }),
        zebra: true,
      });

      // Growth of Rs. 10,000 monthly SIP (historical)
      const periods: Array<[string, keyof SchemeAnalytics["sip"], RGB]> = [["1 Yr", "y1", G1], ["3 Yrs", "y3", G3], ["5 Yrs", "y5", G5], ["10 Yrs", "y10", G10]];
      const anySip = withData.some((m) => {
        const a = analytics.get(cleanCode(m.code))!;
        return periods.some(([, k]) => a.sip[k]);
      });
      if (anySip) {
        const cols: ColSpec[] = [{ w: 224, al: "l" }];
        const h1: Cell[] = [""];
        const h2: Cell[] = ["Scheme Name"];
        for (const [lbl, , fill] of periods) {
          for (let i = 0; i < 3; i++) cols.push({ w: 62.7, al: "r" });
          h1.push({ t: lbl, span: 3, al: "c", fill });
          h2.push({ t: "Tot SIP Inv", fill }, { t: "Curr Value", fill }, { t: "XIRR (%)", fill });
        }
        table({
          title: "Growth of Rs. 10,000 Monthly SIP - (Historical Return)",
          cols,
          head: [h1, h2],
          rows: withData.map((m) => {
            const a = analytics.get(cleanCode(m.code))!;
            const cells: Cell[] = [m.name];
            for (const [, k, fill] of periods) {
              const h = a.sip[k];
              cells.push(
                { t: h ? inr(h.invested) : "-", fill },
                { t: h ? inr(h.value) : "-", fill },
                { t: h && h.xirr != null ? h.xirr.toFixed(2) : "-", fill }
              );
            }
            return { cells };
          }),
        });
      }
    }

    // What-if top-up (SIP part only)
    const sipItems = mf.filter((m) => m.monthly > 0 && m.years > 0);
    if (sipItems.length) {
      const sipYears = Math.max(...sipItems.map((m) => m.years));
      const sipTotal = sipItems.reduce((s, m) => s + m.monthly, 0);
      const sipRet = sipTotal > 0 ? sipItems.reduce((s, m) => s + m.ret * m.monthly, 0) / sipTotal : 0;
      const calc = (topUp: number) =>
        sipItems.reduce(
          (a, m) => {
            const r = stepUpSip(m.monthly, m.ret, m.years, topUp);
            return { invested: a.invested + r.invested, fv: a.fv + r.futureValue };
          },
          { invested: 0, fv: 0 }
        );
      const base = calc(0);
      table({
        title: `What if scenario @ ${sipRet.toFixed(2)}% expected return - ${trim(sipYears)} Years`,
        cols: [
          { w: 203, al: "l" }, { w: 131, al: "r" }, { w: 141, al: "r" }, { w: 84, al: "r" }, { w: 116, al: "r" }, { w: 164, al: "r" }, { w: 138, al: "r" },
        ],
        head: [["Top-up", "Initial SIP Amount", "Total Amount Invested", "Total Growth", "Total Future Value", "Enhanced Growth Amount", "Enhanced Growth (%)"]],
        rows: [0, 5, 10, 15].map((t) => {
          const r = calc(t);
          const extra = r.fv - base.fv;
          return {
            cells: [
              { parts: [{ t: "SIP Amount " }, { t: t === 0 ? "Without Top-up" : `With ${t}% Annual Top-up`, b: true }] },
              inr(sipTotal), inr(r.invested), inr(r.fv - r.invested), inr(r.fv),
              { t: t === 0 ? "-" : inr(extra), b: t !== 0, size: t === 0 ? SZ : 9.2 },
              { t: t === 0 || base.fv <= 0 ? "-" : pct2((extra / base.fv) * 100), b: t !== 0, size: t === 0 ? SZ : 9.2 },
            ] as Cell[],
            minH: 22.5,
          };
        }),
      });
    }

    // Allocation tables, side by side
    const group = (keyOf: (m: McItem) => string) => {
      const map = new Map<string, number>();
      for (const m of mf) map.set(keyOf(m) || "Other", (map.get(keyOf(m) || "Other") ?? 0) + m.invested);
      const all = [...map.entries()].sort((a, b) => b[1] - a[1]);
      if (all.length <= 12) return all;
      const rest = all.slice(11).reduce((s, [, v]) => s + v, 0);
      return [...all.slice(0, 11), ["Others", rest] as [string, number]];
    };
    if (totalInvested > 0) {
      const allocSpec = (title: string, head: string, entries: Array<[string, number]>): TableSpec => ({
        title,
        cols: [{ w: 38, al: "l" }, { w: 31, al: "r" }, { w: 31, al: "r" }],
        head: [[head, "Amount (₹)", "Allocation (%)"]],
        rows: [
          ...entries.map(([k, v]) => ({ cells: [k, inr(v), pct2((v / totalInvested) * 100)] as Cell[] })),
          { cells: [{ t: "Grand Total:", b: true }, { t: inr(totalInvested), b: true }, { t: "100.00", b: true }] as Cell[], fill: WHITE, minH: 22 },
        ],
        zebra: true,
      });
      const specs = [
        allocSpec("AMC Allocation:", "AMC", group((m) => m.amc)),
        allocSpec("Asset Allocation:", "Asset Allocation", group((m) => assetClassOf(m.category))),
        allocSpec("Category Allocation:", "Category", group((m) => m.category)),
      ];
      const gap = 4;
      const bw = (CW - 2 * gap) / 3;
      const tallest = Math.max(...specs.map((s) => boxHeightOf(s, bw)));
      ensure(tallest + 2);
      const top = cur.top;
      specs.forEach((s, i) => staticBox(s, ML + i * (bw + gap), top, bw));
      cur.top = top + tallest + GAP;
    }
  }

  // ═══════════════ INSURANCE / PMS / AIF ═══════════════
  const others: Record<string, any[]> = {};
  for (const it of products) if (it?.kind && it.kind !== "mf") (others[it.kind] ??= []).push(it);
  for (const [kind, items] of Object.entries(others)) {
    const cols = pruneEmptyCols(colsFor(kind), items);
    table({
      title: `${KIND_TITLE[kind] ?? kind}:`,
      cols: cols.map((x) => ({ w: x.w, al: (x.align === "r" ? "r" : "l") as Al })),
      head: [cols.map((x) => x.h)],
      rows: items.map((it) => ({ cells: cols.map((x) => (isBlankCell(x.get(it)) ? "-" : String(x.get(it)))) })),
      zebra: true,
    });
  }
  if (products.length === 0) {
    ensure(24);
    put("No products have been added to this proposal yet.", ML, cur.top + 8, 9, false, GREY);
    cur.top += 20;
  }
  if (p.validUntil) {
    ensure(20);
    put(`This proposal is valid until ${dmy(p.validUntil)}.`, ML, cur.top + 8, 8.6, false, INK);
    cur.top += 16;
  }

  // ═══════════════ DISCLAIMER PAGE ═══════════════
  newPage();
  {
    const x0 = 48.5;
    const width = 744;
    const size = 8.4;
    const lead = 14.3;
    type Run = { t: string; b?: boolean };
    const paragraph = (runs: Run[], gapAfter: number) => {
      const words: Array<{ w: string; b: boolean }> = [];
      for (const r of runs) for (const w of T(r.t).split(/\s+/).filter(Boolean)) words.push({ w, b: !!r.b });
      const lines: Array<typeof words> = [];
      let line: typeof words = [];
      let lw = 0;
      const sp = tw(" ", size);
      for (const wd of words) {
        const w = tw(wd.w, size, wd.b);
        if (line.length && lw + sp + w > width) {
          lines.push(line);
          line = [];
          lw = 0;
        }
        lw += (line.length ? sp : 0) + w;
        line.push(wd);
      }
      if (line.length) lines.push(line);
      lines.forEach((ln, i) => {
        ensure(lead);
        const natural = ln.reduce((a, wd) => a + tw(wd.w, size, wd.b), 0);
        const last = i === lines.length - 1;
        const space = !last && ln.length > 1 ? (width - natural) / (ln.length - 1) : sp;
        let x = x0;
        for (const wd of ln) {
          put(wd.w, x, cur.top + 9, size, wd.b, wd.b ? c(85, 85, 85) : c(105, 105, 105));
          x += tw(wd.w, size, wd.b) + space;
        }
        cur.top += lead;
      });
      cur.top += gapAfter;
    };
    cur.top += 6;
    paragraph([{ t: "Disclaimer : ", b: true }, { t: LONG_DISCLAIMER_1 }], 3);
    paragraph([{ t: LONG_DISCLAIMER_2 }], 0);
    paragraph([{ t: LONG_DISCLAIMER_3 }], 0);
    paragraph(
      [
        { t: "Mutual Fund Investments are subject to market risks, read all scheme related documents carefully.", b: true },
        { t: " Past performance may or may not be sustained in the future. Investors should consult with their Mutual Fund Distributor or Financial Advisor before investing." },
      ],
      0
    );
  }

  return Buffer.from(await doc.save());
}

/* ── helpers ── */

const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const cleanCode = (c: string) => String(c ?? "").replace(/[^0-9A-Za-z]/g, "");
const inr = (n: number) => Math.round(n).toLocaleString("en-IN");
const pct2 = (n: number) => n.toFixed(2);

function dmy(d: string | Date): string {
  const t = new Date(d);
  if (isNaN(t.getTime())) return "-";
  const dd = String(t.getDate()).padStart(2, "0");
  const mm = String(t.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${t.getFullYear()}`;
}

/** Address as printed lines: street, then locality / city - pincode. */
function addressLines(a: ReportBrand["address"]): string[] {
  if (!a) return [];
  if (typeof a === "string") return a.trim() ? [a.trim()] : [];
  const second = [a.line2, [a.city, a.pincode].filter(Boolean).join(" - ")].filter(Boolean).join(",");
  return [a.line1, second].filter((x): x is string => !!x && x.trim().length > 0);
}

function roundedRect(w: number, h: number, r: number): string {
  return `M${r} 0 H${w - r} Q${w} 0 ${w} ${r} V${h - r} Q${w} ${h} ${w - r} ${h} H${r} Q0 ${h} 0 ${h - r} V${r} Q0 0 ${r} 0 Z`;
}

const RISK_ORDER = ["low", "low to moderate", "moderate", "moderately high", "high", "very high"];
function highestRisk(risks: string[]): string {
  let best = "";
  let bi = -1;
  for (const r of risks) {
    const i = RISK_ORDER.indexOf(r.trim().toLowerCase());
    if (i > bi) {
      bi = i;
      best = r;
    }
  }
  return best;
}

/** Position (0-4) on the riskometer for a risk-profile / risk-rating text. */
export function riskIndex(text: string | null | undefined): number | null {
  const t = (text ?? "").trim().toLowerCase();
  if (!t) return null;
  if (/moderately (high|aggressive)/.test(t)) return 3;
  if (/very high|aggressive|^high/.test(t)) return 4;
  if (/low to moderate|moderately (low|conservative)/.test(t)) return 1;
  if (/moderate|balanced/.test(t)) return 2;
  if (/conservative|^low/.test(t)) return 0;
  return null;
}

function absUrl(url: string): string {
  if (/^(https?:|data:)/i.test(url)) return url;
  const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "").replace(/\/+$/, "");
  return base ? `${base}${url.startsWith("/") ? "" : "/"}${url}` : url;
}
async function embedLogo(doc: PDFDocument, rawUrl?: string | null): Promise<PDFImage | null> {
  if (!rawUrl) return null;
  try {
    const res = await fetch(absUrl(rawUrl), { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (ct.includes("png")) return await doc.embedPng(bytes);
    if (ct.includes("jpeg") || ct.includes("jpg")) return await doc.embedJpg(bytes);
    try { return await doc.embedPng(bytes); } catch {}
    try { return await doc.embedJpg(bytes); } catch {}
    return null;
  } catch {
    return null;
  }
}
