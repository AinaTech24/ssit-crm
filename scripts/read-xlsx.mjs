// Reads an XLSX file and prints each sheet's contents as JSON to stdout.
// Usage: node scripts/read-xlsx.mjs "<path-to-xlsx>"
import { readFile } from "node:fs/promises";
import { read, utils } from "xlsx";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/read-xlsx.mjs <path>");
  process.exit(1);
}

const buf = await readFile(path);
const wb = read(buf, { type: "buffer" });

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const rows = utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
  console.log("\n===== SHEET:", name, "(", rows.length, "rows ) =====");
  for (let i = 0; i < Math.min(rows.length, 100); i++) {
    console.log(`R${i}:`, JSON.stringify(rows[i]));
  }
  if (rows.length > 100) console.log(`... ${rows.length - 100} more rows`);
}
