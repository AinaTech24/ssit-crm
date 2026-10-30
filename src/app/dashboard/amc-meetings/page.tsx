/**
 * AMC Meetings dashboard — the firm's AMC meeting log with a "Create meeting"
 * action. Its own sidebar item so an owner can hand it to a person (Employees →
 * Sidebar Access → AMC Meetings) without handing over the AMC empanelment details.
 */

import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { amcMeetingAccess } from "@/lib/amc/meeting-access";
import { AmcMeetingsView } from "@/components/amc-empanelments/AmcMeetingsView";

export const dynamic = "force-dynamic";

export default async function AmcMeetingsPage() {
  const session = await requireSession();
  const access = await amcMeetingAccess(session);
  if (!access.view) {
    return (
      <div className="card-surface p-8 text-center max-w-xl mx-auto mt-10">
        <h1 className="text-lg font-semibold">AMC meetings</h1>
        <p className="text-sm text-muted-foreground mt-2">
          You do not have access to this page. Ask your firm admin to enable “AMC Meetings” on your employee record.
        </p>
      </div>
    );
  }
  await assertActiveLicense(session.tenantId, session.roles);
  return (
    <AmcMeetingsView
      session={session}
      title="AMC meetings"
      canAdd={access.add}
      // No links into the AMC pages: they sit behind their own sidebar item, which
      // this person may not have.
      linkAmc={false}
    />
  );
}
