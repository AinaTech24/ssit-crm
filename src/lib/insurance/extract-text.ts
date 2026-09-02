/**
 * Document text extraction for the insurance auto-fill — NO AI.
 *
 *   - PDF  → text layer via unpdf (pdf.js under the hood). Fast + exact for the
 *            digital policy PDFs insurers email out.
 *   - JPG/PNG → OCR via tesseract.js (a photo / scan of a policy).
 *
 * Returns the raw text + which method produced it, so the parser can lower its
 * confidence for OCR (noisier) vs a clean PDF text layer.
 */

import { extractText, getDocumentProxy } from "unpdf";

export type ExtractedText = {
  text: string;
  method: "pdf-text" | "ocr";
  pages: number;
};

export async function extractDocumentText(
  buffer: Buffer,
  mediaType: "application/pdf" | "image/jpeg" | "image/png"
): Promise<ExtractedText> {
  if (mediaType === "application/pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    const merged = Array.isArray(text) ? text.join("\n") : text ?? "";
    return { text: merged, method: "pdf-text", pages: totalPages ?? 1 };
  }

  // Image → OCR. Lazy-load tesseract so the (common) PDF path never pays for it.
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(buffer);
    return { text: data.text ?? "", method: "ocr", pages: 1 };
  } finally {
    await worker.terminate();
  }
}
