/**
 * The proposal as an "Investment Analysis & Performance Report" - the layout the firm
 * sends to clients:
 *
 *   1. Cover page   - prepared for / by, contact, website, report date, disclaimer.
 *   2. Particulars  - investor, SIP / lumpsum amount, period, expected return, risk.
 *   3. Suggested schemes - category, risk, period, return, amounts, allocation, with a
 *                    grand total and the projected value.
 *   4. Trailing returns and the historical return of a monthly SIP (XIRR) - worked out
 *                    from each scheme's NAV history. Left out for a scheme whose
 *                    history cannot be fetched.
 *   5. "What if" the SIP is topped up 5 / 10 / 15% a year.
 *   6. Allocation by AMC, asset class and category.
 *   7. Insurance / PMS / AIF items, as before, in the same format.
 *   8. Disclaimer page.
 *
 * Not included: scheme AUM, peer rank, and the top-10 sector / holdings tables - those
 * need a fund-data provider the CRM does not have.
 */

import { PDFDocument, rgb, type PDFFont, type PDFPage, type PDFImage, type RGB } from "pdf-lib";
import { drawContinuationHeader, drawPageNumbers } from "@/lib/pdf/report-header";
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

const INK: RGB = rgb(0.06, 0.09, 0.16);
const SLATE: RGB = rgb(0.2, 0.255, 0.333);
const MUTED: RGB = rgb(0.45, 0.5, 0.58);
const GREEN: RGB = rgb(0.02, 0.6, 0.41);
const LINE: RGB = rgb(0.89, 0.91, 0.94);
const HEADBG: RGB = rgb(0.95, 0.96, 0.98);
const TOTALBG: RGB = rgb(0.97, 0.98, 0.99);
const WHITE: RGB = rgb(1, 1, 1);
const DEFAULT_PRIMARY: RGB = rgb(0.055, 0.145, 0.341);

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 40;

const MF_DISCLAIMER =
  "Mutual Fund Investments are subject to market risks, read all scheme related documents carefully. Past performance may or may not be sustained in the future. Investors should consult with their Mutual Fund Distributor or Financial Advisor before investing.";

const LONG_DISCLAIMER = [
  "We have gathered all the data, information, statistics from the sources believed to be highly reliable and true. All necessary precautions have been taken to avoid any error, lapse or insufficiency; however, no representations or warranties are made (express or implied) as to the reliability, accuracy or completeness of such information. We cannot be held liable for any loss arising directly or indirectly from the use of, or any action taken on, any information appearing herein. The user is advised to verify the contents of the report independently. It is not an Investment recommendation or personal financial, Investment or professional advice and should not be treated as such.",
  "The Risk Level of any of the schemes must always be commensurate with the risk profile, Investment objective or financial goals of the investor concerned. Therefore, the Investors should assess their risk profile before making any Investment decision and consider the asset allocation accordingly.",
  "Returns less than 1 year are in absolute (%) and greater than 1 year are compounded annualised (CAGR %). SIP returns are shown in XIRR (%). Expected returns are assumptions supplied for illustration and are not guaranteed.",
  MF_DISCLAIMER,
];

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

type TCol = { h: string; w: number; align?: "l" | "r" };

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
  const { font: helv, bold, rupeeOk } = await embedPdfFonts(doc);
  const T = (s: string | null | undefined) => pdfSanitize(String(s ?? "").replace(/·/g, "-"), rupeeOk);
  const primary = hexToRgb(brand.primaryColor);
  const firm = brand.legalName ?? brand.displayName ?? "Your Advisor";
  const arnText = brand.arn ? `ARN-${String(brand.arn).replace(/^ARN[-:\s]*/i, "")}` : "";

  doc.setTitle(T(`Investment report ${p.proposalNumber ?? ""} - ${p.recipientName ?? "Client"}`));
  doc.setProducer("Equitywala");
  doc.setAuthor(T(firm));
  if (p.proposalNumber) doc.setSubject(`Ref ${p.proposalNumber}`);

  const logo = await embedLogo(doc, brand.logoUrl);
  const W = A4[0];
  const usable = W - 2 * MARGIN;

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
  const reportTitle = hasMf ? ["INVESTMENT ANALYSIS", "& PERFORMANCE REPORT"] : ["INVESTMENT", "PROPOSAL"];
  const subtitle = hasMf ? `Investment Presentation - ${kindLabel}` : p.title || "Investment Proposal";
  const reportDate = dmy(generatedAt);

  // NAV-history analytics (best effort; sections quietly drop out without them).
  const analytics =
    args.analytics ?? (hasMf ? await loadSchemeAnalytics(mf.map((m) => m.code).filter(Boolean)) : new Map<string, SchemeAnalytics>());

  // ─────────────────────────── page flow ───────────────────────────
  const cover = doc.addPage(A4);
  const cur = { page: doc.addPage(A4), y: 0 };
  const newPage = () => {
    cur.page = doc.addPage(A4);
    cur.y = drawContinuationHeader({
      page: cur.page, helv, bold, pageWidth: W, pageHeight: A4[1], margin: MARGIN,
      firmName: firm, title: "Investment report", primary,
    });
  };
  const ensure = (need: number) => {
    if (cur.y - need < 96) newPage();
  };

  // ═══════════════ COVER ═══════════════
  {
    const H = A4[1];
    let y = H - MARGIN;
    if (logo) {
      const maxH = 52, maxW = 200;
      let dw = (logo.width / logo.height) * maxH, dh = maxH;
      if (dw > maxW) { dw = maxW; dh = (logo.height / logo.width) * maxW; }
      cover.drawImage(logo, { x: MARGIN, y: y - dh, width: dw, height: dh });
      y -= dh;
    } else {
      cover.drawText(T(firm), { x: MARGIN, y: y - 16, size: 16, font: bold, color: INK });
      y -= 24;
    }
    // colour band with the title
    const bandH = 140, bandY = y - 40 - bandH;
    cover.drawRectangle({ x: 0, y: bandY, width: W, height: bandH, color: primary });
    cover.drawText(reportTitle[0], { x: MARGIN, y: bandY + bandH - 52, size: 26, font: bold, color: WHITE });
    cover.drawText(reportTitle[1], { x: MARGIN, y: bandY + bandH - 82, size: 26, font: bold, color: WHITE });
    cover.drawText(T(subtitle), { x: MARGIN, y: bandY + 22, size: 13, font: helv, color: WHITE });

    let cy = bandY - 40;
    const label = (txt: string, x: number, yy: number) =>
      cover.drawText(spaced(txt), { x, y: yy, size: 7.5, font: bold, color: MUTED });
    const block = (title: string, lines: Array<{ t: string; size?: number; bold?: boolean }>, x: number, y0: number, width: number) => {
      label(title, x, y0);
      let yy = y0 - 16;
      for (const l of lines) {
        for (const w of wrap(T(l.t), l.bold ? bold : helv, l.size ?? 9.5, width)) {
          cover.drawText(w, { x, y: yy, size: l.size ?? 9.5, font: l.bold ? bold : helv, color: l.bold ? INK : SLATE });
          yy -= (l.size ?? 9.5) + 4;
        }
      }
      return yy;
    };
    const colW = (usable - 30) / 2;
    const left = block("PREPARED FOR", [{ t: p.recipientName ?? "Client", size: 18, bold: true }], MARGIN, cy, colW);
    const right = block(
      "PREPARED BY",
      [
        { t: firm, size: 11, bold: true },
        ...(brand.arn ? [{ t: `AMFI Registered Mutual Fund Distributor (${arnText})` }] : []),
      ],
      MARGIN + colW + 30, cy, colW
    );
    cy = Math.min(left, right) - 22;

    const addr = addressLine(brand.address);
    const contact: Array<{ t: string }> = [];
    if (brand.phone) contact.push({ t: `Phone: ${brand.phone}` });
    if (brand.email) contact.push({ t: `Email: ${brand.email}` });
    if (addr) contact.push({ t: addr });
    const leftEnd = contact.length ? block("CONTACT", contact, MARGIN, cy, colW) : cy;
    const rightEnd = block(
      "REPORT DATE",
      [{ t: reportDate, size: 12, bold: true }],
      MARGIN + colW + 30, cy, colW
    );
    cy = Math.min(leftEnd, rightEnd) - 22;
    if (brand.website) cy = block("WEBSITE", [{ t: brand.website }], MARGIN, cy, colW) - 10;

    // disclaimer pinned to the foot of the cover
    cover.drawRectangle({ x: MARGIN, y: 112, width: usable, height: 0.8, color: LINE });
    let dy = 98;
    for (const l of wrap(T(`Disclaimer: ${MF_DISCLAIMER}`), helv, 7.5, usable)) {
      cover.drawText(l, { x: MARGIN, y: dy, size: 7.5, font: helv, color: MUTED });
      dy -= 10;
    }
  }

  // ═══════════════ BODY, page 1: letterhead ═══════════════
  {
    const H = A4[1];
    let y = H - MARGIN;
    if (logo) {
      const maxH = 34, maxW = 150;
      let dw = (logo.width / logo.height) * maxH, dh = maxH;
      if (dw > maxW) { dw = maxW; dh = (logo.height / logo.width) * maxW; }
      cur.page.drawImage(logo, { x: MARGIN, y: y - dh, width: dw, height: dh });
    } else {
      cur.page.drawText(T(firm).toUpperCase(), { x: MARGIN, y: y - 12, size: 12, font: bold, color: primary });
    }
    // contact block, right aligned
    const right: string[] = [];
    if (brand.arn) right.push(`AMFI Registered Mutual Fund Distributor (${arnText})`);
    const addr = addressLine(brand.address);
    if (addr) right.push(addr);
    const pe = [brand.phone ? `Phone: ${brand.phone}` : "", brand.email ? `Email: ${brand.email}` : ""].filter(Boolean).join(" | ");
    if (pe) right.push(pe);
    if (brand.website) right.push(brand.website);
    let ry = y - 8;
    for (const l of right) {
      const t = T(l);
      cur.page.drawText(t, { x: W - MARGIN - helv.widthOfTextAtSize(t, 7.5), y: ry, size: 7.5, font: helv, color: SLATE });
      ry -= 10;
    }
    const lineY = Math.min(y - (logo ? 40 : 22), ry) - 4;
    cur.page.drawRectangle({ x: MARGIN, y: lineY, width: usable, height: 1.4, color: primary });
    cur.y = lineY - 22;
  }

  // ── helpers that draw into the flow ──
  const heading = (text: string, size = 9) => {
    ensure(40);
    cur.page.drawText(T(text).toUpperCase(), { x: MARGIN, y: cur.y, size, font: bold, color: primary });
    cur.y -= size + 7;
  };
  const para = (text: string, size = 8, color: RGB = SLATE, gap = 3) => {
    for (const l of wrap(T(text), helv, size, usable)) {
      ensure(size + gap + 2);
      cur.page.drawText(l, { x: MARGIN, y: cur.y, size, font: helv, color });
      cur.y -= size + gap;
    }
  };

  /** A table whose columns are fractions of the page width. Rows may wrap onto 2-3 lines. */
  const table = (cols: TCol[], rows: string[][], opts: { boldLast?: boolean; size?: number } = {}) => {
    const size = opts.size ?? 7.8;
    const pad = 4;
    const widths = cols.map((c) => c.w * usable);
    const headLines = cols.map((c, i) => wrap(T(c.h), bold, 6.6, widths[i] - pad * 2).slice(0, 3));
    const headH = Math.max(...headLines.map((l) => l.length)) * 8 + 8;
    const drawHead = () => {
      ensure(headH + 14);
      cur.page.drawRectangle({ x: MARGIN, y: cur.y - headH + 6, width: usable, height: headH, color: HEADBG });
      let x = MARGIN;
      cols.forEach((c, i) => {
        headLines[i].forEach((ln, k) => {
          const w = bold.widthOfTextAtSize(ln, 6.6);
          cur.page.drawText(ln, { x: c.align === "r" ? x + widths[i] - pad - w : x + pad, y: cur.y - 2 - k * 8, size: 6.6, font: bold, color: MUTED });
        });
        x += widths[i];
      });
      cur.y -= headH + 3;
    };
    drawHead();
    rows.forEach((row, ri) => {
      const last = opts.boldLast && ri === rows.length - 1;
      const f = last ? bold : helv;
      const cells = row.map((v, i) =>
        cols[i].align === "r" ? [T(v)] : wrap(T(v), f, size, widths[i] - pad * 2).slice(0, 3)
      );
      const rowH = Math.max(...cells.map((c) => c.length)) * (size + 3) + 5;
      const before = cur.page;
      ensure(rowH + 4);
      if (cur.page !== before) drawHead();
      if (last) cur.page.drawRectangle({ x: MARGIN, y: cur.y - rowH + size + 1, width: usable, height: rowH, color: TOTALBG });
      let x = MARGIN;
      cols.forEach((c, i) => {
        cells[i].forEach((ln, k) => {
          if (c.align === "r") {
            const s = fitText(ln, f, size, widths[i] - pad * 2, 5.5);
            cur.page.drawText(ln, { x: x + widths[i] - pad - f.widthOfTextAtSize(ln, s), y: cur.y - k * (size + 3), size: s, font: f, color: INK });
          } else {
            cur.page.drawText(ln, { x: x + pad, y: cur.y - k * (size + 3), size, font: i === 0 || last ? bold : helv, color: INK });
          }
        });
        x += widths[i];
      });
      cur.page.drawRectangle({ x: MARGIN, y: cur.y - rowH + size - 1, width: usable, height: 0.5, color: LINE });
      cur.y -= rowH;
    });
    cur.y -= 10;
  };

  // ── Report heading ──
  cur.page.drawText(T(`${subtitle}${hasMf ? "" : ""}`), { x: MARGIN, y: cur.y, size: 12, font: bold, color: INK });
  {
    const rd = `Report as on: ${reportDate}`;
    cur.page.drawText(rd, { x: W - MARGIN - helv.widthOfTextAtSize(rd, 8.5), y: cur.y, size: 8.5, font: helv, color: SLATE });
  }
  cur.y -= 22;

  if (p.coverLetter && p.coverLetter.trim()) {
    heading("Note from your advisor");
    para(p.coverLetter, 8.5, SLATE, 4);
    cur.y -= 8;
  }

  // ═══════════════ MUTUAL FUNDS ═══════════════
  if (hasMf) {
    const totalInvested = mf.reduce((s, m) => s + m.invested, 0);
    const totalFv = mf.reduce((s, m) => s + m.fv, 0);
    const totalMonthly = mf.reduce((s, m) => s + m.monthly, 0);
    const totalLump = mf.reduce((s, m) => s + m.lumpsum, 0);
    const wRet = totalInvested > 0 ? mf.reduce((s, m) => s + m.ret * m.invested, 0) / totalInvested : 0;
    const maxYears = Math.max(...mf.map((m) => m.years), 0);
    const risk = p.riskRating ? String(p.riskRating) : highestRisk(mf.map((m) => m.risk));

    // Particulars
    heading("Particulars");
    {
      const cols: TCol[] = [{ h: "Investor Name", w: 0.30 }];
      const row: string[] = [p.recipientName ?? "-"];
      if (hasSip) { cols.push({ h: "SIP Inv. Amt. (₹)", w: 0.16, align: "r" }); row.push(inr(totalMonthly)); }
      if (hasLump) { cols.push({ h: "Lumpsum Inv. Amt. (₹)", w: 0.16, align: "r" }); row.push(inr(totalLump)); }
      cols.push({ h: "Period", w: 0.12, align: "r" }); row.push(maxYears ? `${trim(maxYears)} Years` : "-");
      cols.push({ h: "Expected Returns", w: 0.14, align: "r" }); row.push(wRet ? `${wRet.toFixed(2)}%` : "-");
      cols.push({ h: "Risk Profile", w: 0.16, align: "r" }); row.push(risk || "-");
      const sum = cols.reduce((a, c) => a + c.w, 0);
      table(cols.map((c) => ({ ...c, w: c.w / sum })), [row]);
    }

    // Suggested schemes
    heading(hasSip && !hasLump ? "Suggested SIP Schemes" : hasLump && !hasSip ? "Suggested Lumpsum Schemes" : "Suggested Schemes");
    {
      const cols: TCol[] = [
        { h: "Scheme", w: 0.25 },
        { h: "Category", w: 0.15 },
        { h: "Risk Profile", w: 0.09 },
        { h: "Period", w: 0.07, align: "r" },
        { h: "Expected Ret (%)*", w: 0.09, align: "r" },
      ];
      if (hasLump) cols.push({ h: "Lumpsum (₹)", w: 0.10, align: "r" });
      if (hasSip) cols.push({ h: "Monthly SIP Amt (₹)", w: 0.10, align: "r" });
      cols.push({ h: "Total Invested (₹)", w: 0.11, align: "r" }, { h: "Allocation (%)", w: 0.09, align: "r" });
      const sum = cols.reduce((a, c) => a + c.w, 0);
      const rows = mf.map((m) => {
        const r = [m.name, m.category || "-", m.risk || "-", m.years ? `${trim(m.years)} Yrs` : "-", m.ret ? m.ret.toFixed(2) : "-"];
        if (hasLump) r.push(m.lumpsum ? inr(m.lumpsum) : "-");
        if (hasSip) r.push(m.monthly ? inr(m.monthly) : "-");
        r.push(inr(m.invested), totalInvested ? pct2((m.invested / totalInvested) * 100) : "-");
        return r;
      });
      const totalRow = ["Grand Total:", "", "", "", ""];
      if (hasLump) totalRow.push(inr(totalLump));
      if (hasSip) totalRow.push(inr(totalMonthly));
      totalRow.push(inr(totalInvested), "100.00");
      table(cols.map((c) => ({ ...c, w: c.w / sum })), [...rows, totalRow], { boldLast: true });
      if (totalFv > 0) {
        ensure(24);
        const s1 = `Expected Return (%): ${wRet ? wRet.toFixed(2) : "-"}`;
        const s2 = `Projected value: ${inr(totalFv)}`;
        cur.page.drawText(T(s1), { x: MARGIN, y: cur.y, size: 9, font: bold, color: INK });
        cur.page.drawText(T(s2), { x: MARGIN + 190, y: cur.y, size: 9, font: bold, color: GREEN });
        cur.y -= 14;
      }
      para("* Expected returns are assumptions for illustration and are not guaranteed. Projected values compound the monthly SIP and any lumpsum at the expected return.", 7, MUTED);
      cur.y -= 6;
    }

    // Trailing returns + historical SIP (only for schemes with NAV history)
    const withData = mf.filter((m) => analytics.get(cleanCode(m.code)));
    if (withData.length) {
      heading("Trailing Returns");
      table(
        [
          { h: "Scheme", w: 0.34 },
          { h: "Category", w: 0.20 },
          { h: "Inception Date", w: 0.12, align: "r" },
          { h: "1 Yr Ret (%)", w: 0.085, align: "r" },
          { h: "3 Yrs Ret (%)", w: 0.085, align: "r" },
          { h: "5 Yrs Ret (%)", w: 0.085, align: "r" },
          { h: "10 Yrs Ret (%)", w: 0.085, align: "r" },
        ],
        withData.map((m) => {
          const a = analytics.get(cleanCode(m.code))!;
          const f = (v: number | null) => (v == null ? "-" : v.toFixed(2));
          return [m.name, m.category || "-", a.inceptionDate ? dmy(a.inceptionDate) : "-", f(a.returns.y1), f(a.returns.y3), f(a.returns.y5), f(a.returns.y10)];
        })
      );
      para("Returns less than 1 year are absolute; 1 year and above are compounded annualised (CAGR). Based on NAV history; past performance may or may not be sustained.", 7, MUTED);
      cur.y -= 6;

      const sipRows: string[][] = [];
      for (const m of withData) {
        const a = analytics.get(cleanCode(m.code))!;
        const per: Array<[string, keyof SchemeAnalytics["sip"]]> = [["1 Yr", "y1"], ["3 Yrs", "y3"], ["5 Yrs", "y5"], ["10 Yrs", "y10"]];
        let first = true;
        for (const [lbl, k] of per) {
          const h = a.sip[k];
          if (!h) continue;
          sipRows.push([first ? m.name : "", lbl, inr(h.invested), inr(h.value), h.xirr == null ? "-" : h.xirr.toFixed(2)]);
          first = false;
        }
      }
      if (sipRows.length) {
        heading("Growth of Rs. 10,000 Monthly SIP - Historical Return");
        table(
          [
            { h: "Scheme", w: 0.42 },
            { h: "Period", w: 0.10, align: "r" },
            { h: "Tot SIP Inv (₹)", w: 0.16, align: "r" },
            { h: "Curr Value (₹)", w: 0.16, align: "r" },
            { h: "XIRR (%)", w: 0.16, align: "r" },
          ],
          sipRows
        );
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
      heading(`What if scenario @ ${sipRet.toFixed(2)}% expected return - ${trim(sipYears)} Years`);
      table(
        [
          { h: "Top-up", w: 0.25 },
          { h: "Initial SIP Amount (₹)", w: 0.12, align: "r" },
          { h: "Total Amount Invested (₹)", w: 0.14, align: "r" },
          { h: "Total Growth (₹)", w: 0.12, align: "r" },
          { h: "Total Future Value (₹)", w: 0.14, align: "r" },
          { h: "Enhanced Growth Amount (₹)", w: 0.13, align: "r" },
          { h: "Enhanced Growth (%)", w: 0.10, align: "r" },
        ],
        [0, 5, 10, 15].map((t) => {
          const r = calc(t);
          const growth = r.fv - r.invested;
          const extra = r.fv - base.fv;
          return [
            t === 0 ? "SIP Amount Without Top-up" : `SIP Amount With ${t}% Annual Top-up`,
            inr(sipTotal), inr(r.invested), inr(growth), inr(r.fv),
            t === 0 ? "-" : inr(extra), t === 0 || base.fv <= 0 ? "-" : pct2((extra / base.fv) * 100),
          ];
        })
      );
    }

    // Allocation tables
    const group = (keyOf: (m: McItem) => string) => {
      const map = new Map<string, number>();
      for (const m of mf) map.set(keyOf(m) || "Other", (map.get(keyOf(m) || "Other") ?? 0) + m.invested);
      return [...map.entries()].sort((a, b) => b[1] - a[1]);
    };
    const allocTable = (title: string, head: string, entries: Array<[string, number]>) => {
      if (!entries.length || totalInvested <= 0) return;
      heading(title);
      table(
        [{ h: head, w: 0.55 }, { h: "Amount (₹)", w: 0.25, align: "r" }, { h: "Allocation (%)", w: 0.20, align: "r" }],
        [...entries.map(([k, v]) => [k, inr(v), pct2((v / totalInvested) * 100)]), ["Grand Total:", inr(totalInvested), "100.00"]],
        { boldLast: true }
      );
    };
    allocTable("AMC Allocation", "AMC", group((m) => m.amc));
    allocTable("Asset Allocation", "Asset Allocation", group((m) => assetClassOf(m.category)));
    allocTable("Category Allocation", "Category", group((m) => m.category));
  }

  // ═══════════════ INSURANCE / PMS / AIF ═══════════════
  const others: Record<string, any[]> = {};
  for (const it of products) if (it?.kind && it.kind !== "mf") (others[it.kind] ??= []).push(it);
  for (const [kind, items] of Object.entries(others)) {
    const cols = pruneEmptyCols(colsFor(kind), items);
    heading(KIND_TITLE[kind] ?? kind);
    table(
      cols.map((c) => ({ h: c.h, w: c.w, align: c.align })),
      items.map((it) => cols.map((c) => (isBlankCell(c.get(it)) ? "-" : String(c.get(it))))),
    );
  }
  if (products.length === 0) para("No products have been added to this proposal yet.", 9, MUTED);

  if (p.validUntil) {
    ensure(20);
    para(`This proposal is valid until ${dmy(p.validUntil)}.`, 8.5, SLATE);
  }

  // ═══════════════ DISCLAIMER PAGE ═══════════════
  newPage();
  heading("Disclaimer", 10);
  cur.y -= 4;
  for (const t of LONG_DISCLAIMER) {
    para(t, 8.5, SLATE, 4.5);
    cur.y -= 6;
  }

  // ── Footer + page numbers (not on the cover) ──
  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    if (i === 0) return;
    pg.drawRectangle({ x: MARGIN, y: 52, width: W - 2 * MARGIN, height: 1, color: LINE });
    pg.drawText(T(`${firm}${arnText ? `  -  ${arnText}` : ""}`), { x: MARGIN, y: 40, size: 8, font: bold, color: SLATE });
    const gen = T(`Generated ${dmy(generatedAt)}${p.proposalNumber ? ` - Ref ${p.proposalNumber}` : ""}`);
    pg.drawText(gen, { x: W - MARGIN - helv.widthOfTextAtSize(gen, 7.5), y: 40, size: 7.5, font: helv, color: MUTED });
    let dy = 26;
    for (const l of wrap(T(MF_DISCLAIMER), helv, 6.6, W - 2 * MARGIN).slice(0, 2)) {
      pg.drawText(l, { x: MARGIN, y: dy, size: 6.6, font: helv, color: MUTED });
      dy -= 8.5;
    }
  });
  drawPageNumbers(doc, helv, W, 8);

  return Buffer.from(await doc.save());
}

/* ── helpers ── */

const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const cleanCode = (c: string) => String(c ?? "").replace(/[^0-9A-Za-z]/g, "");
const inr = (n: number) => Math.round(n).toLocaleString("en-IN");
const pct2 = (n: number) => n.toFixed(2);
const spaced = (s: string) => s.split("").join(" ");

function dmy(d: string | Date): string {
  const t = new Date(d);
  if (isNaN(t.getTime())) return "-";
  const dd = String(t.getDate()).padStart(2, "0");
  const mm = String(t.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${t.getFullYear()}`;
}

function addressLine(a: ReportBrand["address"]): string {
  if (!a) return "";
  if (typeof a === "string") return a;
  return [a.line1, a.line2, [a.city, a.pincode].filter(Boolean).join(" - ")].filter(Boolean).join(", ");
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
function fitText(text: string, font: PDFFont, size: number, maxWidth: number, min: number): number {
  let s = size;
  while (s > min && font.widthOfTextAtSize(text, s) > maxWidth) s -= 0.5;
  return s;
}
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of (text || "").split(/\n/)) {
    let line = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const trial = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(trial, size) <= maxWidth || !line) line = trial;
      else {
        lines.push(line);
        line = w;
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}
function hexToRgb(hex: string | null | undefined): RGB {
  const m = (hex ?? "").replace(/^#/, "").match(/^([0-9a-fA-F]{6})$/);
  if (!m) return DEFAULT_PRIMARY;
  const [r, g, b] = m[1].match(/.{2}/g)!.map((x) => parseInt(x, 16) / 255);
  return rgb(r, g, b);
}
