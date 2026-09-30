import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/leave-applications/import/parse  multipart/form-data: file=<xlsx|csv>
 *
 * Returns headers + a suggested column mapping + the first 200 rows, the same
 * contract every other importer uses so the shared ImportWizard drives this one
 * too.
 *
 * Bulk leave exists for the firm that already tracks leave in a spreadsheet and
 * is moving it in, and for the year's approved leave that nobody is going to
 * re-file by hand. Gated on firm-wide leave administration: filing leave for
 * OTHER people in bulk is an admin act, not something an employee does for
 * themselves.
 */

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

const OUR_FIELDS = [
  { key: "employee", label: "Employee (name or email)" },
  { key: "fromDate", label: "From date" },
  { key: "toDate", label: "To date (blank = same day)" },
  { key: "duration", label: "Duration (full_day / half_day)" },
  { key: "reason", label: "Reason" },
  { key: "status", label: "Status (requested / approved / rejected / cancelled)" },
  { key: "noOfDays", label: "No. of days (blank = calculated)" },
];

function suggestMapping(headers: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  const patterns: Array<[RegExp, string]> = [
    // "To" before the generic date patterns, or "Date To" maps to fromDate.
    [/\bto\b.*date|end.?date|till|until/i, "toDate"],
    [/\bfrom\b.*date|start.?date|^date$|leave.?date/i, "fromDate"],
    [/employee|staff|member|name|e.?mail/i, "employee"],
    [/duration|half.?day|full.?day/i, "duration"],
    [/reason|purpose|remark|note/i, "reason"],
    [/status|state|approval/i, "status"],
    [/days?|no\.?.?of.?days|count/i, "noOfDays"],
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
    requireCap(session.roles, "leave.manage.all", session.permissions);

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
