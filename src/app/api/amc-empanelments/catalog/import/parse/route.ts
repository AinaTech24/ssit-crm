import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/amc-empanelments/catalog/import/parse  multipart/form-data: file=<xlsx|csv>
 *
 * Same contract as every other importer, so the shared ImportWizard drives it.
 * This one loads the AMC LIST — the names offered in the AMC dropdown when an
 * empanelment is added — not the empanelments themselves.
 */

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

const OUR_FIELDS = [
  { key: "amcName", label: "AMC name" },
  { key: "amcCode", label: "AMC code (optional)" },
];

function suggestMapping(headers: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  const patterns: Array<[RegExp, string]> = [
    [/code/i, "amcCode"],
    [/amc|name|fund|house/i, "amcName"],
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
    requireAny(session.roles, ["amc_empanelment.add"], session.permissions);

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
    if (rows.length > 2000) return NextResponse.json({ error: "too many rows (max 2000)" }, { status: 413 });

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
