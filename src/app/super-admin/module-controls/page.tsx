import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { loadModuleControls, moduleControlsForAdmin } from "@/lib/platform/module-controls";
import { ModuleControlsForm } from "@/components/super-admin/ModuleControlsForm";

export const dynamic = "force-dynamic";

export default async function ModuleControlsPage() {
  const session = await requireSession();
  requirePlatform(session.roles, "platform.settings.manage");

  const map = await loadModuleControls(true);
  const modules = moduleControlsForAdmin(map);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Module Controls</h1>
        <p className="text-muted-foreground text-sm">
          Global switches for every product module. <strong>Enabled</strong> = normal.{" "}
          <strong>Beta</strong> = visible with a “Beta” tag in the sidebar. <strong>Disabled</strong> = hidden for
          every tenant (a platform kill-switch). Applies on top of each firm’s package &amp; per-user grants.
        </p>
      </div>

      <ModuleControlsForm initial={modules} />

      <div className="border rounded-lg bg-muted/30 p-4 text-xs text-muted-foreground space-y-1.5 max-w-3xl">
        <p className="font-medium text-foreground">How it works</p>
        <p>
          These are <strong>global</strong> controls. A module set to <strong>Disabled</strong> here is hidden for
          everyone regardless of their package. <strong>Beta</strong> doesn’t restrict access — it just flags the
          module as in-testing with a tag. Changes take effect across the platform within ~30 seconds, no redeploy.
        </p>
      </div>
    </div>
  );
}
