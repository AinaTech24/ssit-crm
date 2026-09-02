/**
 * Shared RTA ingest helper — reserve an rta_file_imports row, run the
 * processor, and stamp the result. Used by the manual upload route's logic and
 * by the automated feed-ingestion worker so both behave identically (dedupe by
 * checksum, idempotent processing, accurate status).
 */

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { RtaFileKind, RtaSource } from "@/db/schema/rta_imports";
import { processRtaFile } from "./process";

export type IngestArgs = {
  tenantId: string;
  source: RtaSource;
  kind: RtaFileKind;
  fileName: string;
  text: string;
  /** Who/what ingested it (null for the automated feed). */
  uploadedBy?: string | null;
};

export type IngestResult = {
  duplicate?: boolean;
  importId: string | null;
  status: string;
  rowsTotal?: number;
  rowsImported?: number;
  rowsSkipped?: number;
  rowsFailed?: number;
  error?: string | null;
};

export async function ingestRtaText(tx: Tx, args: IngestArgs): Promise<IngestResult> {
  const checksum = createHash("sha256").update(args.text, "utf8").digest("hex");

  // Dedupe — same checksum within this kind/source already imported?
  const dupe = await tx.execute(sql`
    SELECT id, status FROM rta_file_imports
    WHERE tenant_id = ${args.tenantId}::uuid AND kind = ${args.kind} AND source = ${args.source}
      AND file_checksum = ${checksum}
      AND status IN ('completed', 'partial')
    LIMIT 1
  `);
  if (dupe.rows.length > 0) {
    return {
      duplicate: true,
      importId: (dupe.rows[0] as any).id,
      status: (dupe.rows[0] as any).status,
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const reserve = await tx.execute(sql`
    INSERT INTO rta_file_imports (
      tenant_id, source, kind, period_start, period_end,
      file_name, file_key, file_size_bytes, file_checksum, status, uploaded_by
    ) VALUES (
      ${args.tenantId}::uuid, ${args.source}, ${args.kind}, ${today}::date, ${today}::date,
      ${args.fileName}, ${"feed:" + checksum.slice(0, 12)},
      ${Buffer.byteLength(args.text, "utf8")}, ${checksum}, 'parsing',
      ${args.uploadedBy ?? null}
    )
    RETURNING id
  `);
  const importId = (reserve.rows[0] as any).id as string;

  let outcome;
  let failure: string | null = null;
  try {
    outcome = await processRtaFile(tx, {
      tenantId: args.tenantId,
      source: args.source,
      kind: args.kind,
      text: args.text,
    });
  } catch (e: any) {
    failure = e?.message ?? "Unknown parser error";
  }

  if (failure || !outcome) {
    await tx.execute(sql`
      UPDATE rta_file_imports
        SET status = 'failed', parsed_at = now(), remarks = ${failure ?? "unknown error"}
      WHERE id = ${importId}::uuid
    `);
    return { importId, status: "failed", error: failure };
  }

  const status =
    outcome.rowsFailed > 0 || outcome.rowsSkipped > 0
      ? outcome.rowsImported === 0
        ? "failed"
        : "partial"
      : "completed";

  await tx.execute(sql`
    UPDATE rta_file_imports
      SET status = ${status}, parsed_at = now(),
          period_start = ${outcome.periodStart}::date,
          period_end = ${outcome.periodEnd}::date,
          rows_total = ${outcome.rowsTotal}, rows_imported = ${outcome.rowsImported},
          rows_skipped = ${outcome.rowsSkipped}, rows_failed = ${outcome.rowsFailed},
          errors = ${JSON.stringify(outcome.errors)}::jsonb
    WHERE id = ${importId}::uuid
  `);

  return {
    importId,
    status,
    rowsTotal: outcome.rowsTotal,
    rowsImported: outcome.rowsImported,
    rowsSkipped: outcome.rowsSkipped,
    rowsFailed: outcome.rowsFailed,
  };
}
