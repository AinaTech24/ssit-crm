/**
 * Shared PDF font embedding for every report generator.
 *
 * Embeds DejaVu Sans (Unicode) so the rupee sign "₹" renders as a real glyph
 * instead of the "Rs " fallback. If the font files can't be read (stripped
 * deploy, permissions), we fall back to the built-in Helvetica — a font
 * problem must never break a download. Callers check `rupeeOk` to decide
 * whether to keep "₹" in text or sanitize it away.
 */

import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import fs from "node:fs";
import path from "node:path";

export type PdfFonts = { font: PDFFont; bold: PDFFont; rupeeOk: boolean };

export async function embedPdfFonts(doc: PDFDocument): Promise<PdfFonts> {
  try {
    doc.registerFontkit(fontkit);
    const dir = path.join(process.cwd(), "src/lib/calculators/fonts");
    const font = await doc.embedFont(fs.readFileSync(path.join(dir, "DejaVuSans.ttf")), { subset: true });
    const bold = await doc.embedFont(fs.readFileSync(path.join(dir, "DejaVuSans-Bold.ttf")), { subset: true });
    return { font, bold, rupeeOk: true };
  } catch {
    return {
      font: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
      rupeeOk: false,
    };
  }
}

/**
 * Normalise text for PDF drawing. When `keepRupee` (i.e. a Unicode font is
 * embedded) the "₹" glyph is preserved; otherwise it becomes "Rs " and all
 * non-ASCII is stripped so WinAnsi Helvetica never throws on encoding.
 */
export function pdfSanitize(s: string, keepRupee = false): string {
  let t = (s ?? "")
    .replace(/[•·]/g, "-")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
  t = keepRupee ? t.replace(/[^\x20-\x7E₹]/g, "") : t.replace(/₹/g, "Rs ").replace(/[^\x20-\x7E]/g, "");
  return t.replace(/\s+/g, " ").trim();
}
