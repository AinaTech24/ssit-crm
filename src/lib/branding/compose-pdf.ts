/**
 * Server-side PDF co-branding.
 *
 * Takes a source PDF (uploaded by an SSIT platform admin) and returns a new
 * PDF that is white-labelled for the calling MFD:
 *
 *   1. A branded COVER PAGE is prepended (logo, firm name, ARN, asset title)
 *      in one of several named styles (banner / minimal / sidebar).
 *   2. A slim FOOTER BAND is stamped on every content page:
 *        firm name · ARN · SEBI disclaimer · page X of N
 *
 * The raw S3 URL is never exposed to the MFD's browser — the only way they
 * obtain the file is via /api/content-library/[id]/branded-pdf, which always
 * stamps their tenant's branding onto it.
 *
 * Pure pdf-lib (no native deps). The standard Helvetica font is WinAnsi-only,
 * so every dynamic string is run through `ascii()` before drawing — un-
 * encodable code points would otherwise make pdf-lib throw at render time.
 */

import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  StandardFonts,
  rgb,
  type RGB,
} from "pdf-lib";
import type { BrandingTenant } from "./compose";
import type { BrandingTemplate, PdfCoverStyle } from "./templates";

export type ComposePdfOpts = {
  /** Asset title rendered on the cover page. */
  title: string;
  /** Asset category (e.g. "market_update") — shown as a small eyebrow. */
  category?: string | null;
  /**
   * Tenant logo bytes (PNG or JPG). Fetched SSRF-safely by the caller and
   * passed in; null/omitted falls back to a coloured initial tile.
   */
  logoBytes?: Buffer | Uint8Array | null;
};

const ACCENT: RGB = rgb(0.055, 0.647, 0.914); // #0ea5e9
const SLATE: RGB = rgb(0.2, 0.255, 0.333); // #334155
const MUTED: RGB = rgb(0.58, 0.64, 0.72); // #94a3b8
const WHITE: RGB = rgb(1, 1, 1);
const DEFAULT_PRIMARY: RGB = rgb(0.055, 0.145, 0.341); // #0e2557

const DISCLAIMER =
  "Mutual Fund investments are subject to market risks. Read all scheme related documents carefully.";

/**
 * Compose a co-branded PDF. Returns a Buffer ready to stream as
 * application/pdf. Never throws on a malformed source — callers should still
 * wrap defensively, but load uses lenient options.
 */
export async function composeBrandedPdf(
  sourceBuffer: Buffer | Uint8Array,
  brand: BrandingTenant,
  template: BrandingTemplate,
  opts: ComposePdfOpts
): Promise<Buffer> {
  // Encrypted/restricted sources are REJECTED (not silently re-branded) — a
  // password on the source means someone intended to restrict it. The route
  // surfaces this message as a clean 422 with a "Download original" fallback.
  let src: PDFDocument;
  try {
    src = await PDFDocument.load(sourceBuffer, {
      throwOnInvalidObject: false,
      updateMetadata: false,
    });
  } catch (e: any) {
    if (/encrypt/i.test(String(e?.message ?? ""))) {
      throw new Error("the source PDF is password-protected and can't be co-branded");
    }
    throw e;
  }

  const out = await PDFDocument.create();
  const helv = await out.embedFont(StandardFonts.Helvetica);
  const helvBold = await out.embedFont(StandardFonts.HelveticaBold);

  out.setTitle(ascii(opts.title || "Shared update"));
  out.setProducer("SSIT CRM");
  if (brand.legalName || brand.displayName) {
    out.setAuthor(ascii(brand.legalName ?? brand.displayName ?? ""));
  }

  // Embed the tenant logo once (best-effort).
  let logo: PDFImage | null = null;
  if (opts.logoBytes && opts.logoBytes.length > 0) {
    logo = await embedLogo(out, opts.logoBytes);
  }

  // Cover page matches the first source page's geometry (or A4 if unknown),
  // so the prepended page doesn't look out of place in the viewer.
  const srcPages = src.getPages();
  const firstSize = srcPages[0]?.getSize();
  const coverW = firstSize?.width ?? 595.28; // A4 width (pt)
  const coverH = firstSize?.height ?? 841.89; // A4 height (pt)

  const cover = out.insertPage(0, [coverW, coverH]);
  drawCover(cover, {
    brand,
    style: template.pdf.coverStyle,
    helv,
    helvBold,
    logo,
    title: opts.title,
    category: opts.category ?? null,
  });

  // Copy every source page in order after the cover.
  const copied = await out.copyPages(src, src.getPageIndices());
  for (const p of copied) out.addPage(p);

  // Footer band on every CONTENT page (index 0 is the cover, which carries
  // its own richer footer).
  const pages = out.getPages();
  const contentCount = pages.length - 1;
  for (let i = 1; i < pages.length; i++) {
    drawFooter(pages[i], {
      brand,
      helv,
      helvBold,
      pageNum: i,
      total: contentCount,
    });
  }

  const bytes = await out.save();
  return Buffer.from(bytes);
}

/* ───────────────────────── Cover page ───────────────────────── */

function drawCover(
  page: PDFPage,
  args: {
    brand: BrandingTenant;
    style: PdfCoverStyle;
    helv: PDFFont;
    helvBold: PDFFont;
    logo: PDFImage | null;
    title: string;
    category: string | null;
  }
) {
  const { brand, style } = args;
  const primary = hexToRgb(brand.primaryColor);
  // Accent follows the tenant's secondary brand colour; falls back to the
  // platform cyan only when the firm hasn't set one.
  const accent = brand.secondaryColor ? hexToRgb(brand.secondaryColor) : ACCENT;

  if (style === "sidebar") {
    drawSidebarCover(page, { ...args, primary, accent });
  } else if (style === "minimal") {
    drawMinimalCover(page, { ...args, primary, accent });
  } else {
    drawBannerCover(page, { ...args, primary, accent });
  }
}

type CoverArgs = {
  brand: BrandingTenant;
  helv: PDFFont;
  helvBold: PDFFont;
  logo: PDFImage | null;
  title: string;
  category: string | null;
  primary: RGB;
  accent: RGB;
};

function drawBannerCover(page: PDFPage, a: CoverArgs) {
  const { brand, helv, helvBold, logo, primary } = a;
  const W = page.getWidth();
  const H = page.getHeight();
  const margin = 48;
  const bandH = Math.min(190, H * 0.28);

  // Header band + accent rule.
  page.drawRectangle({ x: 0, y: H - bandH, width: W, height: bandH, color: primary });
  page.drawRectangle({ x: 0, y: H - bandH, width: W, height: 5, color: a.accent });

  // Logo / initial tile inside the band.
  const tile = Math.min(76, bandH * 0.46);
  const tileY = H - bandH / 2 - tile / 2;
  drawLogoTile(page, { logo, brand, x: margin, y: tileY, size: tile, primary });

  // Firm identity (white-on-band).
  const textX = margin + tile + 18;
  const firmName = ascii(brand.displayName ?? brand.legalName ?? "Your Advisor");
  const firmSize = fitText(firmName, helvBold, 22, W - textX - margin, 14);
  page.drawText(firmName, {
    x: textX,
    y: tileY + tile - firmSize - 2,
    size: firmSize,
    font: helvBold,
    color: WHITE,
  });
  const arnText = ascii(`ARN ${(brand.arn ?? "—").toString().replace(/^ARN-?/i, "")}`);
  page.drawText(arnText, {
    x: textX,
    y: tileY + tile - firmSize - 20,
    size: 11,
    font: helv,
    color: rgb(1, 1, 1),
    opacity: 0.82,
  });

  // Title block below the band.
  drawTitleBlock(page, {
    helv,
    helvBold,
    title: a.title,
    category: a.category,
    primary,
    x: margin,
    top: H - bandH - 46,
    width: W - 2 * margin,
  });

  // Footer (contact + disclaimer).
  drawCoverFooter(page, { brand, helv, helvBold, primary, margin });
}

function drawMinimalCover(page: PDFPage, a: CoverArgs) {
  const { brand, helv, helvBold, logo, primary } = a;
  const W = page.getWidth();
  const H = page.getHeight();
  const margin = 56;

  // Small logo + firm name top-left, then a thin accent underline.
  const tile = 46;
  const topY = H - margin - tile;
  drawLogoTile(page, { logo, brand, x: margin, y: topY, size: tile, primary });

  const textX = margin + tile + 14;
  const firmName = ascii(brand.displayName ?? brand.legalName ?? "Your Advisor");
  const firmSize = fitText(firmName, helvBold, 18, W - textX - margin, 12);
  page.drawText(firmName, {
    x: textX,
    y: topY + tile - firmSize - 2,
    size: firmSize,
    font: helvBold,
    color: primary,
  });
  page.drawText(ascii(`ARN ${(brand.arn ?? "—").toString().replace(/^ARN-?/i, "")}`), {
    x: textX,
    y: topY + 2,
    size: 10,
    font: helv,
    color: SLATE,
  });

  // Thin rule under the masthead, with a short accent lead-in.
  page.drawRectangle({ x: margin, y: topY - 16, width: W - 2 * margin, height: 2, color: primary });
  page.drawRectangle({ x: margin, y: topY - 16, width: 64, height: 2, color: a.accent });

  drawTitleBlock(page, {
    helv,
    helvBold,
    title: a.title,
    category: a.category,
    primary,
    x: margin,
    top: topY - 56,
    width: W - 2 * margin,
  });

  drawCoverFooter(page, { brand, helv, helvBold, primary, margin });
}

function drawSidebarCover(page: PDFPage, a: CoverArgs) {
  const { brand, helv, helvBold, logo, primary } = a;
  const W = page.getWidth();
  const H = page.getHeight();
  const barW = Math.min(210, W * 0.34);
  const pad = 28;

  // Left colour band + accent edge.
  page.drawRectangle({ x: 0, y: 0, width: barW, height: H, color: primary });
  page.drawRectangle({ x: barW - 4, y: 0, width: 4, height: H, color: a.accent });

  // Logo near the top of the band.
  const tile = Math.min(96, barW - 2 * pad);
  const tileY = H - 64 - tile;
  drawLogoTile(page, { logo, brand, x: pad, y: tileY, size: tile, primary });

  // Firm name + ARN under the logo (white, wrapped).
  const firmName = ascii(brand.displayName ?? brand.legalName ?? "Your Advisor");
  const nameLines = wrapText(firmName, helvBold, 16, barW - 2 * pad).slice(0, 3);
  let ly = tileY - 22;
  for (const line of nameLines) {
    page.drawText(line, { x: pad, y: ly, size: 16, font: helvBold, color: WHITE });
    ly -= 20;
  }
  page.drawText(ascii(`ARN ${(brand.arn ?? "—").toString().replace(/^ARN-?/i, "")}`), {
    x: pad,
    y: ly - 4,
    size: 10,
    font: helv,
    color: rgb(1, 1, 1),
    opacity: 0.82,
  });

  // Contact pieces at the bottom of the band.
  const contact = contactLines(brand);
  let cy = 56 + (contact.length - 1) * 13;
  for (const line of contact) {
    for (const w of wrapText(line, helv, 9, barW - 2 * pad).slice(0, 2)) {
      page.drawText(w, { x: pad, y: cy, size: 9, font: helv, color: rgb(1, 1, 1), opacity: 0.8 });
      cy -= 12;
    }
  }

  // Title block on the right.
  const rx = barW + 36;
  drawTitleBlock(page, {
    helv,
    helvBold,
    title: a.title,
    category: a.category,
    primary,
    x: rx,
    top: H - 90,
    width: W - rx - 40,
  });

  // Disclaimer along the bottom-right.
  const dlWidth = W - rx - 40;
  let dy = 56;
  for (const line of wrapText(DISCLAIMER, helv, 8, dlWidth).slice(0, 3)) {
    page.drawText(line, { x: rx, y: dy, size: 8, font: helv, color: MUTED });
    dy -= 11;
  }
}

/* ───────────────────────── Shared cover bits ───────────────────────── */

function drawTitleBlock(
  page: PDFPage,
  a: {
    helv: PDFFont;
    helvBold: PDFFont;
    title: string;
    category: string | null;
    primary: RGB;
    x: number;
    top: number;
    width: number;
  }
) {
  const eyebrow = ascii(
    `Shared by your advisor${a.category ? ` — ${a.category.replace(/_/g, " ")}` : ""}`
  ).toUpperCase();
  page.drawText(eyebrow, {
    x: a.x,
    y: a.top,
    size: 10,
    font: a.helvBold,
    color: a.primary,
  });

  const titleLines = wrapText(ascii(a.title || "Shared update"), a.helvBold, 26, a.width).slice(0, 4);
  let y = a.top - 28;
  for (const line of titleLines) {
    page.drawText(line, { x: a.x, y, size: 26, font: a.helvBold, color: rgb(0.06, 0.09, 0.16) });
    y -= 31;
  }
}

function drawCoverFooter(
  page: PDFPage,
  a: { brand: BrandingTenant; helv: PDFFont; helvBold: PDFFont; primary: RGB; margin: number }
) {
  const { brand, helv, helvBold, margin } = a;
  const W = page.getWidth();
  const y0 = 64;

  // Divider.
  page.drawRectangle({ x: margin, y: y0 + 46, width: W - 2 * margin, height: 1, color: rgb(0.89, 0.91, 0.94) });

  // "Get in touch" contact column.
  page.drawText("GET IN TOUCH", { x: margin, y: y0 + 32, size: 9, font: helvBold, color: MUTED });
  const contact = contactLines(brand);
  let cy = y0 + 18;
  for (const line of contact.slice(0, 3)) {
    page.drawText(line, { x: margin, y: cy, size: 9.5, font: helv, color: SLATE });
    cy -= 12;
  }

  // Disclaimer at the very bottom.
  const legal = ascii(brand.legalName ?? brand.displayName ?? "Your Advisor");
  const arn = ascii(`ARN-${(brand.arn ?? "").toString().replace(/^ARN-?/i, "")}`);
  let dy = 30;
  for (const line of wrapText(`${legal} · ${arn} · ${DISCLAIMER}`, helv, 8, W - 2 * margin).slice(0, 3)) {
    page.drawText(line, { x: margin, y: dy, size: 8, font: helv, color: MUTED });
    dy -= 10;
  }
}

/* ───────────────────────── Per-page footer ───────────────────────── */

function drawFooter(
  page: PDFPage,
  a: { brand: BrandingTenant; helv: PDFFont; helvBold: PDFFont; pageNum: number; total: number }
) {
  const { brand, helv, helvBold } = a;
  const W = page.getWidth();
  const margin = 40;
  const bandH = 30;

  // Translucent white backing so text stays legible over page content,
  // plus a thin brand rule on top of the band.
  const primary = hexToRgb(brand.primaryColor);
  page.drawRectangle({ x: 0, y: 0, width: W, height: bandH, color: WHITE, opacity: 0.9 });
  page.drawRectangle({ x: 0, y: bandH, width: W, height: 1.5, color: primary, opacity: 0.85 });

  // Row 1: firm · ARN (left), page X of N (right).
  const legal = ascii(brand.legalName ?? brand.displayName ?? "Your Advisor");
  const arn = ascii(`ARN ${(brand.arn ?? "—").toString().replace(/^ARN-?/i, "")}`);
  const left = truncateToWidth(`${legal}  ·  ${arn}`, helvBold, 8, W - 2 * margin - 80);
  page.drawText(left, { x: margin, y: 18, size: 8, font: helvBold, color: SLATE });

  const pageLabel = `Page ${a.pageNum} of ${a.total}`;
  const pw = helv.widthOfTextAtSize(pageLabel, 8);
  page.drawText(pageLabel, { x: W - margin - pw, y: 18, size: 8, font: helv, color: MUTED });

  // Row 2: SEBI disclaimer (truncated to one line).
  const disc = truncateToWidth(DISCLAIMER, helv, 7, W - 2 * margin);
  page.drawText(disc, { x: margin, y: 7, size: 7, font: helv, color: MUTED });
}

/* ───────────────────────── Logo / tile ───────────────────────── */

function drawLogoTile(
  page: PDFPage,
  a: { logo: PDFImage | null; brand: BrandingTenant; x: number; y: number; size: number; primary: RGB }
) {
  const { logo, brand, x, y, size, primary } = a;
  if (logo) {
    // White backing so transparent logos stay readable on a coloured band.
    page.drawRectangle({ x, y, width: size, height: size, color: WHITE });
    const dims = logo.scale(1);
    const scale = Math.min(size / dims.width, size / dims.height);
    const w = dims.width * scale;
    const h = dims.height * scale;
    page.drawImage(logo, { x: x + (size - w) / 2, y: y + (size - h) / 2, width: w, height: h });
  } else {
    page.drawRectangle({ x, y, width: size, height: size, color: WHITE });
    const initial = ascii((brand.displayName ?? brand.legalName ?? "M").charAt(0).toUpperCase()) || "M";
    // Helvetica metrics: rough centring is fine for a single glyph.
    page.drawText(initial, {
      x: x + size / 2 - size * 0.27,
      y: y + size / 2 - size * 0.34,
      size: size * 0.55,
      color: primary,
    });
  }
}

async function embedLogo(
  doc: PDFDocument,
  bytes: Buffer | Uint8Array
): Promise<PDFImage | null> {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const isPng = u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47;
  const isJpg = u8[0] === 0xff && u8[1] === 0xd8;
  try {
    if (isPng) return await doc.embedPng(u8);
    if (isJpg) return await doc.embedJpg(u8);
    // Unknown magic — try PNG then JPG before giving up (covers mislabelled
    // content-types). SVG/WebP simply can't be embedded → fall back to tile.
    try {
      return await doc.embedPng(u8);
    } catch {
      return await doc.embedJpg(u8);
    }
  } catch {
    return null;
  }
}

/* ───────────────────────── Text helpers ───────────────────────── */

function contactLines(brand: BrandingTenant): string[] {
  const out: string[] = [];
  if (brand.phone) out.push(ascii(`Tel  ${brand.phone}`));
  if (brand.email) out.push(ascii(`Email  ${brand.email}`));
  if (brand.website) out.push(ascii(`Web  ${brand.website.replace(/^https?:\/\//, "")}`));
  if (brand.address) {
    const a: any = brand.address;
    const addr =
      typeof a === "string"
        ? a
        : [a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(", ");
    if (addr) out.push(ascii(`Addr  ${addr}`));
  }
  return out;
}

/** Word-wrap to a pixel width using the embedded font's real metrics. */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = (text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) <= maxWidth || !cur) {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

/** Shrink a single-line label to fit, never below `min`. */
function fitText(text: string, font: PDFFont, size: number, maxWidth: number, min: number): number {
  let s = size;
  while (s > min && font.widthOfTextAtSize(text, s) > maxWidth) s -= 1;
  return s;
}

/** Truncate a single line with an ellipsis so it never overflows. */
function truncateToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return `${t}...`;
}

/**
 * Reduce a string to Helvetica-safe printable ASCII. The StandardFonts use
 * WinAnsi encoding; un-encodable glyphs (emoji, many unicode separators)
 * would otherwise make pdf-lib throw. We translate a few common symbols and
 * drop the rest.
 */
function ascii(s: string): string {
  if (!s) return "";
  return s
    .replace(/₹/g, "Rs ") // ₹
    .replace(/[•]/g, "-")
    .replace(/[–—]/g, "-")
    .replace(/[''‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/·/g, "-") // middle dot used as separator → keep ASCII '-'
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
}

/* ───────────────────────── Colour helpers ───────────────────────── */

function hexToRgb(hex: string | null | undefined): RGB {
  const m = (hex ?? "").replace(/^#/, "").match(/^([0-9a-fA-F]{6})$/);
  if (!m) return DEFAULT_PRIMARY;
  const parts = m[1].match(/.{2}/g)!;
  const [r, g, b] = parts.map((x) => parseInt(x, 16) / 255);
  return rgb(r, g, b);
}
