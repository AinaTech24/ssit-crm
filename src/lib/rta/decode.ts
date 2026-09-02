/**
 * RTA file decoder — turns ANY uploaded RTA artefact into a single canonical
 * pipe-delimited text that the kind parsers consume.
 *
 * Why this exists: real CAMS / KFintech / BSE / NSE files arrive as `.xls`
 * (BIFF or HTML-masquerading-as-xls), `.xlsx` (zip), `.dbf` (FoxPro NAV master)
 * and `.csv`. The old upload path did `buf.toString("utf8")`, which turns every
 * binary spreadsheet into garbage — so only plain CSV/pipe text ever imported.
 *
 * This module:
 *   1. Reads spreadsheets (xls/xlsx/xlsb/ods/dbf) via SheetJS.
 *   2. Picks the data sheet (the one with the most used cells — RTA exports
 *      often carry a meta "Sheet1" alongside the real data sheet).
 *   3. Detects the header row, skipping leading title/banner rows
 *      ("Next Freedom Lifex Private Limited", "Report Date: …", merged titles).
 *   4. Re-emits header + data as PIPE-delimited text with ISO dates, so every
 *      downstream parser sees one uniform, quote-safe delimiter regardless of
 *      whether the source was xls, xlsx, dbf or a comma CSV.
 *
 * CSV/TXT inputs are re-parsed (quote-aware) and re-emitted as pipe text too,
 * which neutralises embedded commas inside quoted fields.
 */
import * as XLSX from "xlsx";

const SPREADSHEET_EXT = new Set(["xls", "xlsx", "xlsb", "xlsm", "ods", "dbf"]);

/** Cell → canonical string. Dates → YYYY-MM-DD; numbers stringified as-is. */
function cellToStr(c: unknown): string {
  if (c == null) return "";
  if (c instanceof Date) {
    // Guard against Excel's 1899/1900 epoch noise — only emit a real date.
    const t = c.getTime();
    return Number.isFinite(t) ? c.toISOString().slice(0, 10) : "";
  }
  return String(c).replace(/\r?\n/g, " ").trim();
}

function spreadsheetToPipeText(buf: Buffer): string {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  if (!wb.SheetNames.length) return "";

  // Pick the sheet with the largest used range (rows × cols).
  let sheetName = wb.SheetNames[0];
  let bestCells = -1;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || !ws["!ref"]) continue;
    const r = XLSX.utils.decode_range(ws["!ref"]);
    const cells = (r.e.r - r.s.r + 1) * (r.e.c - r.s.c + 1);
    if (cells > bestCells) {
      bestCells = cells;
      sheetName = name;
    }
  }

  const ws = wb.Sheets[sheetName];
  if (!ws || !ws["!ref"]) return "";
  const range = XLSX.utils.decode_range(ws["!ref"]);

  // Stream the sheet row-by-row directly into pipe-delimited lines. We read
  // cells off the worksheet ourselves instead of XLSX.utils.sheet_to_json,
  // which would materialise the ENTIRE sheet as a JS matrix AND a second
  // string[][] copy — on a large RTA master (tens of thousands of rows) those
  // intermediates pile on top of an already-heavy SheetJS workbook and helped
  // push big imports into a heap OOM. One pass, one output array, no copies.
  const lines: string[] = [];
  // Non-empty VALUE count per emitted line, kept only for the first 20 lines,
  // to locate the header row below (banner/title rows fill 1–2 cells; the real
  // header fills many). This replaces the old findHeaderRow(rows[][]) scan.
  const headScores: number[] = [];
  const cells: string[] = new Array(range.e.c - range.s.c + 1);
  for (let R = range.s.r; R <= range.e.r; R++) {
    let present = 0; // cells that EXIST in the sheet (matches blankrows:false)
    let nonEmptyVal = 0; // cells with a non-empty value (header heuristic)
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = (ws as Record<string, { v: unknown } | undefined>)[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell != null) present++;
      const v = cell == null ? "" : cellToStr(cell.v);
      cells[C - range.s.c] = v;
      if (v !== "") nonEmptyVal++;
    }
    if (present === 0) continue; // skip truly blank rows (no cells at all)
    if (headScores.length < 20) headScores.push(nonEmptyVal);
    lines.push(cells.join("|"));
  }
  if (!lines.length) return "";

  // Header = first of the top-20 emitted lines with the most populated cells
  // (≥3 to qualify) — title banners have far fewer.
  let headerIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < headScores.length; i++) {
    if (headScores[i] >= 3 && headScores[i] > bestScore) {
      bestScore = headScores[i];
      headerIdx = i;
    }
  }
  return lines.slice(headerIdx).join("\n");
}

/**
 * Quote-aware split for a delimited line, handling BOTH `"` and `'` quoting.
 *
 * CAMS mailback CSVs quote every text field with SINGLE quotes:
 *   'FOLIOCHK','INV_NAME','ADDRESS1',…
 *   '3409723/63','Swapan Kumar Das','S/O JITENDRA NATH DAS FLAT N-5,3RD FLOOR',…
 *
 * Treating `'` as ordinary text broke these files two ways: header cells kept
 * their literal quotes so no report signature ever matched ("header did not match
 * any known report"), and any address containing a comma was split into extra
 * columns, shifting every field after it.
 *
 * A quote character only opens a field when it appears at the START of that
 * field, so apostrophes inside names (O'Brien, D'Souza) are still just text.
 */
function splitDelimited(line: string, delim: string): string[] {
  if (delim !== ",") return line.split(delim);
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let atFieldStart = true;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (quote) {
      // Doubled quote inside a quoted field is a literal quote.
      if (ch === quote && line[i + 1] === quote) {
        cur += quote;
        i++;
      } else if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
      continue;
    }

    if (atFieldStart && (ch === '"' || ch === "'")) {
      quote = ch as '"' | "'";
      atFieldStart = false;
      continue;
    }
    if (ch === ",") {
      out.push(cur);
      cur = "";
      atFieldStart = true;
      continue;
    }
    // Leading spaces before a quote still count as "before the field".
    if (!(atFieldStart && ch === " ")) atFieldStart = false;
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** Detect a delimited file's delimiter from its first populated line. */
function sniffDelim(text: string): "|" | "\t" | "," {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const pipes = (line.match(/\|/g) ?? []).length;
  const tabs = (line.match(/\t/g) ?? []).length;
  const commas = (line.match(/,/g) ?? []).length;
  if (pipes >= commas && pipes >= tabs && pipes > 0) return "|";
  if (tabs >= commas && tabs > 0) return "\t";
  return ",";
}

/** Re-emit a delimited text file as pipe-delimited (neutralising quoted commas). */
function normalizeDelimitedText(raw: string): string {
  const delim = sniffDelim(raw);
  if (delim === "|") return raw; // already canonical
  return raw
    .split(/\r?\n/)
    .map((line) => (line.trim() === "" ? "" : splitDelimited(line, delim).map((c) => c.trim()).join("|")))
    .join("\n");
}

/**
 * Refusal to decode a spreadsheet that is too large to hold in memory.
 * Distinct type so the caller can report it as actionable config advice rather
 * than an opaque crash.
 */
export class RtaFileTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RtaFileTooLargeError";
  }
}

/**
 * Ceiling for SheetJS input. XLSX.read() materialises the ENTIRE workbook as an
 * in-memory cell graph — it does not stream — so a very large spreadsheet costs
 * multiples of its own size in RAM and pins a core for the whole parse.
 *
 * A real 482MB CAMS `.dbf` (inside a 28MB zip) held one core at 100% for an hour
 * at ~3GB RSS and, because the parse is synchronous, starved the worker's event
 * loop — freezing every other background job platform-wide. Failing fast with
 * advice the operator can act on beats taking the platform down.
 *
 * CSV/text is NOT subject to this: it's read as a string and never enters SheetJS.
 */
export const SPREADSHEET_MAX_BYTES = Number(process.env.RTA_SPREADSHEET_MAX_BYTES ?? 150 * 1024 * 1024);

/**
 * Decode an uploaded RTA file to canonical pipe-delimited text.
 * Falls back to UTF-8 text on any decode error — except an oversized
 * spreadsheet, which THROWS (the fallback would itself build a giant string).
 */
export function decodeRtaToText(buf: Buffer, fileName: string): string {
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  const isSpreadsheet = SPREADSHEET_EXT.has(ext);

  // Outside the try on purpose: the catch-all below would swallow this and then
  // allocate a multi-hundred-MB string from the same buffer.
  if (isSpreadsheet && buf.length > SPREADSHEET_MAX_BYTES) {
    const mb = (n: number) => `${Math.round(n / 1048576)}MB`;
    throw new RtaFileTooLargeError(
      `This ${ext.toUpperCase()} is ${mb(buf.length)}, over the ${mb(SPREADSHEET_MAX_BYTES)} limit for spreadsheet formats. ` +
        `Re-request this report from the RTA with File Type = CSV — CSV imports at any size, ` +
        `and a file this large in a binary format would stall every background job while it parsed.`
    );
  }

  try {
    if (isSpreadsheet) return spreadsheetToPipeText(buf);
    return normalizeDelimitedText(buf.toString("utf8"));
  } catch {
    // Last-ditch: hand back raw text so the parser at least tries.
    return buf.toString("utf8");
  }
}
