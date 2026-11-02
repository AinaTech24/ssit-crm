/** GET /api/dhandho/template — a blank speaker sheet to fill in and upload. */

import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET() {
  await requireSession();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Date", "Name", "Topic"],
    ["02-11-2026", "Speaker name", "What they will talk about"],
    ["07-11-2026", "Holiday", ""],
  ]);
  ws["!cols"] = [{ wch: 14 }, { wch: 30 }, { wch: 44 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Dhandho");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="dhandho-speakers-template.xlsx"',
      "Cache-Control": "private, no-store",
    },
  });
}
