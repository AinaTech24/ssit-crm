/**
 * RTA reverse-feed — entry point.
 *
 * Detects which RTA produced a mailback CSV (by header signature) and dispatches
 * to the matching parser, returning the normalized `RtaParseResult`. Add a new
 * RTA by writing its `is*` + `parse*` pair and wiring it in here.
 */

import { parseCsv } from "./csv";
import { isKfintechFolioMaster, parseKfintechFolioMaster, isKfintechHoldings, parseKfintechHoldings } from "./kfintech";
import { isCamsFile, parseCamsFile } from "./cams";
import type { RtaParseResult } from "./types";

export * from "./types";
export { parseCsv } from "./csv";

/** Parse a delimited RTA file (Kfintech CSVs). */
export function parseRtaCsv(text: string): RtaParseResult {
  return parseRtaRows(parseCsv(text));
}

/**
 * Dispatch already-tabulated rows (from the CSV parser or the .xls reader) to
 * the matching RTA parser by header signature.
 */
export function parseRtaRows(allRows: string[][]): RtaParseResult {
  // Drop fully-empty trailing lines.
  const rows = allRows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ""));
  if (!rows.length) {
    return { source: "unknown", kind: "unknown", reportType: "", totalRows: 0, folios: [], warnings: ["Empty file"], missingPan: 0 };
  }
  const header = rows[0].map((h) => h.trim());

  // CAMS folio statement (combined master + holdings).
  if (isCamsFile(header)) {
    const { reportType, folios, missingPan, warnings } = parseCamsFile(rows);
    return { source: "cams", kind: "full", reportType, totalRows: rows.length - 1, folios, warnings, missingPan };
  }

  // Kfintech holdings is checked before the master: it shares some columns but
  // adds Balance / NAV / AUM, so its signature is the more specific match.
  if (isKfintechHoldings(header)) {
    const { reportType, folios, missingPan, warnings } = parseKfintechHoldings(rows);
    return { source: "kfintech", kind: "holdings", reportType, totalRows: rows.length - 1, folios, warnings, missingPan };
  }

  if (isKfintechFolioMaster(header)) {
    const { reportType, folios, missingPan, warnings } = parseKfintechFolioMaster(rows);
    return { source: "kfintech", kind: "master", reportType, totalRows: rows.length - 1, folios, warnings, missingPan };
  }

  return {
    source: "unknown",
    kind: "unknown",
    reportType: "",
    totalRows: rows.length - 1,
    folios: [],
    warnings: [`Unrecognised RTA file format — header did not match any known report. First columns: ${header.slice(0, 6).join(", ")}`],
    missingPan: 0,
  };
}
