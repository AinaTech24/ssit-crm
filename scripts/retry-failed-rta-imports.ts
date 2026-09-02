/**
 * Re-run RTA imports that failed for a recoverable reason (almost always a wrong
 * or missing ZIP password), using the firm's CURRENT stored credentials.
 *
 * The attachment bytes were pushed to S3 before the original job ran, so a retry
 * needs no new mail — it re-queues the SAME file through the SAME rta.import
 * pipeline the poller uses. Nothing is re-downloaded and nothing is re-sent.
 *
 * Usage (inside the worker container, which has the app + creds):
 *   npx tsx scripts/retry-failed-rta-imports.ts            # dry run — lists only
 *   npx tsx scripts/retry-failed-rta-imports.ts --commit   # actually re-queue
 *   npx tsx scripts/retry-failed-rta-imports.ts --commit --tenant <uuid>
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { getMailbackPasswords } from "@/lib/rta/mailback-config";
import { Q } from "@/workers/queues";

const COMMIT = process.argv.includes("--commit");
const tenantArg = process.argv[process.argv.indexOf("--tenant") + 1];
const TENANT = process.argv.includes("--tenant") ? tenantArg : null;

/** Kinds handled by the rich (client-book) engine rather than the feed processor. */
const RICH_KINDS = new Set(["folio_master_dump", "cas_holdings"]);
const SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

/**
 * Only retry failures that a credential fix can actually resolve. A file whose
 * FORMAT wasn't recognised will fail identically on a retry, so re-queueing it
 * just churns the queue and rewrites history for no gain.
 */
const RETRYABLE = /invalid password|could not open the zip|password/i;

type Row = {
  id: string;
  tenant_id: string;
  source: string;
  kind: string;
  file_name: string;
  file_key: string;
  remarks: string | null;
  /** Raw driver value — a string via tx.execute(), not a Date. */
  created_at: string;
};

/** Timestamps come back from tx.execute() as strings, so normalise for display. */
const when = (v: unknown): string => String(v ?? "").replace("T", " ").slice(0, 16);

async function main() {
  const rows = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT id, tenant_id, source, kind, file_name, file_key, remarks, created_at
      FROM rta_file_imports
      WHERE status = 'failed'
        AND deleted_at IS NULL
        AND file_key IS NOT NULL
        ${TENANT ? sql`AND tenant_id = ${TENANT}::uuid` : sql``}
      ORDER BY created_at ASC
    `);
    return r.rows as unknown as Row[];
  });

  const retryable = rows.filter((r) => RETRYABLE.test(r.remarks ?? ""));
  const skipped = rows.filter((r) => !RETRYABLE.test(r.remarks ?? ""));

  console.log(`Found ${rows.length} failed import(s): ${retryable.length} retryable, ${skipped.length} not.`);
  for (const s of skipped) {
    console.log(`  SKIP  ${s.source}/${s.kind}  ${s.file_name?.slice(0, 40)}  — ${(s.remarks ?? "").slice(0, 70)}`);
  }
  if (!retryable.length) return;

  // Cache per-tenant credentials so we read them once, not once per file.
  const pwCache = new Map<string, { camsPassword?: string | null; kfintechPassword?: string | null }>();
  const pwFor = async (tenantId: string) => {
    if (!pwCache.has(tenantId)) {
      pwCache.set(tenantId, await withTenant(tenantId, async (tx) => getMailbackPasswords(tx, tenantId)));
    }
    return pwCache.get(tenantId)!;
  };

  let queued = 0;
  let noPassword = 0;

  for (const r of retryable) {
    const pw = await pwFor(r.tenant_id);
    const password = (r.source === "cams" ? pw.camsPassword : pw.kfintechPassword) || undefined;
    if (!password) {
      console.log(`  NO-PW ${r.source}/${r.kind}  ${r.file_name?.slice(0, 40)} — no ${r.source} password saved; skipping`);
      noPassword++;
      continue;
    }

    console.log(
      `  ${COMMIT ? "RETRY" : "would"} ${r.source}/${r.kind}  ${r.file_name?.slice(0, 46)}  (${when(r.created_at)})`
    );
    if (!COMMIT) continue;

    // Back to 'uploaded' so the row reflects in-flight state and the worker's
    // already-finished guard doesn't short-circuit the re-run.
    await withTenant(r.tenant_id, async (tx) => {
      await tx.execute(sql`
        UPDATE rta_file_imports
        SET status = 'uploaded', remarks = 'Re-queued after credential update', parsed_at = NULL
        WHERE id = ${r.id}::uuid
      `);
    });

    const jobOpts = { attempts: 1, removeOnComplete: true, removeOnFail: { age: 3600 } } as const;
    if (RICH_KINDS.has(r.kind)) {
      await Q.rtaImport().add(
        "rich-import",
        {
          mode: "rich",
          importId: r.id,
          tenantId: r.tenant_id,
          key: r.file_key,
          filename: r.file_name,
          password,
          rta: r.source,
          reportType: "",
          dryRun: false,
          assignToMe: false,
          userId: SYSTEM_USER,
          roles: [],
        },
        jobOpts
      );
    } else {
      await Q.rtaImport().add(
        "import",
        {
          importId: r.id,
          tenantId: r.tenant_id,
          source: r.source,
          kind: r.kind,
          key: r.file_key,
          filename: r.file_name,
          password,
          userId: SYSTEM_USER,
          roles: [],
        },
        jobOpts
      );
    }
    queued++;
  }

  console.log(
    COMMIT
      ? `\nRe-queued ${queued} import(s).${noPassword ? ` ${noPassword} skipped for a missing password.` : ""}`
      : `\nDry run — nothing queued. Re-run with --commit to retry ${retryable.length} file(s).`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("retry failed:", e);
    process.exit(1);
  });
