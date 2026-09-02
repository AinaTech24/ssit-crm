/**
 * Personal security settings — self-service 2FA enrollment for the logged-in
 * user. Intentionally NOT gated by an org capability: every user manages their
 * own second factor (it protects their own session), so all that's required is
 * a valid session.
 */

import { eq, sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { ShieldCheck } from "lucide-react";
import { TwoFactorSetup } from "@/components/settings/TwoFactorSetup";

export const dynamic = "force-dynamic";

export default async function SecuritySettingsPage() {
  const session = await requireSession();

  // Read the user's own 2FA flag (system context — a user reading their own row).
  const enabled = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT two_fa_enabled FROM users WHERE id = ${session.userId} LIMIT 1
    `);
    return Boolean((r.rows[0] as { two_fa_enabled?: boolean } | undefined)?.two_fa_enabled);
  });

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ShieldCheck className="size-6 text-primary" />
          Security
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Protect your account with a second factor. Signed in as{" "}
          <span className="font-medium">{session.email}</span>.
        </p>
      </div>

      <TwoFactorSetup initialEnabled={enabled} />
    </div>
  );
}
