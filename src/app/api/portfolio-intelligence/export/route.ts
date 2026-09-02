import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/portfolio-intelligence/export?mine=1
 *
 * Streams the book analytics (asset-class allocation, AMC concentration, top
 * holdings, concentration flags) as a single CSV for IC decks / review packs.
 * Same scope rules as the page (firm-wide, or own book with mine=1 / non-owners).
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { getPortfolioIntel } from "@/lib/portfolio/intelligence";

export const dynamic = "force-dynamic";

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function row(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const canFirm = can(session.roles, "dashboard.view.owner", (session as any).permissions);
    const mine = req.nextUrl.searchParams.get("mine") === "1" || !canFirm;

    const intel = await withTenant(
      session.tenantId,
      (tx) => getPortfolioIntel(tx as any, { tenantId: session.tenantId, userId: session.userId, firmWide: !mine }),
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    const lines: string[] = [];
    lines.push(row([`Portfolio Intelligence — ${mine ? "My book" : "Firm-wide"}`]));
    lines.push(row(["Book AUM", intel.totalAum, "Folios", intel.folioCount, "Investors", intel.investorCount]));
    lines.push(row(["Holdings classified %", intel.classifiedPct, "AUM with detail %", intel.coveragePct, "Direct-plan %", intel.directPlanPct]));
    lines.push("");

    lines.push(row(["Asset class", "Value", "% of classified"]));
    for (const c of intel.byClass) lines.push(row([c.label, c.value, c.pct]));
    lines.push("");

    lines.push(row(["AMC", "Value", "% of book"]));
    for (const a of intel.byAmc) lines.push(row([a.label, a.value, a.pct]));
    lines.push("");

    lines.push(row(["Top holding", "AMC", "Class", "Value", "% of holdings"]));
    for (const s of intel.topSchemes) lines.push(row([s.scheme, s.amc ?? "", s.klass, s.value, s.pct]));
    lines.push("");

    if (intel.concentratedClients.length) {
      lines.push(row(["Concentrated client", "Flag", "AUM"]));
      for (const c of intel.concentratedClients) lines.push(row([c.name, c.reason, c.aum]));
      lines.push("");
    }

    if (intel.warnings.length) {
      lines.push(row(["Risk signals"]));
      for (const w of intel.warnings) lines.push(row([w.level, w.text]));
    }

    const csv = "﻿" + lines.join("\n"); // BOM so Excel reads UTF-8 + ₹ correctly
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="portfolio-intelligence-${mine ? "mybook" : "firm"}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
