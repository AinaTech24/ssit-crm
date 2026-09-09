import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { withPlatformAdmin } from "@/db/client";
import { activeSuperAdminCount } from "@/lib/auth/super-admin-guard";
import { NewPlatformStaffForm } from "./NewPlatformStaffForm";

export const dynamic = "force-dynamic";

/**
 * Server wrapper for the add-platform-staff form.
 *
 * It exists only to answer one question before the form renders: is the single
 * Super Admin seat already taken? The API refuses a second either way, but a
 * form that offers an option it will then reject is a worse way to learn the
 * rule than a disabled radio that says why.
 */
export default async function NewPlatformStaffPage() {
  const session = await requireSession();
  requirePlatform(session.roles, "platform.staff.manage");

  const superAdminExists = await withPlatformAdmin(
    session.userId,
    async (tx) => (await activeSuperAdminCount(tx)) > 0
  );

  return <NewPlatformStaffForm superAdminExists={superAdminExists} />;
}
