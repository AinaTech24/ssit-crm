/**
 * Steps 1-2 of the pipeline: document-kind detection, per-page text extraction,
 * and normalization.
 *
 *   - Digital PDF → text layer per page (unpdf / pdf.js). Exact, fast, free.
 *   - Scanned PDF → text layer is near-empty → flagged; the classifier then
 *     relies on the model reading the PDF natively (multimodal).
 *   - Image     → OCR per image (tesseract.js).
 *
 * Per-page (not merged) so each downstream candidate keeps a page number.
 */

import { extractText, getDocumentProxy } from "unpdf";
import type { DocKind, PageText } from "./types";

export type ExtractedDoc = {
  kind: DocKind;
  pages: PageText[];
  /** Whole-document normalized text (pages joined) for regex sweeps. */
  fullText: string;
  pageCount: number;
};

/** A page is "thin" if its text layer holds almost nothing — i.e. it's a scan. */
const MIN_CHARS_PER_PAGE = 40;

export async function extractDoc(
  buffer: Buffer,
  mediaType: "application/pdf" | "image/jpeg" | "image/png"
): Promise<ExtractedDoc> {
  if (mediaType === "application/pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text, totalPages } = await extractText(pdf, { mergePages: false });
    const rawPages: string[] = Array.isArray(text) ? text : [String(text ?? "")];
    const pages: PageText[] = rawPages.map((t, i) => ({ page: i + 1, text: normalize(t) }));
    const total = pages.reduce((s, p) => s + p.text.length, 0);
    // A digital PDF has a real text layer; a scan yields almost none.
    const kind: DocKind = total < MIN_CHARS_PER_PAGE * Math.max(1, pages.length) * 0.5 ? "scanned_pdf" : "digital_pdf";
    return { kind, pages, fullText: pages.map((p) => p.text).join("\n\n"), pageCount: totalPages ?? pages.length };
  }

  // Image → OCR (lazy-load tesseract so the common PDF path never pays for it).
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(buffer);
    const text = normalize(data.text ?? "");
    return { kind: "image", pages: [{ page: 1, text }], fullText: text, pageCount: 1 };
  } finally {
    await worker.terminate();
  }
}

/**
 * Normalize one block of extracted text:
 *   - collapse runs of spaces/tabs, strip zero-width chars
 *   - re-join words broken across line wraps ("Pol-\nicy" → "Policy")
 *   - glue an orphaned label to its value when the line break split them
 *   - normalize obvious OCR confusions inside emails (" at " → "@")
 *   - keep real line breaks (they delimit rows/labels) but trim each line
 */
export function normalize(raw: string): string {
  if (!raw) return "";
  let t = raw
    .replace(/ /g, " ") // nbsp
    .replace(/[​-‍﻿]/g, "") // zero-width
    .replace(/\r\n?/g, "\n");

  // de-hyphenate words split across a line wrap
  t = t.replace(/([A-Za-z])-\n([a-z])/g, "$1$2");

  // normalize spaced-out emails sometimes produced by OCR / PDF kerning
  t = t.replace(/([A-Za-z0-9._%+-])\s*@\s*([A-Za-z0-9.-])/g, "$1@$2");
  t = t.replace(/\s+\.\s+([A-Za-z]{2,})\b/g, ".$1"); // "name . com" → "name.com" tail

  // per-line: collapse internal whitespace, drop empties
  const lines = t
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l, i, arr) => l.length > 0 || (i > 0 && arr[i - 1].length > 0)); // keep single blank between blocks

  return lines.join("\n").trim();
}

/**
 * Strip repeated page headers/footers — lines that appear on most pages at the
 * top/bottom (insurer boilerplate, page numbers, toll-free banners). Reduces the
 * noise the classifier (and regex) has to wade through.
 */
export function stripBoilerplate(pages: PageText[]): PageText[] {
  if (pages.length < 3) return pages; // not enough pages to tell what repeats
  const freq = new Map<string, number>();
  for (const p of pages) {
    const ls = p.text.split("\n");
    const edges = [...ls.slice(0, 2), ...ls.slice(-2)];
    for (const l of new Set(edges)) {
      const key = l.toLowerCase();
      if (key.length > 6) freq.set(key, (freq.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.ceil(pages.length * 0.6);
  const boiler = new Set([...freq.entries()].filter(([, n]) => n >= threshold).map(([k]) => k));
  if (boiler.size === 0) return pages;
  return pages.map((p) => ({
    page: p.page,
    text: p.text
      .split("\n")
      .filter((l) => !boiler.has(l.toLowerCase()))
      .join("\n"),
  }));
}
