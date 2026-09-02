/**
 * Lightweight magic-byte sniffing for uploaded files.
 *
 * The browser-declared `Content-Type` is attacker-controlled: a script renamed
 * `.pdf` can claim `application/pdf`. For a compliance vault that later serves
 * these files back via presigned URL, we verify the file's real type by its
 * leading bytes before trusting it. This is not a virus scanner — it's a cheap,
 * dependency-free guard against type spoofing + obviously-corrupt uploads.
 */

/** Best-effort detection of common document/image types from leading bytes. */
export function sniffMime(buf: Buffer): string | null {
  if (!buf || buf.length < 4) return null;

  // PDF — "%PDF"
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "application/pdf";
  // PNG — 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  // JPEG — FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  // GIF — "GIF8"
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "image/gif";
  // WEBP — "RIFF"...."WEBP"
  if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return "image/webp";
  // ZIP container (DOCX/XLSX/PPTX are zips) — "PK\x03\x04"
  if (buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07)) return "application/zip";
  // Legacy MS Office (DOC/XLS) — D0 CF 11 E0
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) return "application/x-ole-storage";

  return null; // unknown — likely plain text / csv (no signature)
}

/** Families a declared mime maps to, for matching against the sniffed type. */
function family(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("pdf")) return "application/pdf";
  if (m.includes("png")) return "image/png";
  if (m.includes("jpeg") || m.includes("jpg")) return "image/jpeg";
  if (m.includes("gif")) return "image/gif";
  if (m.includes("webp")) return "image/webp";
  // All OOXML office docs are zip containers under the hood.
  if (m.includes("openxmlformats") || m === "application/zip") return "application/zip";
  if (m.includes("msword") || m.includes("ms-excel") || m.includes("ms-powerpoint")) return "application/x-ole-storage";
  return m;
}

/**
 * Returns true if the file's real (sniffed) type is consistent with what the
 * client declared. Files with no recognizable signature (plain text / CSV) pass
 * — we can't spoof-check what has no magic bytes, and they're low-risk.
 */
export function contentTypeMatches(declaredMime: string, buf: Buffer): boolean {
  const sniffed = sniffMime(buf);
  if (!sniffed) return true; // no signature to verify against (txt/csv)
  return family(declaredMime) === sniffed;
}

/** Convenience guard for the strict public path (PDF/JPG/PNG only). */
export function isAllowedDocType(buf: Buffer): boolean {
  const sniffed = sniffMime(buf);
  return sniffed === "application/pdf" || sniffed === "image/png" || sniffed === "image/jpeg";
}
