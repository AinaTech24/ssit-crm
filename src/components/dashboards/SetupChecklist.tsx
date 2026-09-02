import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { SetupChecklistCard, type SetupStep } from "./SetupChecklistCard";

/**
 * "Get set up" checklist — shown on the owner dashboard until the firm has done
 * the four things that make the CRM actually work day-to-day. Each step is
 * verified from real data (not ticked by hand), and the card disappears on its
 * own once everything is done. Dismissable per device before that.
 *
 * Server component with its own cheap counts (4 single-row EXISTS queries in
 * one round trip) so a failure here can never take the cockpit down — the
 * parent wraps it in <Suspense> and it renders nothing on error.
 */
export async function SetupChecklist({ tenantId }: { tenantId: string }) {
  let steps: SetupStep[];
  try {
    const r = await withTenant(tenantId, async (tx) => {
      const res = await tx.execute(sql`
        SELECT
          EXISTS (SELECT 1 FROM investors WHERE deleted_at IS NULL) AS has_clients,
          (SELECT count(*) FROM users WHERE deleted_at IS NULL) > 1 AS has_team,
          EXISTS (SELECT 1 FROM whatsapp_numbers) AS has_wa,
          EXISTS (SELECT 1 FROM workflow_rules WHERE enabled = true) AS has_rules
      `);
      return (res as any).rows?.[0] ?? {};
    });
    steps = [
      {
        key: "clients",
        label: "Bring in your clients",
        hint: "Import from an RTA file or Excel, or add one by hand.",
        href: "/dashboard/investors/import",
        done: !!r.has_clients,
      },
      {
        key: "team",
        label: "Invite your team",
        hint: "RMs and back office get their own logins and task lists.",
        href: "/dashboard/settings/team",
        done: !!r.has_team,
      },
      {
        key: "whatsapp",
        label: "Connect WhatsApp",
        hint: "Send birthday wishes, reminders and updates from your own number.",
        href: "/dashboard/settings/whatsapp",
        done: !!r.has_wa,
      },
      {
        key: "automation",
        label: "Switch on your first automation",
        hint: "SIP-bounce recovery and review reminders run on their own.",
        href: "/dashboard/workflows/rules",
        done: !!r.has_rules,
      },
    ];
  } catch {
    return null; // never let setup nudges break the dashboard
  }

  if (steps.every((s) => s.done)) return null;
  return <SetupChecklistCard steps={steps} />;
}
