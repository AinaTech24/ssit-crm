import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/engagement/gifts/import/parse  multipart/form-data: file=<xlsx|csv>
 *
 * Same contract as the other importers, so the shared ImportWizard drives it.
 *
 * Gifting runs in batches — a festival list, a birthday month, a hamper order
 * for forty clients — and logging those one at a time is the job nobody does,
 * which is how the gift log stops reflecting reality.
 */

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

const OUR_FIELDS = [
  { key: "client", label: "Client (name or PAN)" },
  { key: "category", label: "Category (hamper / cake / plant)" },
  { key: "grade", label: "Grade (A / AA / B …)" },
  { key: "occasion", label: "Occasion (birthday / anniversary / festival / other)" },
  { key: "title", label: "Gift / title" },
  { key: "amount", label: "Cost (₹)" },
  { key: "givenOn", label: "Given on" },
  { key: "deliveredOn", label: "Delivered on (blank = not yet)" },
  { key: "notes", label: "Notes" },
];

function suggestMapping(headers: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  const patterns: Array<[RegExp, string]> = [
    [/deliver/i, "deliveredOn"],
    [/given|gift.?date|^date$|sent/i, "givenOn"],
    [/client|customer|investor|name|pan/i, "client"],
    [/categ|type.?of.?gift/i, "category"],
    [/grade|tier/i, "grade"],
    [/occasion|reason|festival/i, "occasion"],
    [/gift|item|title|description/i, "title"],
    [/amount|cost|value|price|₹|rs/i, "amount"],
    [/note|remark|comment/i, "notes"],
  ];
  for (const h of headers) {
    for (const [re, field] of patterns) {
      if (re.test(h)) {
        m[h] = field;
        break;
      }
    }
  }
  return m;
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // Same gate as logging one by hand.
    requireAny(
      session.roles,
      ["investor.edit.all", "investor.edit.assigned", "gifting.manage"],
      session.permissions
    );

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "file too large (max 10MB)" }, { status: 413 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return NextResponse.json({ error: "no sheet found" }, { status: 400 });

    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "", raw: false });
    if (rows.length === 0) return NextResponse.json({ error: "empty sheet" }, { status: 400 });
    if (rows.length > 5000) return NextResponse.json({ error: "too many rows (max 5000)" }, { status: 413 });

    return NextResponse.json({
      headers: Object.keys(rows[0]),
      ourFields: OUR_FIELDS,
      suggestedMapping: suggestMapping(Object.keys(rows[0])),
      rows: rows.slice(0, 200),
      total: rows.length,
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
