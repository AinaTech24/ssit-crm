// Lists the sheet names + row counts in an XLSX
import { readFile } from "node:fs/promises";
import { read, utils } from "xlsx";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/read-xlsx-sheets.mjs <path>");
  process.exit(1);
}
const buf = await readFile(path);
const wb = read(buf, { type: "buffer" });
console.log("Sheets:");
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const rows = utils.sheet_to_json(ws, { header: 1, defval: "" });
  // Find first non-empty row
  let firstNonEmptyIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].some((c) => c !== "")) {
      firstNonEmptyIdx = i;
      break;
    }
  }
  console.log(`  "${name}" — ${rows.length} rows`);
  // Print first 5 non-empty rows
  let printed = 0;
  for (let i = firstNonEmptyIdx; i < rows.length && printed < 5; i++) {
    if (rows[i].some((c) => c !== "")) {
      console.log(`    R${i}: ${JSON.stringify(rows[i])}`);
      printed++;
    }
  }
}
