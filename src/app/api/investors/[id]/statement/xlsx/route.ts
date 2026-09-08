import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/investors/[id]/statement/xlsx
 *
 * The portfolio valuation as a spreadsheet — the same numbers the PDF prints,
 * from the same valueInvestor() call, so the two can never disagree. The PDF is
 * what you send a client; this is what the client (or the RM) actually works
 * with, because a PDF table cannot be sorted, filtered or pasted into a model.
 *
 * Two sheets: the per-scheme holdings, and a Summary carrying the portfolio
 * totals plus the coverage caveat, so a spreadsheet forwarded on its own still
 * says what it is and what it excludes.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { investors } from "@/db/schema";
import { assertCanViewClient } from "@/lib/investors/access";
import { valueInvestor } from "@/lib/finance/valuation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Percent as a readable number, not a decimal fraction. */
function pct(v: number | null | undefined): number | string {
  return v == null || !isFinite(v) ? "" : Math.round(v * 1000) / 10;
}
function num(v: number | null | undefined): number | string {
  return v == null || !isFinite(v) ? "" : Math.round(v * 100) / 100;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const { id } = await params;

    const built = await withTenant(session.tenantId, async (tx) => {
      const [inv] = await tx
        .select({
          id: investors.id, name: investors.name, pan: investors.pan,
          rmId: investors.rmId, branchId: investors.branchId,
        })
        .from(investors)
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
        .limit(1);
      if (!inv) return null;
      // Honours the per-tenant data wall. Without it the export stayed open
      // even for a firm that had walled its books.
      await assertCanViewClient(tx, session, inv);
      return { inv, valuation: await valueInvestor(tx, id) };
    });
    if (!built) return NextResponse.json({ error: "not found" }, { status: 404 });

    const { inv, valuation } = built;

    const holdings = (valuation.holdings ?? []).map((h) => ({
      Scheme: h.schemeName ?? "",
      AMC: h.amcName ?? "",
      Folio: h.folioNumbers?.length ? h.folioNumbers.join(", ") : (h.folioNumber ?? ""),
      Type: h.kind ?? "",
      Units: num(h.netUnits),
      "Invested (net)": num(h.investedNet),
      NAV: num(h.latestNav),
      "NAV date": h.navDate ?? "",
      "Current value": num(h.currentValue),
      Gain: num(h.gain),
      "XIRR %": pct(h.xirr),
      "Realised gain": num(h.realisedGain),
      Dividend: num(h.dividend),
      "First purchase": h.startDate ? String(h.startDate).slice(0, 10) : "",
      // Spelled out rather than TRUE/FALSE: a reader scanning the column should
      // not have to work out which way round the flag runs.
      Priced: h.priced ? "Priced" : "No live NAV",
    }));

    const summary = [
      ["Client", inv.name ?? ""],
      ["PAN", inv.pan ?? ""],
      ["Generated", new Date().toISOString().slice(0, 10)],
      [],
      ["Current value (priced holdings)", num(valuation.currentValue)],
      ["Invested — net (all holdings)", num(valuation.investedNet)],
      ["Invested — priced holdings", num(valuation.pricedInvested)],
      ["Invested — not priced", num(valuation.unpricedInvested)],
      ["Gain", num(valuation.gain)],
      ["Absolute return %", pct(valuation.absoluteReturn)],
      ["XIRR % p.a.", pct(valuation.xirr)],
      [],
      [
        "Note",
        "Gain and returns are calculated over PRICED holdings only. Anything under " +
          '"Invested — not priced" has no live NAV match and is excluded from those figures.',
      ],
    ];

    const wb = XLSX.utils.book_new();
    const wsSummary = XLSX.utils.aoa_to_sheet(summary);
    wsSummary["!cols"] = [{ wch: 34 }, { wch: 62 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

    const wsHoldings = XLSX.utils.json_to_sheet(holdings);
    wsHoldings["!cols"] = [
      { wch: 40 }, { wch: 22 }, { wch: 16 }, { wch: 10 }, { wch: 14 }, { wch: 16 },
      { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 14 },
      { wch: 12 }, { wch: 14 }, { wch: 14 },
    ];
    XLSX.utils.book_append_sheet(wb, wsHoldings, "Holdings");

    const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const safeName = (inv.name ?? "portfolio").replace(/[^\w.\- ]+/g, "_").slice(0, 60);
    const filename = `Portfolio - ${safeName} - ${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
