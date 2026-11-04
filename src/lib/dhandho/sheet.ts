/**
 * Reads the monthly Dhandho speaker sheet.
 *
 * Expected columns: Date | Speaker | Topic (optional). Dates may be real Excel
 * dates or typed text (05-11-2026, 5/11/2026, 2026-11-05, 5 Nov 2026). A speaker
 * may be a person's name or email — matched to a CRM user so they get their own
 * reminder; a name that matches nobody is still announced to everyone.
 */

import * as XLSX from "xlsx";
import { dayOfWeek, isIsoDate } from "./schedule";

export interface SheetRow {
  /** 1-based row number in the sheet, for error messages. */
  row: number;
  date: string;
  /** The speaker as written. Empty on an off day. */
  speaker: string;
  topic: string | null;
  /** Set when the row says there is no session ("Holiday", "no 10 AM"…). */
  off: string | null;
}

export interface SheetProblem {
  row: number;
  reason: string;
}

/** A "speaker" cell that is really a note that there is no session that day. */
const OFF_RE = /^\s*(holiday|no\b|off\b|cancel|closed|leave\b)/i;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** A cell value → "YYYY-MM-DD", or null when it is not a date. Day comes before month in text. */
export function coerceDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
  }
  if (typeof v === "number") {
    // Excel serial date.
    const p = XLSX.SSF.parse_date_code(v);
    return p && p.y > 2000 ? iso(p.y, p.m, p.d) : null;
  }
  const s = String(v).trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return fixed(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return fixed(y, Number(m[2]), Number(m[1]));
  }
  m = /^(\d{1,2})[\s\-/.]+([A-Za-z]{3,9})[\s\-/.,]+(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return mo ? fixed(y, mo, Number(m[1])) : null;
  }
  return null;
}

function fixed(y: number, m: number, d: number): string | null {
  const s = iso(y, m, d);
  return isIsoDate(s) ? s : null;
}

/** Rows of cells (as from sheet_to_json header:1) → schedule rows + what was skipped and why. */
export function parseSheetRows(cells: unknown[][]): { rows: SheetRow[]; problems: SheetProblem[] } {
  const rows: SheetRow[] = [];
  const problems: SheetProblem[] = [];
  if (!cells.length) return { rows, problems };

  // Header: the first row that names a date column. Without one, assume Date | Speaker | Topic.
  let dateCol = 0;
  let speakerCol = 1;
  let topicCol = 2;
  let start = 0;
  const headerAt = cells.findIndex((r) => r.some((c) => /^\s*date\b/i.test(String(c ?? ""))));
  if (headerAt >= 0) {
    const h = cells[headerAt].map((c) => String(c ?? "").trim().toLowerCase());
    const find = (re: RegExp) => h.findIndex((x) => re.test(x));
    const d = find(/date|day/);
    const s = find(/speaker|name|presenter|person/);
    const t = find(/topic|subject|title|learning|theme/);
    if (d >= 0) dateCol = d;
    if (s >= 0) speakerCol = s;
    topicCol = t >= 0 ? t : -1;
    start = headerAt + 1;
  }

  for (let i = start; i < cells.length; i++) {
    const r = cells[i] ?? [];
    if (!r.some((c) => String(c ?? "").trim() !== "")) continue; // blank row
    const rowNo = i + 1;
    const date = coerceDate(r[dateCol]);
    const speaker = String(r[speakerCol] ?? "").trim();
    if (!date) {
      problems.push({ row: rowNo, reason: `Could not read the date "${String(r[dateCol] ?? "")}"` });
      continue;
    }
    const topic = topicCol >= 0 ? String(r[topicCol] ?? "").trim() : "";
    // "Holiday" / "no 10 AM" in the speaker cell: a day with no session. On a
    // Sunday there was never going to be one, so it is not worth recording.
    if (OFF_RE.test(speaker)) {
      if (dayOfWeek(date) !== 0) rows.push({ row: rowNo, date, speaker: "", topic: null, off: speaker });
      continue;
    }
    if (!speaker) {
      problems.push({ row: rowNo, reason: "No speaker named" });
      continue;
    }
    if (dayOfWeek(date) === 0) {
      problems.push({ row: rowNo, reason: `${date} is a Sunday — there is no session` });
      continue;
    }
    rows.push({ row: rowNo, date, speaker, topic: topic || null, off: null });
  }
  return { rows, problems };
}

/**
 * The first and last date a sheet covers. An upload REPLACES the schedule across this
 * whole span: days inside it that the sheet does not list are cleared, so a
 * corrected sheet fully overrides what was there. Days outside it are untouched —
 * a sheet for the second half of a month leaves the first half alone.
 */
export function sheetDateRange(dates: string[]): { from: string; to: string } | null {
  if (!dates.length) return null;
  const sorted = [...dates].sort();
  return { from: sorted[0], to: sorted[sorted.length - 1] };
}

/** Read the first sheet of an uploaded .xlsx / .xls / .csv. */
export function parseSheetFile(buf: Buffer): { rows: SheetRow[]; problems: SheetProblem[] } {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { rows: [], problems: [{ row: 1, reason: "The file has no sheets" }] };
  const cells = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
  return parseSheetRows(cells);
}

export interface UserLite {
  id: string;
  name: string | null;
  email: string | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9@.]+/g, " ").trim();

/** "Hitesh sir" → "hitesh". Honorifics people add when writing a name down. */
const HONORIFICS = new Set(["sir", "mam", "maam", "madam", "ma", "mr", "mrs", "ms", "miss", "dr", "shri", "smt", "bhai", "ben"]);
function nameTokens(s: string): string[] {
  return norm(s)
    .split(" ")
    .filter((t) => t && !HONORIFICS.has(t));
}

function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export type SpeakerMatch = { user: UserLite; how: "email" | "name" | "first name" | "close spelling" };

/**
 * The CRM user a speaker cell refers to, with how it was matched. Tries, in order:
 * email; the full name; the first name alone ("Payal" → Payal Shah); a first name
 * one letter off ("Priyanaka"). Each step needs EXACTLY ONE candidate — two people
 * called Denis means "no match", never a guess, so a reminder never goes to the
 * wrong person. Honorifics ("Hitesh sir") are ignored.
 */
export function matchSpeakerDetailed(raw: string, users: UserLite[]): SpeakerMatch | null {
  const q = norm(raw);
  if (!q) return null;
  if (q.includes("@")) {
    const u = users.find((x) => x.email && norm(x.email) === q);
    return u ? { user: u, how: "email" } : null;
  }
  const want = nameTokens(raw);
  if (!want.length) return null;
  const full = want.join(" ");
  const one = <T,>(xs: T[]): T | null => (xs.length === 1 ? xs[0] : null);

  const byFull = one(users.filter((u) => u.name && nameTokens(u.name).join(" ") === full));
  if (byFull) return { user: byFull, how: "name" };

  const first = want[0];
  const byFirst = one(users.filter((u) => u.name && nameTokens(u.name)[0] === first));
  if (byFirst) return { user: byFirst, how: "first name" };

  if (first.length >= 4) {
    const close = one(users.filter((u) => u.name && withinOneEdit(nameTokens(u.name)[0] ?? "", first)));
    if (close) return { user: close, how: "close spelling" };
  }
  return null;
}

export function matchSpeaker(raw: string, users: UserLite[]): UserLite | null {
  return matchSpeakerDetailed(raw, users)?.user ?? null;
}
