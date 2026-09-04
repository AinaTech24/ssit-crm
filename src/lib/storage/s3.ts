/**
 * S3 storage abstraction for the compliance vault and other document uploads.
 *
 * Uses presigned URLs so files never flow through our Next.js server
 * (which is a problem on Vercel's serverless functions due to body-size limits).
 * Browser PUTs directly to S3; we record the resulting key in compliance_documents.
 *
 * Region: ap-south-1 (Mumbai) — DPDP data localization requirement.
 */

import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from "fs";
import path from "path";

// Accept BOTH our own S3_* names and the standard AWS_* names. A very common
// reason "S3 is configured but files still land on local disk" is that the keys
// were exported under AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (the AWS CLI /
// SDK convention) while this code only looked at S3_*.
function accessKeyId(): string | undefined {
  return process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || undefined;
}
function secretAccessKey(): string | undefined {
  return process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || undefined;
}
function region(): string {
  return process.env.S3_REGION || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1";
}

/**
 * Explicit opt-in for credential-less operation. On EC2/ECS the SDK can get
 * credentials from the attached IAM role, which is how the Terraform stack is
 * built (no long-lived keys on the box). We require a FLAG rather than probing
 * the SDK chain so a genuinely unconfigured environment still fails loudly
 * instead of hanging on an IMDS lookup that will never succeed.
 */
function useInstanceRole(): boolean {
  return process.env.S3_USE_INSTANCE_ROLE === "1";
}

export function isS3Configured(): boolean {
  if (accessKeyId() && secretAccessKey()) return true;
  // Instance-role mode still needs an explicit bucket — falling through to the
  // stale default bucket name would write documents into a bucket we do not own.
  return useInstanceRole() && !!(process.env.S3_BUCKET || process.env.AWS_S3_BUCKET);
}

/**
 * Whether S3 is mandatory (no local-disk fallback allowed). On by default in
 * production, so a missing/broken S3 config fails LOUDLY instead of silently
 * writing documents to the container's ephemeral disk (which then disappear on
 * the next deploy and never reach the bucket). Opt out with ALLOW_LOCAL_STORAGE=1.
 */
function s3Required(): boolean {
  return process.env.NODE_ENV === "production" && process.env.ALLOW_LOCAL_STORAGE !== "1";
}

/** Throws a clear error when S3 is mandatory but not configured. */
function assertS3OrLocalAllowed(): void {
  if (!isS3Configured() && s3Required()) {
    throw new Error(
      "S3 storage is required in production but is not configured — set S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY (a matching pair), or set S3_USE_INSTANCE_ROLE=1 with S3_BUCKET when running on EC2/ECS with an IAM role attached. Refusing to store the document on local disk."
    );
  }
}

function client(): S3Client {
  const akid = accessKeyId();
  return new S3Client({
    region: region(),
    credentials: akid
      ? {
          accessKeyId: akid,
          secretAccessKey: secretAccessKey()!,
        }
      : undefined, // falls back to IAM role on EC2/ECS
  });
}

export function bucket(): string {
  return process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || "mfd-platform-docs";
}

/**
 * Non-secret snapshot of the storage configuration, for the diagnostics
 * endpoint + upload-page badge. Never returns the secret key; the access key id
 * is masked to first-4…last-4 so it can be eyeballed against the AWS console.
 */
export function storageStatus(): {
  configured: boolean;
  driver: "s3" | "local";
  bucket: string;
  region: string;
  accessKeyIdMasked: string | null;
  source: "S3_*" | "AWS_*" | "instance-role" | "none";
} {
  const akid = accessKeyId();
  const configured = isS3Configured();
  return {
    configured,
    driver: configured ? "s3" : "local",
    bucket: bucket(),
    region: region(),
    accessKeyIdMasked: akid && akid.length >= 8 ? `${akid.slice(0, 4)}…${akid.slice(-4)}` : akid ? "****" : null,
    source: process.env.S3_ACCESS_KEY_ID
      ? "S3_*"
      : process.env.AWS_ACCESS_KEY_ID
        ? "AWS_*"
        : useInstanceRole()
          ? "instance-role"
          : "none",
  };
}

/** Lowercase, hyphenated, ASCII-safe path segment (≤40 chars), or `fallback`. */
function pathSlug(s: string | null | undefined, fallback: string): string {
  const out = (s ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "") // drop non-ASCII (Gujarati/Hindi names etc.)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return out || fallback;
}

/**
 * Optional human-readable context for an upload. When supplied, files are laid
 * out in a browsable tree the MFD can navigate in the S3 console:
 *
 *   firm/<firm>/<uploader>/<client>/<docType>/<ts>-<file>   (client documents)
 *   firm/<firm>/logos/<ts>-<file>                            (brand logos)
 *
 * `<firm>` is the firm display-name slug suffixed with the tenant-id prefix so
 * two firms with the same name never collide in the shared bucket.
 */
export type AssetContext = {
  firm?: string | null;
  uploader?: string | null;
  client?: string | null;
  docType?: string | null;
};

/**
 * Returns the storage key for an upload. With no `ctx`, keeps the legacy
 * tenant-scoped layout ("tenants/<tenantId>/<kind>/<ts>-<file>"). With `ctx`,
 * builds the readable firm/uploader/client/docType tree (logos get firm/logos).
 */
export function vaultKey(
  tenantId: string,
  kind: "compliance" | "kyc" | "marketing" | "general",
  filename: string,
  ctx?: AssetContext
): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const ts = Date.now();

  if (ctx && (ctx.firm || ctx.uploader || ctx.client || ctx.docType)) {
    const firm = `${pathSlug(ctx.firm, "firm")}-${tenantId.slice(0, 8)}`;
    const docType = pathSlug(ctx.docType, kind);
    // Brand logos are firm-wide, not tied to an uploader/client.
    if (docType === "logo" || docType === "logos") {
      return `firm/${firm}/logos/${ts}-${safe}`;
    }
    const uploader = pathSlug(ctx.uploader, "unknown");
    const client = pathSlug(ctx.client, "general");
    return `firm/${firm}/${uploader}/${client}/${docType}/${ts}-${safe}`;
  }

  return `tenants/${tenantId}/${kind}/${ts}-${safe}`;
}

export async function presignedPutUrl(key: string, contentType: string, ttlSeconds = 600): Promise<string> {
  if (!isS3Configured()) {
    assertS3OrLocalAllowed();
    return `/api/upload-local/${key}`;
  }
  // NOTE: do NOT set ServerSideEncryption here. When it's part of the signed
  // PutObjectCommand, AWS adds `x-amz-server-side-encryption` to the request's
  // signed headers, which means the *browser* must replay that exact header on
  // its PUT — our client only sends Content-Type, so S3 rejects every upload
  // with 403 SignatureDoesNotMatch. Encryption at rest is still enforced by the
  // bucket's default encryption (SSE-S3/AES256 is on by default for all S3
  // buckets since Jan 2023), so objects remain encrypted without the header.
  const cmd = new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client(), cmd, { expiresIn: ttlSeconds });
}

export async function presignedGetUrl(
  key: string,
  ttlSeconds = 600,
  filename?: string,
  inline = false
): Promise<string> {
  if (!isS3Configured()) {
    return `/api/upload-local/${key}`;
  }
  // `inline` lets the browser preview the file (PDF/image) in a tab; otherwise
  // it downloads as an attachment with the original name. Use a Content-
  // Disposition that survives spaces / unicode: an ASCII fallback PLUS an
  // RFC 5987 filename* with the exact (encoded) name, so the browser uses the
  // document's real name rather than the random storage key.
  let disposition: string | undefined;
  if (filename) {
    const ascii = filename.replace(/["\\]/g, "").replace(/[^\x20-\x7E]/g, "_");
    const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
    const type = inline ? "inline" : "attachment";
    disposition = `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
  } else if (inline) {
    disposition = "inline";
  }
  const cmd = new GetObjectCommand({
    Bucket: bucket(),
    Key: key,
    ResponseContentDisposition: disposition,
  });
  return getSignedUrl(client(), cmd, { expiresIn: ttlSeconds });
}

/**
 * Read a local-disk upload's bytes, ALWAYS from the uploads volume — never S3.
 * Assets uploaded via the `/api/upload-local/<key>` path (the no-S3-keys era)
 * live on disk and keep their `/api/upload-local/...` URL even after S3 is later
 * configured, so they must be read from disk regardless of `isS3Configured()`.
 */
export async function getLocalUploadBytes(key: string): Promise<Buffer> {
  const filePath = path.join(process.cwd(), "node-local", "uploads", key);
  return fs.promises.readFile(filePath);
}

/** Delete a file from the LOCAL upload volume only (never touches S3). Used to
 *  purge RTA zips after parsing — they are deliberately kept off S3. */
export async function deleteLocalUpload(key: string): Promise<void> {
  const filePath = path.join(process.cwd(), "node-local", "uploads", key);
  await fs.promises.unlink(filePath).catch(() => {});
}

/** Read an object's raw bytes (S3 GetObject, or local disk in the fallback). */
export async function getObjectBytes(key: string): Promise<Buffer> {
  if (!isS3Configured()) {
    const filePath = path.join(process.cwd(), "node-local", "uploads", key);
    return fs.promises.readFile(filePath);
  }
  const res = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  const stream = res.Body as AsyncIterable<Uint8Array> | undefined;
  if (!stream) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function deleteObject(key: string): Promise<void> {
  if (!isS3Configured()) {
    const filePath = path.join(process.cwd(), "node-local", "uploads", key);
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath).catch(() => {});
    }
    return;
  }
  await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

/**
 * Server-side PUT for small uploads (KYC docs from public forms, screenshots,
 * etc.). For large files use presignedPutUrl + browser direct upload.
 */
export async function putObject(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
  if (!isS3Configured()) {
    assertS3OrLocalAllowed();
    const filePath = path.join(process.cwd(), "node-local", "uploads", key);
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(filePath, body);
    return;
  }
  await client().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
      ServerSideEncryption: "AES256",
    })
  );
}
