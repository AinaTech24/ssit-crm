import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/insurance/extract
 *
 * Multipart upload of a policy document (PDF / JPG / PNG, <= 25MB). Reads it
 * with a PDF text-layer extractor (digital PDFs) or OCR (images) — NO AI, no
 * token limits, no API cost — and returns a best-effort structured draft mapped
 * to our insurance schema for the RM to review + edit + save. Persists NOTHING.
 * Gated by insurance.write + an active license.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { extractDocumentText } from "@/lib/insurance/extract-text";
import { parseInsurancePolicy } from "@/lib/insurance/parse-policy";
import { isAiConfigured } from "@/lib/ai/provider";
import { runExtractionPipeline } from "@/lib/insurance/extract/pipeline";
import { structuredToDraft } from "@/lib/insurance/extract/to-draft";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// OCR on an image can take a few seconds — give it headroom over the default.
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — matches the dropzone copy
const ALLOWED = {
  "application/pdf": "application/pdf",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
} as const;

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "insurance.write", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "expected multipart/form-data with a 'file' field" }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "no file uploaded" }, { status: 400 });
    }

    const mediaType = ALLOWED[file.type as keyof typeof ALLOWED];
    if (!mediaType) {
      return NextResponse.json({ error: "unsupported file type — upload a PDF, JPG, or PNG" }, { status: 415 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "the uploaded file is empty" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "file too large — maximum is 25MB" }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Redesigned document-understanding pipeline: detect → per-page text / OCR →
    // normalize → regex CANDIDATES → the model CLASSIFIES candidates into strictly
    // separated entities (policyholder / proposer / agent / receipt / insurer) and
    // extracts each table independently → every field re-validated + gated at 0.70.
    // This is what stops support emails / care numbers / branch addresses from
    // landing in the customer fields. Falls back to the rule-based text parser
    // when AI isn't configured or the pipeline errors out.
    if (await isAiConfigured()) {
      try {
        const { structured, meta } = await runExtractionPipeline(buffer, mediaType);
        const draft = structuredToDraft(structured);
        return NextResponse.json({ draft, engine: "ai", meta }, { status: 200 });
      } catch {
        /* fall through to the rule-based parser */
      }
    }

    let extracted;
    try {
      extracted = await extractDocumentText(buffer, mediaType);
    } catch (e: any) {
      return NextResponse.json(
        { error: `Couldn't read the document: ${e?.message ?? "unknown error"}` },
        { status: 422 }
      );
    }

    const cleaned = extracted.text.replace(/\s+/g, " ").trim();

    // A PDF with no text layer is almost certainly a scan — guide the RM to OCR it.
    if (extracted.method === "pdf-text" && cleaned.length < 40) {
      const draft = parseInsurancePolicy("", { ocr: false });
      draft.warnings = [
        "This looks like a scanned PDF with no text layer. Upload it as a JPG/PNG photo so it can be read by OCR, or enter the fields manually.",
      ];
      return NextResponse.json({ draft }, { status: 200 });
    }

    const draft = parseInsurancePolicy(extracted.text, { ocr: extracted.method === "ocr" });
    return NextResponse.json({ draft }, { status: 200 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
