/**
 * Diagnose why an email send fails with the generic
 * "your email mailbox isn't connected or its login/SMTP failed".
 *
 * That message in src/app/api/comms/email-thread/route.ts is a catch-all mapped
 * from ~10 different underlying errors, so it tells a user to go re-check their
 * settings even when the real cause is an expired OAuth refresh token or a
 * blocked SMTP port. This prints the ACTUAL failure.
 *
 * Prints config SHAPE only — never a password, token or secret.
 *
 *   docker run --rm --env-file .env.production -v ~/app/certs:/app/certs \
 *     -v ~/app/scripts:/app/scripts mfd-app:latest npx tsx scripts/diagnose-mailbox.ts
 */
import { withSystem } from "@/db/client";
import { sql } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";

async function main() {
  // MUST run in withSystem: the app connects as the non-superuser mfd_app role,
  // so a bare query with no app.tenant_id set is filtered to zero rows by RLS —
  // which looks exactly like "nothing is connected" and sends you hunting for a
  // config problem that does not exist. (Needs ALLOW_SYSTEM_TX=1, set on the box.)
  const r: any = await withSystem(async (tx) => tx.execute(sql`
    SELECT ti.id, ti.provider, ti.user_id, ti.is_active, ti.encrypted_config, ti.sender_config,
           u.name AS owner, u.email AS owner_email
      FROM tenant_integrations ti
      LEFT JOIN users u ON u.id = ti.user_id
     ORDER BY ti.provider
  `));

  if (r.rows.length === 0) {
    console.log("No tenant_integrations rows at all — nothing is connected.");
    process.exit(0);
  }

  for (const row of r.rows) {
    console.log("─".repeat(70));
    console.log(`provider=${row.provider}  active=${row.is_active}  scope=${row.user_id ? `USER (${row.owner} <${row.owner_email}>)` : "FIRM-WIDE"}`);

    let cfg: any = {};
    try {
      cfg = JSON.parse(decrypt(row.encrypted_config));
    } catch (e: any) {
      console.log(`  ✗ DECRYPT FAILED: ${e.message}`);
      console.log("    (ENCRYPTION_KEY differs from the one used when saving)");
      continue;
    }

    console.log(`  config keys: ${Object.keys(cfg).join(", ") || "(empty)"}`);
    console.log(`  senderConfig: ${JSON.stringify(row.sender_config)}`);

    if (cfg.oauth?.provider) {
      console.log(`  type: OAUTH (${cfg.oauth.provider}) email=${cfg.oauth.email ?? "?"} hasRefreshToken=${!!cfg.oauth.refreshToken}`);
      try {
        const { refreshAccessToken } = await import("@/lib/comms/oauth");
        await refreshAccessToken(cfg.oauth.provider, cfg.oauth.refreshToken);
        console.log("  ✓ OAuth refresh OK — token is valid");
      } catch (e: any) {
        console.log(`  ✗ OAuth refresh FAILED: ${e?.message ?? e}`);
        console.log("    -> sender.ts returns null here and silently falls through");
      }
      continue;
    }

    const smtp = cfg.smtp ?? cfg;
    const host = smtp.host, port = smtp.port, user = smtp.user ?? smtp.username;
    console.log(`  type: SMTP host=${host} port=${port} user=${user} hasPassword=${!!(smtp.pass ?? smtp.password)} secure=${smtp.secure}`);
    if (!host) {
      console.log("  ✗ no SMTP host in config");
      continue;
    }
    try {
      const nodemailer = (await import("nodemailer")).default;
      const t = nodemailer.createTransport({
        host, port: Number(port) || 587, secure: Boolean(smtp.secure),
        auth: { user, pass: smtp.pass ?? smtp.password },
        connectionTimeout: 15000, greetingTimeout: 15000,
      });
      await t.verify();
      console.log("  ✓ SMTP verify OK — credentials and connectivity are fine");
    } catch (e: any) {
      console.log(`  ✗ SMTP verify FAILED: [${e?.code ?? "?"}] ${e?.message ?? e}`);
      if (e?.responseCode) console.log(`    responseCode=${e.responseCode}`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("probe failed:", e?.message ?? e);
  process.exit(1);
});
