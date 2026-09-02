/**
 * set-s3-cors.mjs — inspect / fix the S3 bucket CORS policy.
 *
 * WHY THIS EXISTS
 * ---------------
 * Large uploads (RTA registry files, compliance docs, content library) are
 * PUT *directly from the browser* to S3 via a presigned URL — this bypasses
 * the Next.js server's ~10MB request-body limit that truncated big zips.
 *
 * A browser PUT with a `Content-Type` header is a non-simple cross-origin
 * request, so the browser fires a CORS preflight `OPTIONS` to the bucket
 * first. If the bucket has no CORS policy allowing PUT from the app origin,
 * S3 answers with no `Access-Control-Allow-Origin`, the browser blocks the
 * request, and the upload fails with the opaque "Failed to fetch".
 *
 * This script reads the same S3 / AWS env the app uses and:
 *   - default (no flag): prints the bucket's CURRENT CORS config (read-only)
 *   - with `--apply`:     writes a CORS policy permitting PUT/GET/HEAD from the
 *                         configured app origins (+ localhost for dev)
 *
 * Usage:
 *   node scripts/set-s3-cors.mjs                 # show current CORS
 *   node scripts/set-s3-cors.mjs --apply         # apply the fix
 *
 * Run it once per bucket/environment. The creds need s3:GetBucketCors and
 * s3:PutBucketCors on the target bucket.
 */

import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import {
  S3Client,
  GetBucketCorsCommand,
  PutBucketCorsCommand,
} from "@aws-sdk/client-s3";

// Load the same env the app uses. Prefer .env.production (the prod server's
// real creds), fall back to .env for local. dotenv never overrides vars
// already present in process.env, so this is safe if env is pre-injected.
for (const f of [".env.production", ".env"]) {
  if (existsSync(f)) loadEnv({ path: f });
}

const region =
  process.env.S3_REGION || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1";
const bucket = process.env.S3_BUCKET || process.env.AWS_S3_BUCKET;
const accessKeyId = process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;

if (!bucket) {
  console.error("✗ No S3_BUCKET / AWS_S3_BUCKET in env — nothing to configure.");
  process.exit(1);
}
if (!accessKeyId || !secretAccessKey) {
  console.error("✗ No S3 credentials in env (S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY).");
  process.exit(1);
}

const client = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });

// App origins allowed to PUT directly to the bucket. APP_URL is the deployed
// origin; localhost entries keep `npm run dev` uploads working too.
const origins = Array.from(
  new Set(
    [
      process.env.APP_URL,
      process.env.NEXTAUTH_URL,
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://crm.ssit.com",
    ]
      .filter(Boolean)
      .map((u) => u.replace(/\/+$/, "")) // strip trailing slash — Origin headers never have one
  )
);

const corsRules = [
  {
    AllowedOrigins: origins,
    AllowedMethods: ["PUT", "GET", "HEAD"],
    AllowedHeaders: ["*"], // lets the signed Content-Type (+ any header) pass preflight
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 3000,
  },
];

const apply = process.argv.includes("--apply");

console.log(`Bucket : ${bucket}`);
console.log(`Region : ${region}`);
console.log(`Origins: ${origins.join(", ")}`);
console.log("");

async function showCurrent() {
  try {
    const res = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
    console.log("Current CORS config:");
    console.log(JSON.stringify(res.CORSRules, null, 2));
  } catch (e) {
    if (e?.name === "NoSuchCORSConfiguration") {
      console.log("Current CORS config: (none) — this is why browser uploads fail with 'Failed to fetch'.");
    } else {
      console.error("✗ Could not read CORS config:", e?.name || e?.message || e);
      throw e;
    }
  }
}

await showCurrent();

if (!apply) {
  console.log("\nRun again with --apply to write the CORS policy above.");
  process.exit(0);
}

console.log("\nApplying CORS policy…");
await client.send(
  new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: corsRules } })
);
console.log("✓ Applied. Re-reading to confirm:\n");
await showCurrent();
console.log("\nDone. Browser uploads should now succeed.");
