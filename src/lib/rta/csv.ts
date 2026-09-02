/**
 * Minimal, dependency-free RFC-4180 CSV parser.
 *
 * RTA mailback files are comma-delimited with optional quoting; names and
 * addresses can contain commas inside quotes. Stdlib has no CSV reader, so this
 * handles quoted fields, doubled-quote escapes, embedded commas/newlines, a
 * leading BOM, and CRLF/LF endings. Returns rows of raw string cells.
 *
 * Both `"` and `'` are accepted as quote characters: CAMS mailback CSVs quote
 * EVERY text field with single quotes —
 *   'FOLIOCHK','INV_NAME','ADDRESS1',…
 *   '3409723/63','Swapan Kumar Das','FLAT N-5,3RD FLOOR 28,P.N MALIA',…
 * Treating `'` as ordinary text left the quotes glued to the header names (so no
 * report signature matched) and split any comma-bearing address into extra
 * columns, shifting every field after it.
 *
 * A quote only OPENS a field at field start, so an apostrophe inside an unquoted
 * name (O'Brien) remains literal text.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quote: '"' | "'" | null = null;
  let atFieldStart = true;
  // Strip a leading UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (quote) {
      if (c === quote) {
        if (text[i + 1] === quote) {
          field += quote;
          i += 2;
          continue;
        }
        quote = null;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (atFieldStart && (c === '"' || c === "'")) {
      quote = c as '"' | "'";
      atFieldStart = false;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      atFieldStart = true;
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      atFieldStart = true;
      i++;
      continue;
    }
    // Leading spaces still count as "before the field", so ` 'VALUE'` quotes.
    if (!(atFieldStart && c === " ")) atFieldStart = false;
    field += c;
    i++;
  }
  // Flush the final field/row (file may not end in a newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
