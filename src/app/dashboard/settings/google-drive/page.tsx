import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft, HardDrive } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { GoogleDriveCard } from "@/components/integrations/GoogleDriveCard";

export const dynamic = "force-dynamic";

/** Owner / admin only: connecting a Google account is a firm-wide decision. */
export default async function GoogleDriveSettingsPage() {
  const session = await requireSession();
  if (!can(session.roles, "settings.users", session.permissions)) {
    return (
      <div className="max-w-xl border rounded-lg bg-card p-8 text-sm text-muted-foreground">
        <h1 className="text-lg font-semibold text-foreground mb-1">Google Drive</h1>
        Only the firm&apos;s owner or an admin can connect Google Drive. Ask them to do it, then you can upload videos from the Social
        Media Tracker.
      </div>
    );
  }
  return (
    <div className="space-y-4 max-w-2xl">
      <Link href="/dashboard/settings" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to settings
      </Link>
      <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
        <HardDrive className="size-5" /> Google Drive
      </h1>
      <p className="text-sm text-muted-foreground">
        Connect the firm&apos;s Google account once. Videos uploaded in the CRM are then copied to Google Drive in year and month folders, and the
        Drive link is saved here in the CRM.
      </p>
      <Suspense fallback={null}>
        <GoogleDriveCard />
      </Suspense>
    </div>
  );
}
