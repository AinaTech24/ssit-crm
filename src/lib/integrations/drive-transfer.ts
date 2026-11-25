/**
 * Moves an uploaded file from our storage into the firm's Google Drive, in the background.
 *
 * `startDriveTransfer` returns at once; the copy runs on this server process, at most two at a
 * time (a batch of 20 videos simply queues). Progress is the `status` on the drive_uploads row,
 * which the screens poll. On success the staging copy is deleted and the Drive link is kept; on
 * failure the row says why and can be retried. A row stuck "uploading" (the server restarted
 * mid-copy) is treated as failed by `effectiveStatus`, so it can be retried too.
 */

import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { driveUploads } from "@/db/schema";
import { copyStoredFileToDrive, getDriveConfig, saveDriveConfig } from "@/lib/integrations/google-drive";
import { deleteObject } from "@/lib/storage/s3";

const MAX_PARALLEL = 2;
let running = 0;
const waiting: Array<() => void> = [];

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/** A copy that has not reported for this long is dead (process restarted); treat it as failed. */
const STALE_MS = 25 * 60_000;

export function effectiveStatus(row: { status: string; updatedAt: Date | string | null }): string {
  if (row.status === "uploading" && row.updatedAt && Date.now() - new Date(row.updatedAt).getTime() > STALE_MS) return "failed";
  return row.status;
}

async function mark(tenantId: string, id: string, patch: Partial<typeof driveUploads.$inferInsert>) {
  await withTenant(tenantId, (tx) =>
    tx
      .update(driveUploads)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(driveUploads.id, id), eq(driveUploads.tenantId, tenantId)))
  );
}

async function run(tenantId: string, id: string): Promise<void> {
  const row = await withTenant(tenantId, async (tx) => {
    const [r] = await tx
      .select()
      .from(driveUploads)
      .where(and(eq(driveUploads.id, id), eq(driveUploads.tenantId, tenantId)))
      .limit(1);
    return r ?? null;
  });
  if (!row || row.status === "done") return;
  try {
    if (!row.storageKey) throw new Error("There is no stored file to copy.");
    const cfg = await withTenant(tenantId, (tx) => getDriveConfig(tx, tenantId));
    if (!cfg?.refreshToken) throw new Error("Google Drive is not connected. Connect it in Settings → Google Drive.");

    await mark(tenantId, id, { status: "uploading", attempts: row.attempts + 1, error: null });
    const out = await copyStoredFileToDrive(cfg, {
      storageKey: row.storageKey,
      fileName: row.fileName,
      contentType: row.contentType ?? "application/octet-stream",
      folderDate: String(row.folderDate).slice(0, 10),
    });
    // Remember the root folder so later files skip the lookup.
    if (out.newRootFolderId) {
      await withTenant(tenantId, (tx) => saveDriveConfig(tx, tenantId, { ...cfg, rootFolderId: out.newRootFolderId }));
    }
    // Drive has confirmed the whole file: record it FIRST, then drop our copy.
    await mark(tenantId, id, {
      status: "done",
      driveFileId: out.fileId,
      driveUrl: out.url,
      driveFolder: out.folder,
      error: null,
      finishedAt: new Date(),
    });
    await deleteObject(row.storageKey).catch(() => {});
    await mark(tenantId, id, { storageKey: null });
  } catch (e: any) {
    await mark(tenantId, id, { status: "failed", error: String(e?.message ?? e).slice(0, 500) }).catch(() => {});
  }
}

/** Queue the copy and return immediately. */
export function startDriveTransfer(tenantId: string, id: string): void {
  void slot(() => run(tenantId, id)).catch(() => {});
}
