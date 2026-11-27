import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/engagement/gifts/import/template - the sample Excel for the bulk gift upload: the columns the importer
 * understands, two example rows, and a "How to fill" sheet.
 */

import * as XLSX from "xlsx";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { GIFT_CATEGORY_LABEL, GIFT_CATEGORIES, GIFT_GRADES_BY_CATEGORY } from "@/lib/gifts/catalogue";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.edit.all", "investor.edit.assigned", "gifting.manage"], session.permissions);

    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const day = today.split("-").reverse().join("-"); // dd-mm-yyyy
    const sample = XLSX.utils.aoa_to_sheet([
      ["Client (name or PAN)", "Category", "Grade", "Occasion", "Gift", "Cost", "Given on", "Delivered on", "Notes"],
      ["EXAMPLE CLIENT NAME", "Hamper", "A", "festival", "Diwali hamper", 500, day, day, "Delete the example rows before uploading"],
      ["ABCDE1234F", "Other", "A", "birthday", "Pen set", 250, day, "", ""],
    ]);
    sample["!cols"] = [28, 12, 8, 14, 22, 8, 14, 14, 42].map((wch) => ({ wch }));

    const help = XLSX.utils.aoa_to_sheet([
      ["Column", "What to write"],
      ["Client (name or PAN)", "Exactly as in the CRM, or the PAN (use the PAN when two clients share a name). Required."],
      ["Given on", "Day first: 27-11-2026. Required."],
      ["Category", GIFT_CATEGORIES.map((c) => GIFT_CATEGORY_LABEL[c]).join(", ") + " (anything else is saved as Other with that text)"],
      ["Grade", GIFT_CATEGORIES.map((c) => `${GIFT_CATEGORY_LABEL[c]}: ${GIFT_GRADES_BY_CATEGORY[c].join("/")}`).join("; ")],
      ["Occasion", "birthday, anniversary, festival or other"],
      ["Gift", "A short title. Optional."],
      ["Cost", "Rupees, numbers only. Optional."],
      ["Delivered on", "Day first. Leave blank if not delivered yet."],
    ]);
    help["!cols"] = [{ wch: 24 }, { wch: 110 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sample, "Gifts");
    XLSX.utils.book_append_sheet(wb, help, "How to fill");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="client-gifts-sample.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
