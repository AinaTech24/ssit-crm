/**
 * RTA mailback inbox — Amazon SES source.
 *
 * SES has no mailbox to log in to. A receipt rule saves each incoming email as one
 * raw file in an S3 bucket instead, so "polling the inbox" here means: list the
 * new files under a prefix, parse each one into the same message shape the IMAP
 * poller produces, hand it to the SAME handler, and remove the file once it has
 * been handled. Everything after that — routing to a firm, the Gmail confirmation
 * code, the attachment classifier, the import queue — is unchanged.
 *
 * Failure behaviour: a file whose handler throws is LEFT in the bucket and tried
 * again on the next tick, up to MAX_ATTEMPTS in this process, then skipped (and
 * logged) so one poison message cannot block the rest. The bucket's own lifecycle
 * rule still removes anything left behind. A file that cannot even be parsed is
 * treated the same way.
 *
 * What the app needs on the bucket: s3:ListBucket on it, s3:GetObject and
 * s3:DeleteObject on the prefix.
 */

import { createHash } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { s3ClientForRegion } from "@/lib/storage/s3";
import { parseInboundSource, type InboundRawMessage } from "@/lib/comms/imap";

export interface SesInboxConfig {
  region: string;
  bucket: string;
  /** e.g. "rta-inbound/" — normalised to end with a slash. */
  prefix: string;
}

const MAX_ATTEMPTS = 5;
const failures = new Map<string, number>();

export function normalisePrefix(p: string | null | undefined): string {
  const t = (p ?? "").trim().replace(/^\/+/, "");
  return t ? (t.endsWith("/") ? t : `${t}/`) : "";
}

/** SES drops a setup-test file when a rule is created; it is not mail. */
export function isMailKey(key: string, prefix: string): boolean {
  if (!key.startsWith(prefix)) return false;
  const name = key.slice(prefix.length);
  if (!name || name.endsWith("/")) return false;
  if (name === "AMAZON_SES_SETUP_NOTIFICATION") return false;
  return true;
}

/** A stable positive integer for a key — the message's "uid" in the shared shape. */
export function uidForKey(key: string): number {
  return parseInt(createHash("sha1").update(key).digest("hex").slice(0, 7), 16);
}

/**
 * Handle up to `limit` new messages. Resolves with how many were handled
 * (processed or given up on). Throws only if the bucket itself cannot be read.
 */
export async function processSesInbox(
  cfg: SesInboxConfig,
  handler: (msg: InboundRawMessage) => Promise<void>,
  limit = 25
): Promise<{ processed: number; skipped: number }> {
  const s3 = s3ClientForRegion(cfg.region);
  const prefix = normalisePrefix(cfg.prefix);
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: prefix, MaxKeys: 200 }));
  const keys = (listed.Contents ?? [])
    .filter((o) => o.Key && isMailKey(o.Key, prefix))
    // Oldest first, so a backlog is worked in the order it arrived.
    .sort((a, b) => (a.LastModified?.getTime() ?? 0) - (b.LastModified?.getTime() ?? 0))
    .map((o) => o.Key as string);

  let processed = 0;
  let skipped = 0;
  for (const key of keys) {
    if (processed >= limit) break;
    if ((failures.get(key) ?? 0) >= MAX_ATTEMPTS) {
      skipped++;
      continue;
    }
    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
      const bytes = Buffer.from(await obj.Body!.transformToByteArray());
      const msg = await parseInboundSource(bytes, uidForKey(key), { includeReceivedFor: true });
      await handler(msg);
      await s3.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
      failures.delete(key);
      processed++;
    } catch (e) {
      const n = (failures.get(key) ?? 0) + 1;
      failures.set(key, n);
      console.error(
        `[rta-inbox:ses] ${key} failed (attempt ${n}/${MAX_ATTEMPTS}): ${(e as Error).message}` +
          (n >= MAX_ATTEMPTS ? " — giving up on this file until the worker restarts" : "")
      );
    }
  }
  return { processed, skipped };
}

/**
 * "Test connection" for the admin screen: can we list the bucket under the prefix?
 * Returns a plain-language reason when not, instead of an AWS error code.
 */
export async function testSesInbox(
  cfg: SesInboxConfig
): Promise<{ ok: true; waiting: number } | { ok: false; error: string }> {
  try {
    const s3 = s3ClientForRegion(cfg.region);
    const prefix = normalisePrefix(cfg.prefix);
    const listed = await s3.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: prefix, MaxKeys: 100 }));
    const waiting = (listed.Contents ?? []).filter((o) => o.Key && isMailKey(o.Key, prefix)).length;
    return { ok: true, waiting };
  } catch (e: any) {
    const code = String(e?.name ?? e?.Code ?? "");
    if (code === "NoSuchBucket") return { ok: false, error: `The bucket "${cfg.bucket}" does not exist in ${cfg.region}. Check the name and region.` };
    if (code === "AccessDenied" || e?.$metadata?.httpStatusCode === 403) {
      return {
        ok: false,
        error:
          "Access denied. The server's AWS role needs s3:ListBucket on the bucket and s3:GetObject + s3:DeleteObject on the prefix (IAM → policy rta-inbound-read).",
      };
    }
    if (code === "PermanentRedirect" || e?.$metadata?.httpStatusCode === 301) {
      return { ok: false, error: `That bucket is in a different region than ${cfg.region}. Check the region.` };
    }
    if (/credential/i.test(String(e?.message))) {
      return { ok: false, error: "The server has no AWS credentials. It needs an IAM role (or access keys) with read access to the bucket." };
    }
    return { ok: false, error: e?.message || "Could not read the bucket." };
  }
}
