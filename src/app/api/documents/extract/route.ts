import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/documents/extract   (multipart: file)
 *
 * Reads a vault document (PDF text-layer or OCR for images) and returns a
 * best-effort metadata draft to pre-fill the upload form: a PAN (if present), an
 * expiry date (a date near "valid/expiry/upto/till"), and a suggested name.
 * NO AI / token cost — pure text extraction + regex. Persists nothing.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { extractDocumentText } from "@/lib/insurance/extract-text";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED: Record<string, "application/pdf" | "image/jpeg" | "image/png"> = {
  "application/pdf": "application/pdf",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
};
const MAX_BYTES = 25 * 1024 * 1024;

/** dd/mm/yyyy | dd-mm-yyyy | dd Mon yyyy → ISO yyyy-mm-dd (best effort). */
function toIso(raw: string): string | null {
  const m1 = raw.match(/(\d{1,2})[\/\-.\s]+(\d{1,2})[\/\-.\s]+(\d{2,4})/);
  if (m1) {
    let [, d, mo, y] = m1;
    if (y.length === 2) y = `20${y}`;
    const dd = d.padStart(2, "0");
    const mm = mo.padStart(2, "0");
    if (Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31) return `${y}-${mm}-${dd}`;
  }
  const months: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
  const m2 = raw.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
  if (m2) {
    const [, d, mon, y] = m2;
    const mm = months[mon.toLowerCase()];
    if (mm) return `${y}-${mm}-${d.padStart(2, "0")}`;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "document.upload", session.permissions);

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "no file uploaded" }, { status: 400 });
    const mediaType = ALLOWED[file.type];
    if (!mediaType) return NextResponse.json({ error: "upload a PDF, JPG or PNG" }, { status: 415 });
    if (file.size === 0 || file.size > MAX_BYTES) return NextResponse.json({ error: "file empty or too large (max 25MB)" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    let text = "";
    try {
      text = (await extractDocumentText(buffer, mediaType)).text ?? "";
    } catch (e: any) {
      return NextResponse.json({ error: `Couldn't read the document: ${e?.message ?? "unknown"}` }, { status: 422 });
    }
    const flat = text.replace(/\s+/g, " ");

    // PAN — AAAAA9999A
    const pan = flat.match(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/)?.[0] ?? null;

    // Expiry — a date that follows an expiry-ish keyword.
    let expiry: string | null = null;
    const expMatch = flat.match(/(?:valid\s*(?:up\s*to|till|until)?|expiry|expires?|valid\s*upto|renewal)\D{0,12}(\d{1,2}[\/\-.\s][A-Za-z0-9]{2,3}[\/\-.\s]\d{2,4})/i);
    if (expMatch) expiry = toIso(expMatch[1]);

    return NextResponse.json({ pan, expiry });
  } catch (err: any) {
    return handleApiError(err);
  }
}
