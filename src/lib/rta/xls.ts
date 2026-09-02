/**
 * Spreadsheet → rows reader (server-only).
 *
 * CAMS ships some mailback reports as legacy binary Excel `.xls` (OLE2/BIFF)
 * workbooks, or as `.dbf` (FoxPro/dBase — the CAMS folio-master format),
 * rather than CSV. SheetJS reads .xls/.xlsx/.dbf; we flatten the first
 * worksheet into rows of strings so the per-RTA parser sees the same shape it
 * gets from the CSV path. Numbers (incl. Excel date serials) are kept as raw
 * strings — the parser decides how to interpret each column.
 *
 * This is the RICH (master/holdings) import path's file-type gate — parallel
 * to, but historically NARROWER than, decode.ts's SPREADSHEET_EXT used by the
 * plain feed-processor path. It didn't recognise `.dbf` at all, so a DBF
 * master fell through to being decoded as latin-1 CSV TEXT: the binary field-
 * descriptor table (embedded NUL bytes, by DBF's own format) got treated as a
 * header row, failed classification, and then the "unrecognised format"
 * error — built from that same NUL-laden text — crashed the very UPDATE that
 * was trying to record the failure (Postgres text columns reject any embedded
 * NUL: "invalid byte sequence for encoding UTF8: 0x00"). The row was left
 * orphaned in `parsing` until the reaper cleaned it up, with no real reason
 * ever recorded. Recognising `.dbf` here fixes it at the source; `sanitizeText`
 * in rta-import-worker.ts is the second, independent layer — any OTHER file
 * format that manages to produce NUL-bearing text must never be able to crash
 * a status write like this again.
 */

import * as XLSX from "xlsx";
import { RtaFileTooLargeError, SPREADSHEET_MAX_BYTES } from "./decode";

export function isSpreadsheet(data: Uint8Array, filename = ""): boolean {
  // OLE2 (legacy .xls) magic D0 CF 11 E0, or a zip (.xlsx) named .xls/.xlsx,
  // or a .dbf (no reliable magic-byte signature across dBase/FoxPro variants —
  // matched by extension, same convention decode.ts already uses).
  const ole2 = data.length > 7 && data[0] === 0xd0 && data[1] === 0xcf && data[2] === 0x11 && data[3] === 0xe0;
  return ole2 || /\.(xls[xmb]?|dbf)$/i.test(filename);
}

/**
 * Read a spreadsheet's first sheet into rows of strings.
 *
 * Guarded the same way as decode.ts's `decodeRtaToText`: XLSX.read() loads the
 * ENTIRE workbook into an in-memory cell graph — it does not stream — so a
 * very large file costs multiples of its own size in RAM and pins a core
 * synchronously for the whole parse, which starves the worker's event loop and
 * freezes every OTHER background job platform-wide (a 482MB CAMS `.dbf` did
 * exactly this for an hour before decode.ts's guard was added). That guard
 * only covered the plain feed-processor path — the rich (master/holdings)
 * path called this function directly with no size check at all, so the same
 * class of file could still take the platform down through this path. Same
 * limit, same exported constant, one source of truth.
 */
export function readSpreadsheetToRows(data: Uint8Array): string[][] {
  if (data.length > SPREADSHEET_MAX_BYTES) {
    const mb = (n: number) => `${Math.round(n / 1048576)}MB`;
    throw new RtaFileTooLargeError(
      `This file is ${mb(data.length)}, over the ${mb(SPREADSHEET_MAX_BYTES)} limit for spreadsheet formats. ` +
        `Re-request this report from the RTA with File Type = CSV — CSV imports at any size, ` +
        `and a file this large in a binary format would stall every background job while it parsed.`
    );
  }
  const wb = XLSX.read(data, { type: "array", cellDates: false, cellNF: false, cellHTML: false });
  const name = wb.SheetNames[0];
  const ws = name ? wb.Sheets[name] : undefined;
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "", blankrows: false });
  return rows.map((row) => (Array.isArray(row) ? row.map((c) => (c == null ? "" : String(c))) : []));
}
