import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const OUR_FIELDS = [
  "pan", "folioNumber", "amcCode", "amcName", "schemeCode", "schemeName",
  "type", "direction", "amount", "units", "nav", "orderDate", "status", "reasonCode", "sourceFeed",
  // ── Folio-level attributes (stored on the folio the transaction belongs to) ──
  "trnsId", "folioOwner", "holdingMode", "folioStatus", "folioUniqueKey", "sipFlag",
  "bank", "branch", "bankCity", "ifsc",
  "folioStartDate", "lastTransactionDate",
  "investedAmount", "currentValue", "xirr", "totalUnits", "loadFreeUnits", "sipAmount", "dayChangeValue",
  // ── Nominee (on the folio) ──
  "nomineeName", "nomineeRelation", "nomineeAddress", "nomineeCity", "nomineeState", "nomineePincode", "nomineePercent",
];

function suggestMapping(headers: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  const p: Array<[RegExp, string]> = [
    [/^pan/i, "pan"],
    [/folio/i, "folioNumber"],
    [/amc.?code|^amc$/i, "amcCode"],
    [/scheme.?code/i, "schemeCode"],
    [/scheme.?name|scheme$/i, "schemeName"],
    [/^type|tr.?type|transaction.?type/i, "type"],
    [/direction|inflow|outflow/i, "direction"],
    [/amount|amt$/i, "amount"],
    [/units/i, "units"],
    [/^nav/i, "nav"],
    [/(order|tr|trans).?date|date$/i, "orderDate"],
    [/status/i, "status"],
    [/(reason|reject).?code/i, "reasonCode"],
    [/source|feed/i, "sourceFeed"],
    // Folio-level attributes
    [/amc.?name/i, "amcName"],
    [/trns.?id|transaction.?id/i, "trnsId"],
    [/folio.?owner|mf.?folio.?owner|owner/i, "folioOwner"],
    [/holding.?mode/i, "holdingMode"],
    [/folio.?status/i, "folioStatus"],
    [/folio.?unique/i, "folioUniqueKey"],
    [/sip.?flag/i, "sipFlag"],
    [/ifsc/i, "ifsc"],
    [/bank.?city/i, "bankCity"],
    [/branch/i, "branch"],
    [/^bank|bank.?name/i, "bank"],
    [/folio.?start|start.?date/i, "folioStartDate"],
    [/last.?transaction/i, "lastTransactionDate"],
    [/invested.?amount|investment.?amount/i, "investedAmount"],
    [/current.?value|market.?value/i, "currentValue"],
    [/xirr/i, "xirr"],
    [/total.?units/i, "totalUnits"],
    [/load.?free/i, "loadFreeUnits"],
    [/sip.?amount/i, "sipAmount"],
    [/day.?change/i, "dayChangeValue"],
    [/nominee.?name/i, "nomineeName"],
    [/nominee.?relation/i, "nomineeRelation"],
    [/nominee.?address/i, "nomineeAddress"],
    [/nominee.?city/i, "nomineeCity"],
    [/nominee.?state/i, "nomineeState"],
    [/nominee.?pin|nominee.?pincode/i, "nomineePincode"],
    [/nominee.?percent|nominee.?%|nominee.?share/i, "nomineePercent"],
  ];
  for (const h of headers) {
    for (const [re, f] of p) {
      if (re.test(h)) {
        m[h] = f;
        break;
      }
    }
  }
  return m;
}

export async function POST(req: NextRequest) {
  try {
    await requireSession();
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "file too large" }, { status: 413 });

    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return NextResponse.json({ error: "no sheet" }, { status: 400 });

    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "", raw: false });
    if (rows.length === 0) return NextResponse.json({ error: "empty" }, { status: 400 });
    if (rows.length > 10000) return NextResponse.json({ error: "max 10000 rows" }, { status: 413 });

    const headers = Object.keys(rows[0]);
    return NextResponse.json({
      headers,
      ourFields: OUR_FIELDS,
      suggestedMapping: suggestMapping(headers),
      rows: rows.slice(0, 200),
      total: rows.length,
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
