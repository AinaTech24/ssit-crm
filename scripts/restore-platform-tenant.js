/**
 * Recovery: un-delete the PLATFORM tenant.
 *
 * The platform tenant (00000000-0000-0000-0000-000000000000) is a sentinel that
 * owns every platform_admin user. Soft-deleting it does not delete those users —
 * they stay active — but login joins users to tenants and rejects a session whose
 * tenant is soft-deleted, so EVERY admin gets "account inactive" and nobody can
 * reach /super-admin to undo it. There is no in-app way out of that state.
 *
 * This clears deleted_at and sets status back to active. It touches exactly one
 * row, by hardcoded id, and does not delete anything.
 *
 *   docker run --rm --env-file .env.production -v ~/app/certs:/app/certs \
 *     -v /tmp/restore.js:/app/restore.js mfd-app:latest node /app/restore.js
 */
const { Client } = require("pg");

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const before = await c.query(
    "select display_name, status, deleted_at from tenants where id = $1::uuid",
    [PLATFORM_TENANT_ID]
  );
  if (before.rows.length === 0) {
    console.error("Platform tenant row not found — nothing to restore.");
    process.exit(1);
  }
  console.log("before:", JSON.stringify(before.rows[0]));

  const after = await c.query(
    `update tenants
        set deleted_at = null, status = 'active', updated_at = now()
      where id = $1::uuid
      returning display_name, status, deleted_at`,
    [PLATFORM_TENANT_ID]
  );
  console.log("after :", JSON.stringify(after.rows[0]));

  const admins = await c.query(
    `select email, name, status from users
      where tenant_id = $1::uuid and deleted_at is null order by email`,
    [PLATFORM_TENANT_ID]
  );
  console.log("\nplatform admins now able to sign in:");
  console.table(admins.rows);

  await c.end();
})().catch((e) => {
  console.error("RESTORE FAILED:", e.message);
  process.exit(1);
});
