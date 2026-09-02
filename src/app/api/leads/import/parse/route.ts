import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/leads/import/parse  multipart/form-data: file=<xlsx|csv>
 * Returns parsed headers + suggested mapping + first 200 rows for preview.
 */

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { and, asc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { customFieldDefs } from "@/db/schema";

export const dynamic = "force-dynamic";

// { key, label } — every field the new-lead form captures, so a column can map
// to any of them. The label shows in the mapping dropdown.
const OUR_FIELDS = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone / mobile" },
  { key: "altPhone", label: "Alternate phone" },
  { key: "altEmail", label: "Alternate email" },
  { key: "pan", label: "PAN" },
  { key: "city", label: "City" },
  { key: "pincode", label: "Pincode" },
  { key: "source", label: "Source" },
  { key: "campaignName", label: "Campaign" },
  { key: "leadType", label: "Lead type (individual / hni / nri / corporate / minor)" },
  { key: "interestedIn", label: "Interested in / products" },
  { key: "occupation", label: "Occupation" },
  { key: "currentInvestments", label: "Current investments" },
  { key: "intendedAmount", label: "Intended amount" },
  { key: "expectedBusinessAmount", label: "Expected business amount (₹)" },
  { key: "aumPotential", label: "AUM potential (under_10l / 10l_50l / 50l_2cr / hni_2cr_plus)" },
  { key: "referredByName", label: "Referred by (name)" },
  { key: "stage", label: "Stage" },
  { key: "score", label: "Score" },
  { key: "nextFollowUpAt", label: "Next follow-up date" },
  { key: "tags", label: "Tags (comma-separated)" },
  { key: "notes", label: "Notes" },
];

function suggestMapping(headers: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  const patterns: Array<[RegExp, string]> = [
    // Specific (alt/lead-type/etc.) BEFORE the generic phone/email/amount.
    [/alt.*phone|secondary.*phone|phone.?2/i, "altPhone"],
    [/alt.*e.?mail|secondary.*e.?mail|email.?2/i, "altEmail"],
    [/lead.?type|category.*lead|client.?type/i, "leadType"],
    [/aum.?potential|potential.?aum|aum.?range|wealth.?band/i, "aumPotential"],
    [/expected.*business|business.?(amount|value)|expected.?aum/i, "expectedBusinessAmount"],
    [/current.?invest|existing.?invest|holdings?/i, "currentInvestments"],
    [/referr?ed.?by|reference.?name|referrer/i, "referredByName"],
    [/occupation|profession|designation|job/i, "occupation"],
    [/\bpan\b|pan.?(no|number|card)/i, "pan"],
    [/pin.?code|postal|zip/i, "pincode"],
    [/^(lead.?)?name|full.?name/i, "name"],
    [/^email|e.?mail/i, "email"],
    [/^phone$|mobile|contact/i, "phone"],
    [/^city|town/i, "city"],
    [/source/i, "source"],
    [/campaign/i, "campaignName"],
    [/interest|product/i, "interestedIn"],
    [/(intended|investment|amount).*amount|amount/i, "intendedAmount"],
    [/stage|status/i, "stage"],
    [/score/i, "score"],
    [/next.?follow|follow.?up.?date/i, "nextFollowUpAt"],
    [/\btags?\b|labels?/i, "tags"],
    [/note|remark/i, "notes"],
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
    // Importing the firm's book is a manager action — gate parse with the same
    // capability as the commit step (was requireSession-only).
    requireCap(session.roles, "lead.edit.all", session.permissions);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "file too large (max 10MB)" }, { status: 413 });

    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return NextResponse.json({ error: "no sheet found" }, { status: 400 });

    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "", raw: false });
    if (rows.length === 0) return NextResponse.json({ error: "empty sheet" }, { status: 400 });
    if (rows.length > 5000) return NextResponse.json({ error: "too many rows (max 5000)" }, { status: 413 });

    const headers = Object.keys(rows[0]);

    // Append the firm's custom fields so they're mappable in the dropdown.
    const cfDefs = await withTenant(session.tenantId, (tx) =>
      tx
        .select({ key: customFieldDefs.key, label: customFieldDefs.label })
        .from(customFieldDefs)
        .where(and(eq(customFieldDefs.tenantId, session.tenantId), eq(customFieldDefs.entity, "lead")))
        .orderBy(asc(customFieldDefs.sortOrder))
    );
    const ourFields = [...OUR_FIELDS, ...cfDefs.map((d) => ({ key: d.key, label: `${d.label} (custom)` }))];

    return NextResponse.json({
      headers,
      ourFields,
      suggestedMapping: suggestMapping(headers),
      rows: rows.slice(0, 200),
      total: rows.length,
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
