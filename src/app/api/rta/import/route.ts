/**
 * RTA reverse-feed import.
 *   POST /api/rta/import   (multipart/form-data)
 *     file       — the RTA mailback .csv OR password-protected .zip
 *     password   — zip password (only when uploading a .zip; never persisted)
 *     dryRun     — "1" to preview (parse + counts, no DB writes)
 *     assignToMe — "1" to set rmId = current user on newly-created investors
 *
 * Detects the RTA + report type from the file header, parses it, and (unless
 * dryRun) upserts investors + folios. Returns a summary either way.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { parseRtaCsv, parseRtaRows } from "@/lib/rta";
import { importRtaFolios } from "@/lib/rta/import";
import { extractRtaFileFromZip } from "@/lib/rta/unzip";
import { loadTenantLicense } from "@/lib/auth/license";
import { isSpreadsheet, readSpreadsheetToRows } from "@/lib/rta/xls";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // Importing the client master is an admin action — owners + ops/back-office.
    const allowed =
      can(session.roles, "investor.edit.all", session.permissions) ||
      can(session.roles, "dashboard.view.owner", session.permissions);
    if (!allowed) {
      return NextResponse.json({ error: "You don't have permission to import the client master." }, { status: 403 });
    }

    const form = await req.formData();
    const file = form.get("file");
    const password = (form.get("password") as string) || undefined;
    const dryRun = form.get("dryRun") === "1";
    const assignToMe = form.get("assignToMe") === "1";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }

    const uploaded = new Uint8Array(await file.arrayBuffer());

    // A zip (PK magic) is unpacked with the password to its inner file; otherwise
    // the upload IS the data file.
    let data: Uint8Array = uploaded;
    let innerName = file.name;
    const isZip = uploaded.length > 1 && uploaded[0] === 0x50 && uploaded[1] === 0x4b;
    if (isZip) {
      try {
        const r = await extractRtaFileFromZip(uploaded, password);
        data = r.data;
        innerName = r.filename;
      } catch (e: any) {
        return NextResponse.json(
          { error: `Could not open the zip — ${e?.message ?? "wrong password or unsupported archive"}.` },
          { status: 400 }
        );
      }
    }

    // Binary Excel (.xls/.xlsx — e.g. the CAMS feed) is read via SheetJS; anything
    // else is treated as a latin-1 CSV.
    const parsed = isSpreadsheet(data, innerName)
      ? parseRtaRows(readSpreadsheetToRows(data))
      : parseRtaCsv(new TextDecoder("latin1").decode(data));
    if (parsed.source === "unknown" || parsed.folios.length === 0) {
      return NextResponse.json(
        {
          error: parsed.warnings[0] ?? "Unrecognised RTA file — header did not match a known report.",
          source: parsed.source,
          reportType: parsed.reportType,
          totalRows: parsed.totalRows,
        },
        { status: 400 }
      );
    }

    // Validate the file against what the user selected in the guided flow.
    const selectedRta = ((form.get("rta") as string) || "").trim();
    const selectedReport = ((form.get("reportType") as string) || "").trim();
    if (selectedRta && parsed.source !== selectedRta) {
      return NextResponse.json(
        { error: `You selected ${selectedRta.toUpperCase()}, but this file looks like ${parsed.source.toUpperCase()} ${parsed.reportType}. Pick the matching RTA, or the right file.` },
        { status: 400 }
      );
    }
    if (selectedReport && parsed.reportType && selectedReport !== parsed.reportType) {
      return NextResponse.json(
        { error: `You selected file type ${selectedReport}, but this file is ${parsed.reportType}. Pick the matching file type.` },
        { status: 400 }
      );
    }

    const license = await loadTenantLicense(session.tenantId, session.roles);
    const summary = await withTenant(
      session.tenantId,
      (tx) =>
        importRtaFolios(tx as any, session.tenantId, parsed.folios, {
          dryRun,
          assignRmId: assignToMe ? session.userId : null,
          reportType: parsed.reportType,
          kind: parsed.kind === "holdings" ? "holdings" : parsed.kind === "full" ? "full" : "master",
          quotaCap: license.maxInvestors,
        }),
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    return NextResponse.json({
      ok: true,
      source: parsed.source,
      reportType: parsed.reportType,
      totalRows: parsed.totalRows,
      missingPan: parsed.missingPan,
      summary,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
