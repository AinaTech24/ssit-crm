import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/amc-empanelments/import/parse  multipart/form-data: file=<xlsx|csv>
 *
 * Same contract as every other importer, so the shared ImportWizard drives it.
 * A firm joining the platform already has its panel in a spreadsheet — codes,
 * distributor codes, the RM and ops contact for each AMC — and re-typing thirty
 * of them by hand is the wrong first hour.
 */

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

const OUR_FIELDS = [
  { key: "amcName", label: "AMC name" },
  { key: "amcCode", label: "AMC code" },
  { key: "category", label: "Category / product line" },
  { key: "distributorCode", label: "Distributor code (ours with this AMC)" },
  { key: "empanelmentDate", label: "Empanelment date" },
  { key: "status", label: "Status (empanelled / pending / terminated)" },
  { key: "rmName", label: "AMC RM — name" },
  { key: "rmEmail", label: "AMC RM — email" },
  { key: "rmPhone", label: "AMC RM — phone" },
  { key: "opsName", label: "Ops contact — name" },
  { key: "opsEmail", label: "Ops contact — email" },
  { key: "opsPhone", label: "Ops contact — phone" },
  { key: "escalationName", label: "Escalation — name" },
  { key: "escalationEmail", label: "Escalation — email" },
  { key: "escalationPhone", label: "Escalation — phone" },
  { key: "portalUrl", label: "Portal URL" },
  { key: "remarks", label: "Remarks" },
];

function suggestMapping(headers: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  // Ordered: the qualified contact columns before the bare name/email/phone,
  // so "Ops Email" does not get claimed by the generic email pattern.
  const patterns: Array<[RegExp, string]> = [
    [/ops.*e.?mail|operations?.*e.?mail/i, "opsEmail"],
    [/ops.*phone|operations?.*(phone|mobile)/i, "opsPhone"],
    [/ops|operations?/i, "opsName"],
    [/escalat.*e.?mail/i, "escalationEmail"],
    [/escalat.*(phone|mobile)/i, "escalationPhone"],
    [/escalat/i, "escalationName"],
    [/rm.*e.?mail|relationship.*e.?mail/i, "rmEmail"],
    [/rm.*(phone|mobile)|relationship.*(phone|mobile)/i, "rmPhone"],
    [/\brm\b|relationship.?manager/i, "rmName"],
    [/distributor.?code|arn.?code|broker.?code/i, "distributorCode"],
    [/amc.?code|fund.?house.?code|^code$/i, "amcCode"],
    [/amc.?name|fund.?house|^amc$|^name$/i, "amcName"],
    [/category|product.?line|segment/i, "category"],
    [/empanel.*date|onboard.*date|^date$/i, "empanelmentDate"],
    [/status|state/i, "status"],
    [/portal|url|website|link/i, "portalUrl"],
    [/remark|note|comment/i, "remarks"],
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
