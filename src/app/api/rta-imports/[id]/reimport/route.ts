/**
 * POST /api/rta-imports/[id]/reimport — re-run one stored import.
 *
 * Use when an import left rows on the table: a transaction feed that skipped
 * rows because their folio master had not arrived yet, or a file rejected
 * because the right ZIP password wasn't saved at the time. Both become
 * importable once the missing piece lands, and the source file is still in
 * storage — so this re-queues the SAME object through the SAME pipeline.
 *
 * Nothing is re-downloaded and no mail is re-sent. Row writes upsert, so a
 * repeat is idempotent.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { withTenant } from "@/db/client";
import { getMailbackPasswords, passwordCandidates } from "@/lib/rta/mailback-config";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { Q } from "@/workers/queues";

export const dynamic = "force-dynamic";

/** Master / holdings go to the rich engine; everything else to the feed processor. */
const RICH_KINDS = new Set(["folio_master_dump", "cas_holdings"]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  if (!can(session.roles, "transactions.execute", session.permissions)) {
    return NextResponse.json({ error: "You need RTA import access to re-run an import." }, { status: 403 });
  }

  const row = await withTenant(session.tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT id, source, kind, file_name, file_key, status
      FROM rta_file_imports
      WHERE id = ${id}::uuid AND deleted_at IS NULL
      LIMIT 1
    `);
    return (r.rows[0] as any) ?? null;
  });

  if (!row) return NextResponse.json({ error: "Import not found." }, { status: 404 });
  if (!row.file_key) {
    return NextResponse.json(
      { error: "The source file is no longer stored, so this import cannot be re-run. Re-request the report from the registrar." },
      { status: 409 }
    );
  }
  // A completed import purges its own file by design — there is nothing to read.
  if (row.status === "completed") {
    return NextResponse.json({ error: "This import already completed; there is nothing to re-run." }, { status: 409 });
  }

  const cfg = await withTenant(session.tenantId, async (tx) => getMailbackPasswords(tx, session.tenantId));
  // Offer every saved secret regardless of the label it sits under — labels name
  // mailboxes for humans, they do not route, and they get mixed up in practice.
  const passwords = [
    ...new Set([
      ...passwordCandidates(cfg, "cams").map((e) => e.password),
      ...passwordCandidates(cfg, "kfintech").map((e) => e.password),
    ]),
  ];

  const opts = { attempts: 1, removeOnComplete: true, removeOnFail: { age: 3600 } } as const;
  if (RICH_KINDS.has(row.kind)) {
    await Q.rtaImport().add(
      "rich-import",
      {
        mode: "rich", importId: row.id, tenantId: session.tenantId,
        key: row.file_key, filename: row.file_name, passwords,
        rta: row.source, reportType: "", dryRun: false, assignToMe: false,
        userId: session.userId, branchId: session.branchId, roles: session.roles,
      },
      opts
    );
  } else {
    await Q.rtaImport().add(
      "import",
      {
        importId: row.id, tenantId: session.tenantId, source: row.source, kind: row.kind,
        key: row.file_key, filename: row.file_name, passwords,
        userId: session.userId, branchId: session.branchId, roles: session.roles,
      },
      opts
    );
  }

  await withTenant(session.tenantId, async (tx) => {
    await recordAudit(tx, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "rta_import.reimport",
      entityType: "rta_file_import",
      entityId: row.id,
      before: { status: row.status },
      after: { queued: true },
      ...clientMetaFromHeaders(req.headers),
    });
  });

  return NextResponse.json({ ok: true, importId: row.id, status: "queued" });
}
